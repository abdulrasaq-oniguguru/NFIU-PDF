import base64
import shutil
import subprocess
import zipfile
from pathlib import Path

import fitz
from openpyxl import Workbook
from pdf2docx import Converter
from pptx import Presentation
from pptx.util import Inches
from pypdf import PdfReader, PdfWriter

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
    order = parse_page_spec(options.get("pages") or "", len(reader.pages))
    if not order:
        raise OperationError("Enter the new page order")
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
    margin = max(float(options.get("margin") or 0), 0)
    reader = PdfReader(str(source))
    writer = PdfWriter()
    for page in reader.pages:
        page.cropbox.lower_left = (float(page.cropbox.left) + margin, float(page.cropbox.bottom) + margin)
        page.cropbox.upper_right = (float(page.cropbox.right) - margin, float(page.cropbox.top) - margin)
        writer.add_page(page)
    with output.open("wb") as handle:
        writer.write(handle)
    return output


def compress_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    ghostscript = resolve_binary("gs", "gswin64c", "gswin32c")
    quality = options.get("quality") or "ebook"
    if quality not in {"screen", "ebook", "printer", "prepress", "default"}:
        quality = "ebook"
    subprocess.run(
        [
            ghostscript,
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            f"-dPDFSETTINGS=/{quality}",
            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH",
            f"-sOutputFile={output}",
            str(source),
        ],
        check=True,
    )
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
        page.insert_textbox(
            rect,
            text,
            fontsize=max(min(rect.width, rect.height) / 12, 24),
            fontname="helv",
            color=(0.45, 0.45, 0.45),
            align=fitz.TEXT_ALIGN_CENTER,
            rotate=45,
            fill_opacity=0.18,
        )
    document.save(output)
    document.close()
    return output


def page_numbers_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_pdf(files)
    document = fitz.open(source)
    total = len(document)
    for index, page in enumerate(document, start=1):
        rect = page.rect
        page.insert_textbox(
            fitz.Rect(0, rect.height - 34, rect.width, rect.height - 12),
            f"{index} / {total}",
            fontsize=10,
            fontname="helv",
            color=(0.1, 0.12, 0.16),
            align=fitz.TEXT_ALIGN_CENTER,
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


def office_to_pdf(files: list[Path], output: Path, options: dict) -> Path:
    source = single_file(files)
    if source.suffix.lower() not in OFFICE_EXTENSIONS:
        raise OperationError(f"{source.name} is not an Office document")
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
    "page_numbers": ("page_numbers.pdf", page_numbers_pdf),
    "extract_images": ("extracted_images.zip", extract_images),
    "images_to_pdf": ("images.pdf", images_to_pdf),
    "pdf_to_images": ("pdf_images.zip", pdf_to_images),
    "pdf_to_word": ("converted.docx", pdf_to_word),
    "pdf_to_excel": ("converted.xlsx", pdf_to_excel),
    "pdf_to_powerpoint": ("converted.pptx", pdf_to_powerpoint),
    "office_to_pdf": ("converted.pdf", office_to_pdf),
    "ocr": ("searchable.pdf", ocr_pdf),
}
