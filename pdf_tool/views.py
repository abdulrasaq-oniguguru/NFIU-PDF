import json
from pathlib import Path

import fitz
from django.conf import settings
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .models import AnnotationLayer, Job
from .operations import build_image_thumbnail, iter_pdf_images
from .tasks import process_job

OPERATION_GROUPS = [
    {
        "name": "Organize PDF",
        "operations": [
            {"id": "merge", "label": "Merge PDF", "multiple": True, "description": "Combine PDFs in the order you want with the easiest PDF merger available."},
            {"id": "split", "label": "Split PDF", "multiple": False, "description": "Separate one page or a whole set for easy conversion into independent PDF files."},
            {"id": "delete_pages", "label": "Delete Pages", "multiple": False, "description": "Remove unwanted pages from a PDF document in a few clicks."},
            {"id": "reorder_pages", "label": "Reorder Pages", "multiple": False, "description": "Sort pages of your PDF file however you like."},
            {"id": "crop", "label": "Crop PDF", "multiple": False, "description": "Crop margins of PDF documents or select specific areas, then apply the changes."},
        ],
    },
    {
        "name": "Optimize PDF",
        "operations": [
            {"id": "compress", "label": "Compress PDF", "multiple": False, "description": "Reduce file size while optimizing for maximal PDF quality."},
            {"id": "ocr", "label": "OCR PDF", "multiple": False, "description": "Easily convert scanned PDF into searchable and selectable documents."},
        ],
    },
    {
        "name": "Convert PDF",
        "operations": [
            {"id": "pdf_to_word", "label": "PDF to Word", "multiple": False, "description": "Convert your PDF files into easy to edit DOC and DOCX documents."},
            {"id": "word_to_pdf", "label": "Word to PDF", "multiple": False, "description": "Make DOC and DOCX files easy to read by converting them to PDF."},
            {"id": "pdf_to_excel", "label": "PDF to Excel", "multiple": False, "description": "Pull data straight from PDFs into Excel spreadsheets in a few short seconds."},
            {"id": "excel_to_pdf", "label": "Excel to PDF", "multiple": False, "description": "Make Excel spreadsheets easy to read by converting them to PDF."},
            {"id": "pdf_to_powerpoint", "label": "PDF to PowerPoint", "multiple": False, "description": "Turn your PDF files into easy to edit PPT and PPTX slideshows."},
            {"id": "powerpoint_to_pdf", "label": "PowerPoint to PDF", "multiple": False, "description": "Make PPT and PPTX slideshows easy to view by converting them to PDF."},
            {"id": "html_to_pdf", "label": "HTML to PDF", "multiple": False, "description": "Turn a public webpage into a polished PDF with precise page and screen controls."},
            {"id": "pdf_to_images", "label": "PDF to JPG", "multiple": False, "description": "Convert each PDF page into a JPG or extract all images contained in a PDF."},
            {"id": "images_to_pdf", "label": "JPG to PDF", "multiple": True, "description": "Convert JPG images to PDF in seconds."},
            {"id": "extract_images", "label": "Extract Images", "multiple": False, "description": "Pull every embedded image out of a PDF into a downloadable archive."},
        ],
    },
    {
        "name": "Edit PDF",
        "operations": [
            {"id": "edit", "label": "Edit & Sign PDF", "multiple": False, "description": "Add text, images, shapes or freehand annotations to a PDF document, or sign it."},
            {"id": "watermark", "label": "Watermark", "multiple": False, "description": "Stamp text over your PDF in seconds. Choose the typography, transparency and position."},
            {"id": "remove_watermark", "label": "Remove Watermark", "multiple": False, "description": "Detect and strip repeated diagonal text or stamped images from a PDF, from this tool or others."},
            {"id": "page_numbers", "label": "Page Numbers", "multiple": False, "description": "Add page numbers into PDFs with ease."},
            {"id": "rotate", "label": "Rotate PDF", "multiple": False, "description": "Rotate your PDFs the way you need them."},
        ],
    },
    {
        "name": "PDF Security",
        "operations": [
            {"id": "protect", "label": "Protect PDF", "multiple": False, "description": "Protect PDF files with a password. Encrypt PDF documents to prevent unauthorized access."},
            {"id": "unlock", "label": "Unlock PDF", "multiple": False, "description": "Remove PDF password security, giving you the freedom to use your PDFs as you want."},
        ],
    },
]
OPERATIONS = [operation for group in OPERATION_GROUPS for operation in group["operations"]]


@ensure_csrf_cookie
def home(request):
    return render(
        request,
        "pdf_tool/home.html",
        {
            "operation_groups": OPERATION_GROUPS,
            "operations": OPERATIONS,
            "operation_groups_json": json.dumps(OPERATION_GROUPS),
            "operations_json": json.dumps(OPERATIONS),
        },
    )


@require_POST
def create_job(request):
    operation = request.POST.get("operation", "")
    if operation not in {item["id"] for item in OPERATIONS}:
        return JsonResponse({"error": "Unknown operation"}, status=400)
    files = request.FILES.getlist("files")
    if not files and operation != "html_to_pdf":
        return JsonResponse({"error": "Upload at least one file"}, status=400)

    options = read_options(request.POST)
    if operation == "edit":
        stamp_signatures(options)
        options["audit_context"] = {
            "ip_address": get_client_ip(request),
            "user_agent": request.META.get("HTTP_USER_AGENT", "")[:2000],
        }
    job = Job.objects.create(operation=operation, options=options)
    if operation == "edit":
        AnnotationLayer.objects.create(job=job, document=options.get("annotations", {}))
    input_dir = Path(settings.MEDIA_ROOT) / "jobs" / str(job.id) / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    for index, uploaded in enumerate(files, start=1):
        safe_name = Path(uploaded.name).name
        target = input_dir / f"{index:03d}_{safe_name}"
        with target.open("wb+") as destination:
            for chunk in uploaded.chunks():
                destination.write(chunk)

    process_job.delay(str(job.id))
    return JsonResponse({"id": str(job.id), "status": job.status})


@require_POST
def preview_extract_images(request):
    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"error": "Upload a PDF file"}, status=400)
    try:
        document = fitz.open(stream=uploaded.read(), filetype="pdf")
    except Exception:
        return JsonResponse({"error": "Could not read this PDF"}, status=400)
    images = []
    for entry in iter_pdf_images(document):
        thumbnail = build_image_thumbnail(entry["data"])
        if thumbnail is None:
            continue
        images.append(
            {
                "id": entry["id"],
                "page": entry["page"],
                "index": entry["index"],
                "ext": entry["ext"],
                "width": entry["width"],
                "height": entry["height"],
                "thumbnail": thumbnail,
            }
        )
    document.close()
    return JsonResponse({"images": images})


@require_GET
def job_status(request, job_id):
    job = get_object_or_404(Job, id=job_id)
    payload = {
        "id": str(job.id),
        "operation": job.operation,
        "status": job.status,
        "error": job.error,
        "result_name": job.result_name,
    }
    if job.status == Job.Status.DONE:
        payload["download_url"] = request.build_absolute_uri(f"/jobs/{job.id}/download/")
    return JsonResponse(payload)


@require_GET
def download_job(request, job_id):
    job = get_object_or_404(Job, id=job_id, status=Job.Status.DONE)
    result_path = Path(settings.MEDIA_ROOT) / job.result_path
    if not result_path.exists():
        raise Http404("Result file was cleaned up")
    return FileResponse(result_path.open("rb"), as_attachment=True, filename=job.result_name)


def read_options(post_data) -> dict:
    raw = post_data.get("options") or "{}"
    try:
        options = json.loads(raw)
    except json.JSONDecodeError:
        options = {}
    allowed = {
        "password", "degrees", "quality", "text", "every", "dpi", "language", "pages", "margin",
        "annotations", "signer_name", "signer_email", "crop", "keep_remaining", "selected_images",
        "page_number_position", "page_number_start", "page_number_format", "page_number_custom",
        "page_number_margin", "page_number_mode", "page_number_font", "page_number_size",
        "page_number_bold", "page_number_italic", "page_number_underline", "page_number_color",
        "url", "screen_width", "page_size", "orientation", "one_long_page", "print_background",
    }
    return {key: value for key, value in options.items() if key in allowed}


def get_client_ip(request) -> str | None:
    value = request.META.get("REMOTE_ADDR")
    return value or None


def stamp_signatures(options: dict) -> None:
    signed_at = timezone.now().isoformat()
    annotations = options.get("annotations") or {}
    for page in annotations.get("pages", []):
        for item in page.get("objects", []):
            if item.get("type") == "signature":
                item["signed_at"] = signed_at
