import hashlib
import re
import shutil
import subprocess
from pathlib import Path

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import Job, SignatureAuditLog
from .operations import OperationError, run_operation


@shared_task
def process_job(job_id: str) -> None:
    job = Job.objects.get(id=job_id)
    job.status = Job.Status.RUNNING
    job.error = ""
    job.save(update_fields=["status", "error", "updated_at"])

    job_dir = Path(settings.MEDIA_ROOT) / "jobs" / str(job.id)
    input_dir = job_dir / "input"
    output_dir = job_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(path for path in input_dir.iterdir() if path.is_file())

    try:
        result = run_operation(job.operation, files, output_dir, job.options)
        if job.operation == "edit":
            append_signature_audits(job, files[0], result)
    except (OperationError, subprocess.CalledProcessError, OSError, ValueError) as exc:
        job.status = Job.Status.FAILED
        job.error = str(exc)
        job.save(update_fields=["status", "error", "updated_at"])
        return

    job.status = Job.Status.DONE
    job.result_name = build_result_name(files[0].name if files else "file", result)
    job.result_path = str(result.relative_to(settings.MEDIA_ROOT))
    job.save(update_fields=["status", "result_name", "result_path", "updated_at"])


def build_result_name(original_filename: str, result: Path) -> str:
    stem = Path(re.sub(r"^\d{3}_", "", original_filename)).stem
    return f"{stem}_nfiu-pdf{result.suffix}"


def append_signature_audits(job: Job, source: Path, result: Path) -> None:
    annotations = job.options.get("annotations") or {}
    signatures = [
        item
        for page in annotations.get("pages", [])
        for item in page.get("objects", [])
        if item.get("type") == "signature"
    ]
    if not signatures:
        return
    audit_context = job.options.get("audit_context") or {}
    input_hash = sha256_file(source)
    output_hash = sha256_file(result)
    previous = SignatureAuditLog.objects.order_by("-created_at", "-pk").first()
    previous_hash = previous.entry_hash if previous else ""
    for signature in signatures:
        signed_at = timezone.now()
        log = SignatureAuditLog(
            job=job,
            signer_name=str(signature.get("signer_name") or job.options.get("signer_name") or "Unknown signer")[:255],
            signer_email=str(signature.get("signer_email") or job.options.get("signer_email") or "")[:254],
            ip_address=audit_context.get("ip_address"),
            user_agent=str(audit_context.get("user_agent") or ""),
            signed_at=signed_at,
            input_sha256=input_hash,
            output_sha256=output_hash,
            previous_hash=previous_hash,
        )
        log.save()
        previous_hash = log.entry_hash


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@shared_task
def cleanup_old_jobs() -> int:
    cutoff = timezone.now() - timezone.timedelta(minutes=settings.JOB_RETENTION_MINUTES)
    old_jobs = Job.objects.filter(created_at__lt=cutoff)
    count = 0
    for job in old_jobs:
        job_dir = Path(settings.MEDIA_ROOT) / "jobs" / str(job.id)
        shutil.rmtree(job_dir, ignore_errors=True)
        job.delete()
        count += 1
    return count
