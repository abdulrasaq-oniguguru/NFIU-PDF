import base64
import hashlib
import math
import os
import shutil
import subprocess
import zipfile
from collections import defaultdict
from pathlib import Path

import fitz
import pdf2docx.text.TextSpan as _pdf2docx_textspan
from openpyxl import Workbook
from pdf2docx import Converter
from pptx import Presentation
from pptx.util import Inches
from pypdf import PdfReader, PdfWriter

# PyMuPDF's rebased backend (>=1.24) can return span colors as signed integers,
# but pdf2docx's rgb_component() assumes unsigned 0-16777215 and crashes on
# negative input (hex() of a negative int keeps the sign, breaking int(..., 16)).
# Mask to 24 bits to recover the intended unsigned color before pdf2docx sees it.
_original_rgb_component = _pdf2docx_textspan.rgb_component


def _safe_rgb_component(srgb: int):
    return _original_rgb_component(srgb & 0xFFFFFF)


_pdf2docx_textspan.rgb_component = _safe_rgb_component

PDF_EXTENSIONS = {".pdf"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}
OFFICE_EXTENSIONS = {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp"}


class OperationError(RuntimeError):
    pass


def run_operation(operation: str, files: list[Path], output_dir: Path, options: dict) -> Path:
    if operation not in OPERATIONS:
        raise OperationError("Unknown operation")
    output_name, handler = OPERATIONS[operation]
    output = output_dir / output_name
    return handler(files, output, options)


def merge_pdfs(files: list[Path], output: Path, options: dict) -> Path:
    writer = PdfWriter()
    for file_path in files:
        ensure_pdf(file_path)
        reader = PdfReader(str(file_path))
        for page in reader.pages:
            writer.add_page(page)
    with output.open("wb") as handle:
        writer.write(handle)
    return output


def split_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    reader = PdfReader(str(source))
    every = max(int(options.get("every") or 1), 1)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for index in range(0, len(reader.pages), every):
            writer = PdfWriter()
            for page in reader.pages[index : index + every]:
                writer.add_page(page)
            part_name = f"{source.stem}_pages_{index + 1}-{min(index + every, len(reader.pages))}.pdf"
            part_path = output.parent / part_name
            with part_path.open("wb") as handle:
                writer.write(handle)
            archive.write(part_path, part_name)
            part_path.unlink(missing_ok=True)
    return output


def delete_pages(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    reader = PdfReader(str(source))
    delete_set = set(parse_page_spec(options.get("pages") or "", len(reader.pages)))
    if not delete_set:
        raise OperationError("Enter pages to delete")
    writer = PdfWriter()
    for index, page in enumerate(reader.pages, start=1):
        if index not in delete_set:
            writer.add_page(page)
    if not writer.pages:
        raise OperationError("Cannot delete every page")
    with output.open("wb") as handle:
        writer.write(handle)
    return output


def reorder_pages(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    reader = PdfReader(str(source))
    page_count = len(reader.pages)
    order = parse_page_spec(options.get("pages") or "", page_count)
    if not order:
        raise OperationError("Enter the new page order")
    if str(options.get("keep_remaining") or "").lower() in ("1", "true", "yes", "on"):
        moved = set(order)
        order = order + [page for page in range(1, page_count + 1) if page not in moved]
    writer = PdfWriter()
    for page_number in order:
        writer.add_page(reader.pages[page_number - 1])
    with output.open("wb") as handle:
        writer.write(handle)
    return output


def rotate_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    degrees = int(options.get("degrees") or 90)
    reader = PdfReader(str(source))
    writer = PdfWriter()
    for page in reader.pages:
        page.rotate(degrees)
        writer.add_page(page)
    with output.open("wb") as handle:
        writer.write(handle)
    return output


def crop_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    reader = PdfReader(str(source))
    writer = PdfWriter()
    crop = options.get("crop") or {}
    use_selection = all(key in crop for key in ("x", "y", "width", "height"))
    margin = max(float(options.get("margin") or 0), 0)
    for index, page in enumerate(reader.pages, start=1):
        applies = crop.get("scope", "all") == "all" or index == int(crop.get("page") or 1)
        if use_selection and applies:
            left, bottom, right, top = map(float, (page.cropbox.left, page.cropbox.bottom, page.cropbox.right, page.cropbox.top))
            page_width, page_height = right - left, top - bottom
            x = min(max(float(crop["x"]), 0), 1)
            y = min(max(float(crop["y"]), 0), 1)
            width = min(max(float(crop["width"]), 0.001), 1 - x)
            height = min(max(float(crop["height"]), 0.001), 1 - y)
            page.cropbox.lower_left = (left + x * page_width, top - (y + height) * page_height)
            page.cropbox.upper_right = (left + (x + width) * page_width, top - y * page_height)
        elif not use_selection and margin:
            page.cropbox.lower_left = (float(page.cropbox.left) + margin, float(page.cropbox.bottom) + margin)
            page.cropbox.upper_right = (float(page.cropbox.right) - margin, float(page.cropbox.top) - margin)
        writer.add_page(page)
    with output.open("wb") as handle:
        writer.write(handle)
    return output


# Named Ghostscript presets (/ebook, /printer, ...) only downsample images that
# already exceed their built-in default resolution, so a document with images
# at or below that resolution just gets re-encoded with no size benefit (and
# sometimes a net increase from added font/structure overhead). Forcing an
# explicit resolution per tier makes each tier actually downsample.
COMPRESSION_PROFILES = {
    "high": {"preset": "screen", "dpi": 96},
    "balanced": {"preset": "ebook", "dpi": 150},
    "light": {"preset": "printer", "dpi": 300},
}


def compress_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    ghostscript = resolve_binary("gs", "gswin64c", "gswin32c")
    quality = options.get("quality") or "balanced"
    profile = COMPRESSION_PROFILES.get(quality, COMPRESSION_PROFILES["balanced"])
    subprocess.run(
        [
            ghostscript,
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            f"-dPDFSETTINGS=/{profile['preset']}",
            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH",
            "-dDownsampleColorImages=true",
            f"-dColorImageResolution={profile['dpi']}",
            "-dDownsampleGrayImages=true",
            f"-dGrayImageResolution={profile['dpi']}",
            "-dDownsampleMonoImages=true",
            f"-dMonoImageResolution={profile['dpi']}",
            f"-sOutputFile={output}",
            str(source),
        ],
        check=True,
    )
    if output.stat().st_size >= source.stat().st_size:
        shutil.copyfile(source, output)
    return output


def protect_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    password = options.get("password")
    if not password:
        raise OperationError("Password is required")
    reader = PdfReader(str(source))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt(user_password=password, owner_password=password, algorithm="AES-256")
    with output.open("wb") as handle:
        writer.write(handle)
    return output


def unlock_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    password = options.get("password") or ""
    reader = PdfReader(str(source))
    if reader.is_encrypted and not reader.decrypt(password):
        raise OperationError("Invalid or missing PDF password")
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    with output.open("wb") as handle:
        writer.write(handle)
    return output


def watermark_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    text = options.get("text") or "CONFIDENTIAL"
    document = fitz.open(source)
    for page in document:
        rect = page.rect
        center = fitz.Point(rect.width / 2, rect.height / 2)
        morph = (center, fitz.Matrix(1, 1).prerotate(45))
        page.insert_textbox(
            rect,
            text,
            fontsize=max(min(rect.width, rect.height) / 12, 24),
            fontname="helv",
            color=(0.45, 0.45, 0.45),
            align=fitz.TEXT_ALIGN_CENTER,
            morph=morph,
            fill_opacity=0.18,
        )
    document.save(output)
    document.close()
    return output


def remove_watermark_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    document = fitz.open(source)
    page_count = len(document)
    threshold = max(1, math.ceil(page_count * 0.6))

    text_groups: dict[tuple[str, int], list[tuple[int, fitz.Quad]]] = defaultdict(list)
    for page_index in range(page_count):
        page = document[page_index]
        min_dim = min(page.rect.width, page.rect.height)
        raw = page.get_text("rawdict")
        for block in raw.get("blocks", []):
            for line in block.get("lines", []):
                direction = line.get("dir", (1, 0))
                angle = math.degrees(math.atan2(direction[1], direction[0]))
                angle_mod = abs(angle) % 90
                is_diagonal = min(angle_mod, 90 - angle_mod) > 5
                for span in line.get("spans", []):
                    chars = span.get("chars") or []
                    text = "".join(c.get("c", "") for c in chars).strip()
                    if not text:
                        continue
                    is_large = span.get("size", 0) > 0.05 * min_dim
                    if is_diagonal or is_large:
                        key = (text.lower(), round(angle))
                        for quad in _char_quads(direction, span, chars):
                            text_groups[key].append((page_index, quad))

    image_groups: dict[str, list[tuple[int, fitz.Rect]]] = defaultdict(list)
    for page_index in range(page_count):
        page = document[page_index]
        for image_info in page.get_images(full=True):
            xref = image_info[0]
            try:
                image_bytes = document.extract_image(xref)["image"]
            except Exception:
                continue
            digest = hashlib.md5(image_bytes).hexdigest()
            for rect in page.get_image_rects(xref):
                image_groups[digest].append((page_index, rect))

    removed = 0
    for occurrences in text_groups.values():
        if len({page_index for page_index, _ in occurrences}) >= threshold:
            for page_index, quad in occurrences:
                document[page_index].add_redact_annot(quad)
                removed += 1
    for occurrences in image_groups.values():
        if len({page_index for page_index, _ in occurrences}) >= threshold:
            for page_index, rect in occurrences:
                document[page_index].add_redact_annot(rect)
                removed += 1

    if removed == 0:
        document.close()
        raise OperationError("No watermark-like content was detected")

    for page in document:
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_REMOVE)

    document.save(output, garbage=4, deflate=True)
    document.close()
    return output


def _char_quads(direction, span: dict, chars: list[dict]) -> list[fitz.Quad]:
    """Build tight per-character rotated quads from character origins.

    MuPDF reports span['bbox'] as an axis-aligned box in device space, which
    for rotated (e.g. diagonal watermark) text becomes far larger than the
    visible glyphs and can bleed into unrelated content. Redacting one quad
    per character (rather than one big quad for the whole run) keeps the
    erased area as close as possible to the actual glyph strokes, minimizing
    collateral damage where the watermark visually crosses other text.
    """
    dx, dy = direction
    norm = math.hypot(dx, dy) or 1.0
    dx, dy = dx / norm, dy / norm
    px, py = -dy, dx
    size = span.get("size", 10)
    ascender = span.get("ascender", 0.8) * size
    descender = span.get("descender", -0.2) * size
    up = fitz.Point(px, py)
    step = fitz.Point(dx, dy) * (size * 0.6)

    quads = []
    for index, char in enumerate(chars):
        start = fitz.Point(char["origin"])
        end = fitz.Point(chars[index + 1]["origin"]) if index + 1 < len(chars) else start + step
        top_left = start + up * ascender
        bottom_left = start + up * descender
        top_right = end + up * ascender
        bottom_right = end + up * descender
        quads.append(fitz.Quad(top_left, top_right, bottom_left, bottom_right))
    return quads


PAGE_NUMBER_POSITIONS = {
    "top-left": ("top", fitz.TEXT_ALIGN_LEFT, "left"),
    "top-center": ("top", fitz.TEXT_ALIGN_CENTER, "center"),
    "top-right": ("top", fitz.TEXT_ALIGN_RIGHT, "right"),
    "bottom-left": ("bottom", fitz.TEXT_ALIGN_LEFT, "left"),
    "bottom-center": ("bottom", fitz.TEXT_ALIGN_CENTER, "center"),
    "bottom-right": ("bottom", fitz.TEXT_ALIGN_RIGHT, "right"),
}

PAGE_NUMBER_MARGINS = {"small": 10, "recommended": 20, "big": 36}

PAGE_NUMBER_FONTS = {
    ("helvetica", False, False): "helv",
    ("helvetica", True, False): "hebo",
    ("helvetica", False, True): "heit",
    ("helvetica", True, True): "hebi",
    ("times", False, False): "tiro",
    ("times", True, False): "tibo",
    ("times", False, True): "tiit",
    ("times", True, True): "tibi",
    ("courier", False, False): "cour",
    ("courier", True, False): "cobo",
    ("courier", False, True): "coit",
    ("courier", True, True): "cobi",
}


def _truthy(value) -> bool:
    return str(value or "false").lower() in ("1", "true", "yes", "on")


def _hex_to_rgb(value: str) -> tuple:
    value = (value or "#1a1f2b").lstrip("#")
    if len(value) != 6:
        value = "1a1f2b"
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4))


def page_numbers_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    document = fitz.open(source)
    start = max(int(options.get("page_number_start") or 1), 1)
    last_number = start + len(document) - 1
    template = options.get("page_number_format") or "number_total"
    custom_text = options.get("page_number_custom") or "Page {n} of {p}"
    vertical, align, horizontal = PAGE_NUMBER_POSITIONS.get(
        options.get("page_number_position") or "bottom-center", PAGE_NUMBER_POSITIONS["bottom-center"]
    )
    facing = (options.get("page_number_mode") or "single") == "facing"
    margin = PAGE_NUMBER_MARGINS.get(options.get("page_number_margin") or "recommended", 20)
    box_height = 24

    bold = _truthy(options.get("page_number_bold"))
    italic = _truthy(options.get("page_number_italic"))
    underline = _truthy(options.get("page_number_underline"))
    fontname = PAGE_NUMBER_FONTS.get((options.get("page_number_font") or "helvetica", bold, italic), "helv")
    fontsize = max(float(options.get("page_number_size") or 10), 4)
    color = _hex_to_rgb(options.get("page_number_color"))

    for index, page in enumerate(document):
        number = start + index
        if template == "page_n":
            text = f"Page {number}"
        elif template == "page_of":
            text = f"Page {number} of {last_number}"
        elif template == "custom":
            text = custom_text.replace("{n}", str(number)).replace("{p}", str(last_number))
        elif template == "number":
            text = str(number)
        else:
            text = f"{number} / {last_number}"

        page_align = align
        # On facing pages, mirror left/right placement on even pages so the
        # number always sits on the outer edge, like a printed book spread.
        if facing and index % 2 == 1 and horizontal in ("left", "right"):
            page_align = fitz.TEXT_ALIGN_RIGHT if horizontal == "left" else fitz.TEXT_ALIGN_LEFT

        rect = page.rect
        y0 = margin if vertical == "top" else rect.height - margin - box_height
        box = fitz.Rect(12, y0, rect.width - 12, y0 + box_height)
        page.insert_textbox(box, text, fontsize=fontsize, fontname=fontname, color=color, align=page_align)

        if underline:
            text_width = fitz.get_text_length(text, fontname=fontname, fontsize=fontsize)
            if page_align == fitz.TEXT_ALIGN_LEFT:
                x0 = box.x0 + 2
            elif page_align == fitz.TEXT_ALIGN_RIGHT:
                x0 = box.x1 - 2 - text_width
            else:
                x0 = box.x0 + (box.width - text_width) / 2
            underline_y = y0 + box_height - 6
            page.draw_line(
                fitz.Point(x0, underline_y),
                fitz.Point(x0 + text_width, underline_y),
                color=color,
                width=max(fontsize * 0.06, 0.6),
            )
    document.save(output)
    document.close()
    return output


def images_to_pdf(files: list[Path], output: Path, options: dict) -> Path:
    image_files = [path for path in files if path.suffix.lower() in IMAGE_EXTENSIONS]
    if not image_files:
        raise OperationError("Upload at least one image")
    document = fitz.open()
    for image_path in image_files:
        image_document = fitz.open(image_path)
        image_pdf = fitz.open("pdf", image_document.convert_to_pdf())
        document.insert_pdf(image_pdf)
        image_pdf.close()
        image_document.close()
    document.save(output)
    document.close()
    return output


def extract_images(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    document = fitz.open(source)
    extracted = 0
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for page_index in range(len(document)):
            page = document[page_index]
            for image_index, image_info in enumerate(page.get_images(full=True), start=1):
                xref = image_info[0]
                image = document.extract_image(xref)
                ext = image.get("ext", "png")
                image_name = f"{source.stem}_page_{page_index + 1}_image_{image_index}.{ext}"
                image_path = output.parent / image_name
                image_path.write_bytes(image["image"])
                archive.write(image_path, image_name)
                image_path.unlink(missing_ok=True)
                extracted += 1
    document.close()
    if extracted == 0:
        raise OperationError("No embedded images found")
    return output


def pdf_to_images(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    dpi = int(options.get("dpi") or 200)
    document = fitz.open(source)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for index, page in enumerate(document, start=1):
            image_name = f"{source.stem}_page_{index}.png"
            image_path = output.parent / image_name
            page.get_pixmap(dpi=dpi).save(image_path)
            archive.write(image_path, image_name)
            image_path.unlink(missing_ok=True)
    document.close()
    return output


def pdf_to_word(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    converter = Converter(str(source))
    try:
        converter.convert(str(output))
    finally:
        converter.close()
    return output


def pdf_to_excel(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    document = fitz.open(source)
    workbook = Workbook()
    workbook.remove(workbook.active)
    for page_index, page in enumerate(document, start=1):
        sheet = workbook.create_sheet(title=f"Page {page_index}")
        blocks = page.get_text("blocks")
        sheet.append(["x0", "y0", "x1", "y1", "text"])
        for block in blocks:
            text = str(block[4]).strip()
            if text:
                sheet.append([block[0], block[1], block[2], block[3], text])
        sheet.column_dimensions["E"].width = 90
    document.close()
    workbook.save(output)
    return output


def pdf_to_powerpoint(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    dpi = int(options.get("dpi") or 160)
    document = fitz.open(source)
    presentation = Presentation()
    presentation.slide_width = Inches(11)
    presentation.slide_height = Inches(8.5)
    blank_layout = presentation.slide_layouts[6]
    for index, page in enumerate(document, start=1):
        image_path = output.parent / f"slide_{index}.png"
        page.get_pixmap(dpi=dpi).save(image_path)
        slide = presentation.slides.add_slide(blank_layout)
        slide.shapes.add_picture(str(image_path), 0, 0, width=presentation.slide_width, height=presentation.slide_height)
        image_path.unlink(missing_ok=True)
    document.close()
    presentation.save(output)
    return output


WORD_EXTENSIONS = {".doc", ".docx", ".odt"}
EXCEL_EXTENSIONS = {".xls", ".xlsx", ".ods"}
POWERPOINT_EXTENSIONS = {".ppt", ".pptx", ".odp"}


def _office_to_pdf(files: list[Path], output: Path, allowed: set[str], label: str) -> Path:
    source = single_file(files)
    if source.suffix.lower() not in allowed:
        raise OperationError(f"{source.name} is not a {label} document")
    if os.name == "nt" and source.suffix.lower() in WORD_EXTENSIONS | EXCEL_EXTENSIONS | POWERPOINT_EXTENSIONS:
        try:
            return _windows_office_to_pdf(source, output)
        except (OperationError, subprocess.SubprocessError):
            pass
    soffice = resolve_binary("soffice", "libreoffice")
    subprocess.run(
        [
            soffice,
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(output.parent),
            str(source),
        ],
        check=True,
    )
    generated = output.parent / f"{source.stem}.pdf"
    if not generated.exists():
        raise OperationError("LibreOffice did not produce a PDF")
    generated.replace(output)
    return output


def _windows_office_to_pdf(source: Path, output: Path) -> Path:
    """Use an installed Microsoft Office application as the Windows PDF backend."""
    powershell = shutil.which("powershell.exe") or str(
        Path(os.environ.get("SystemRoot", r"C:\Windows"))
        / "System32"
        / "WindowsPowerShell"
        / "v1.0"
        / "powershell.exe"
    )
    suffix = source.suffix.lower()
    if suffix in WORD_EXTENSIONS:
        body = (
            "$app=New-Object -ComObject Word.Application; $app.Visible=$false; "
            "try {$doc=$app.Documents.Open($src); $doc.ExportAsFixedFormat($dst,17)} "
            "finally {if($doc){$doc.Close($false)}; $app.Quit()}"
        )
    elif suffix in EXCEL_EXTENSIONS:
        body = (
            "$app=New-Object -ComObject Excel.Application; $app.Visible=$false; $app.DisplayAlerts=$false; "
            "try {$book=$app.Workbooks.Open($src); $book.ExportAsFixedFormat(0,$dst)} "
            "finally {if($book){$book.Close($false)}; $app.Quit()}"
        )
    elif suffix in POWERPOINT_EXTENSIONS:
        body = (
            "$app=New-Object -ComObject PowerPoint.Application; "
            "try {$deck=$app.Presentations.Open($src,$true,$false,$false); $deck.SaveAs($dst,32)} "
            "finally {if($deck){$deck.Close()}; $app.Quit()}"
        )
    else:
        raise OperationError(f"No Microsoft Office PDF backend for {source.suffix}")

    script = f"$src=$args[0]; $dst=$args[1]; $ErrorActionPreference='Stop'; {body}"
    subprocess.run(
        [powershell, "-NoProfile", "-NonInteractive", "-Command", script, str(source.resolve()), str(output.resolve())],
        check=True,
        timeout=120,
        capture_output=True,
        text=True,
    )
    if not output.exists():
        raise OperationError("Microsoft Office did not produce a PDF")
    return output


def office_to_pdf(files: list[Path], output: Path, options: dict) -> Path:
    return _office_to_pdf(files, output, OFFICE_EXTENSIONS, "supported Office")


def word_to_pdf(files: list[Path], output: Path, options: dict) -> Path:
    return _office_to_pdf(files, output, WORD_EXTENSIONS, "Word")


def excel_to_pdf(files: list[Path], output: Path, options: dict) -> Path:
    return _office_to_pdf(files, output, EXCEL_EXTENSIONS, "Excel")


def powerpoint_to_pdf(files: list[Path], output: Path, options: dict) -> Path:
    return _office_to_pdf(files, output, POWERPOINT_EXTENSIONS, "PowerPoint")


def ocr_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    ocrmypdf = resolve_binary("ocrmypdf")
    language = options.get("language") or "eng"
    subprocess.run([ocrmypdf, "-l", language, "--skip-text", str(source), str(output)], check=True)
    return output


def flatten_edits(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    annotations = options.get("annotations") or {}
    pages = annotations.get("pages") if isinstance(annotations, dict) else None
    if not isinstance(pages, list):
        raise OperationError("Invalid annotation document")

    document = fitz.open(source)
    try:
        for page_data in pages:
            page_index = int(page_data.get("page", 0))
            if page_index < 0 or page_index >= len(document):
                raise OperationError("Annotation references a missing page")
            page = document[page_index]
            objects = page_data.get("objects") or []

            for item in objects:
                if item.get("type") == "text" and item.get("erase", True):
                    page.add_redact_annot(normalized_rect(page, item), fill=(1, 1, 1))
            if any(item.get("type") == "text" and item.get("erase", True) for item in objects):
                page.apply_redactions()

            for item in objects:
                draw_annotation(page, item)
        document.save(output, garbage=4, deflate=True)
    finally:
        document.close()
    return output


def draw_annotation(page, item: dict) -> None:
    kind = item.get("type")
    color = html_color(item.get("color", "#111827"))
    opacity = min(max(float(item.get("opacity", 1)), 0), 1)
    if kind == "text":
        rect = normalized_rect(page, item)
        fontsize = max(float(item.get("font_size", 16)) * page.rect.width / float(item.get("viewport_width") or page.rect.width), 6)
        page.insert_textbox(rect, str(item.get("text", "")), fontsize=fontsize, fontname="helv", color=color)
    elif kind in {"rectangle", "highlight"}:
        rect = normalized_rect(page, item)
        fill = html_color(item.get("fill", "#fde047")) if item.get("fill") else None
        page.draw_rect(
            rect,
            color=color if kind == "rectangle" else None,
            fill=fill,
            width=max(float(item.get("stroke_width", 2)), 0.5),
            stroke_opacity=opacity,
            fill_opacity=opacity,
        )
    elif kind == "circle":
        rect = normalized_rect(page, item)
        fill = html_color(item.get("fill")) if item.get("fill") else None
        page.draw_oval(
            rect,
            color=color,
            fill=fill,
            width=max(float(item.get("stroke_width", 2)), 0.5),
            stroke_opacity=opacity,
            fill_opacity=opacity,
        )
    elif kind == "path":
        points = item.get("points") or []
        if len(points) > 1:
            shape = page.new_shape()
            for first, second in zip(points, points[1:]):
                shape.draw_line(normalized_point(page, first), normalized_point(page, second))
            shape.finish(color=color, width=max(float(item.get("stroke_width", 2)), 0.5), stroke_opacity=opacity)
            shape.commit()
    elif kind == "signature":
        rect = normalized_rect(page, item)
        image_bytes = decode_data_url(item.get("image", ""))
        if image_bytes:
            page.insert_image(rect, stream=image_bytes, keep_proportion=True, overlay=True)
        signer = str(item.get("signer_name", "")).strip()
        signed_at = str(item.get("signed_at", "")).strip()
        if signer:
            stamp = fitz.Rect(rect.x0, rect.y1 + 2, rect.x1, min(rect.y1 + 24, page.rect.height))
            page.insert_textbox(stamp, f"Signed by {signer} on {signed_at}", fontsize=7, fontname="helv", color=(0.18, 0.22, 0.28))


def normalized_rect(page, item: dict):
    x = float(item.get("x", 0)) * page.rect.width
    y = float(item.get("y", 0)) * page.rect.height
    width = max(float(item.get("width", 0)) * page.rect.width, 1)
    height = max(float(item.get("height", 0)) * page.rect.height, 1)
    return fitz.Rect(x, y, min(x + width, page.rect.width), min(y + height, page.rect.height))


def normalized_point(page, point):
    return fitz.Point(float(point[0]) * page.rect.width, float(point[1]) * page.rect.height)


def html_color(value: str):
    value = value.lstrip("#")
    if len(value) != 6:
        return (0.07, 0.09, 0.13)
    try:
        return tuple(int(value[index:index + 2], 16) / 255 for index in (0, 2, 4))
    except ValueError:
        return (0.07, 0.09, 0.13)


def decode_data_url(value: str) -> bytes | None:
    if not value.startswith("data:image/") or "," not in value:
        return None
    try:
        return base64.b64decode(value.split(",", 1)[1], validate=True)
    except (ValueError, TypeError):
        return None


def resolve_binary(*names: str) -> str:
    for name in names:
        path = shutil.which(name)
        if path:
            return path
        if os.name == "nt":
            for extension in (".com", ".exe", ".bat", ".cmd"):
                path = shutil.which(f"{name}{extension}")
                if path:
                    return path

    if os.name == "nt":
        roots = [
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
            Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
        ]
        candidates = []
        for root in roots:
            candidates.extend(
                [
                    root / "LibreOffice" / "program" / "soffice.com",
                    root / "LibreOffice" / "program" / "soffice.exe",
                    root / "Tesseract-OCR" / "tesseract.exe",
                ]
            )
            candidates.extend(root.glob("gs/gs*/bin/gswin64c.exe"))
            candidates.extend(root.glob("gs/gs*/bin/gswin32c.exe"))
        requested = {name.lower() for name in names}
        for candidate in candidates:
            if candidate.exists() and candidate.stem.lower() in requested:
                return str(candidate)
    raise OperationError(f"Missing system dependency: one of {', '.join(names)}")


def ensure_pdf(path: Path) -> None:
    if path.suffix.lower() not in PDF_EXTENSIONS:
        raise OperationError(f"{path.name} is not a PDF")


def single_file(files: list[Path]) -> Path:
    if len(files) != 1:
        raise OperationError("This operation requires exactly one file")
    return files[0]


def single_pdf(files: list[Path]) -> Path:
    source = single_file(files)
    ensure_pdf(source)
    return source


def parse_page_spec(spec: str, page_count: int) -> list[int]:
    pages: list[int] = []
    for raw_part in spec.replace(" ", "").split(","):
        if not raw_part:
            continue
        if "-" in raw_part:
            start_text, end_text = raw_part.split("-", 1)
            start = int(start_text)
            end = int(end_text)
            step = 1 if end >= start else -1
            pages.extend(range(start, end + step, step))
        else:
            pages.append(int(raw_part))
    for page_number in pages:
        if page_number < 1 or page_number > page_count:
            raise OperationError(f"Page {page_number} is outside the document")
    return pages


OPERATIONS = {
    "edit": ("edited.pdf", flatten_edits),
    "merge": ("merged.pdf", merge_pdfs),
    "split": ("split_pages.zip", split_pdf),
    "delete_pages": ("pages_deleted.pdf", delete_pages),
    "reorder_pages": ("reordered.pdf", reorder_pages),
    "rotate": ("rotated.pdf", rotate_pdf),
    "crop": ("cropped.pdf", crop_pdf),
    "compress": ("compressed.pdf", compress_pdf),
    "protect": ("protected.pdf", protect_pdf),
    "unlock": ("unlocked.pdf", unlock_pdf),
    "watermark": ("watermarked.pdf", watermark_pdf),
    "remove_watermark": ("watermark_removed.pdf", remove_watermark_pdf),
    "page_numbers": ("page_numbers.pdf", page_numbers_pdf),
    "extract_images": ("extracted_images.zip", extract_images),
    "images_to_pdf": ("images.pdf", images_to_pdf),
    "pdf_to_images": ("pdf_images.zip", pdf_to_images),
    "pdf_to_word": ("converted.docx", pdf_to_word),
    "pdf_to_excel": ("converted.xlsx", pdf_to_excel),
    "pdf_to_powerpoint": ("converted.pptx", pdf_to_powerpoint),
    "office_to_pdf": ("converted.pdf", office_to_pdf),
    "word_to_pdf": ("converted.pdf", word_to_pdf),
    "excel_to_pdf": ("converted.pdf", excel_to_pdf),
    "powerpoint_to_pdf": ("converted.pdf", powerpoint_to_pdf),
    "ocr": ("searchable.pdf", ocr_pdf),
}
