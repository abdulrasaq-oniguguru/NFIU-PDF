import json
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .models import AnnotationLayer, Job
from .tasks import process_job

OPERATION_GROUPS = [
    {
        "name": "Core PDF",
        "operations": [
            {"id": "merge", "label": "Merge PDF", "multiple": True},
            {"id": "split", "label": "Split PDF", "multiple": False},
            {"id": "delete_pages", "label": "Delete Pages", "multiple": False},
            {"id": "reorder_pages", "label": "Reorder Pages", "multiple": False},
            {"id": "rotate", "label": "Rotate PDF", "multiple": False},
            {"id": "crop", "label": "Crop PDF", "multiple": False},
        ],
    },
    {
        "name": "Security",
        "operations": [
            {"id": "protect", "label": "Lock PDF", "multiple": False},
            {"id": "unlock", "label": "Unlock PDF", "multiple": False},
        ],
    },
    {
        "name": "Optimize",
        "operations": [
            {"id": "compress", "label": "Compress PDF", "multiple": False},
        ],
    },
    {
        "name": "From PDF",
        "operations": [
            {"id": "pdf_to_word", "label": "PDF to Word", "multiple": False},
            {"id": "pdf_to_excel", "label": "PDF to Excel", "multiple": False},
            {"id": "pdf_to_powerpoint", "label": "PDF to PowerPoint", "multiple": False},
            {"id": "pdf_to_images", "label": "PDF to Images", "multiple": False},
            {"id": "extract_images", "label": "Extract Images", "multiple": False},
        ],
    },
    {
        "name": "To PDF",
        "operations": [
            {"id": "office_to_pdf", "label": "Office to PDF", "multiple": False},
            {"id": "images_to_pdf", "label": "Images to PDF", "multiple": True},
        ],
    },
    {
        "name": "Editing",
        "operations": [
            {"id": "edit", "label": "Edit & Sign PDF", "multiple": False},
            {"id": "watermark", "label": "Watermark", "multiple": False},
            {"id": "page_numbers", "label": "Page Numbers", "multiple": False},
        ],
    },
    {
        "name": "OCR",
        "operations": [
            {"id": "ocr", "label": "OCR Searchable PDF", "multiple": False},
        ],
    },
]
OPERATIONS = [operation for group in OPERATION_GROUPS for operation in group["operations"]]


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
    if not files:
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
        "annotations", "signer_name", "signer_email",
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
