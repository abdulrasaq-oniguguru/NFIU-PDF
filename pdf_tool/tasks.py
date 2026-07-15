import hashlib
import re
import shutil
import traceback
from pathlib import Path

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded
from django.conf import settings
from django.core.mail import mail_admins
from django.db.models import ProtectedError
from django.utils import timezone

from .models import Job, JobAuditRecord, SignatureAuditLog
from .operations import OperationError, run_operation


@shared_task
def process_job(job_id: str) -> None:
    job = Job.objects.get(id=job_id)
    if job.status != Job.Status.QUEUED:
        return
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
    except SoftTimeLimitExceeded as exc:
        fail_job(
            job,
            files,
            input_dir,
            "Processing took too long and was stopped. Please try a smaller or simpler file.",
            exc,
        )
        return
    except OperationError as exc:
        # OperationError messages are written for end users -- show as-is.
        fail_job(job, files, input_dir, str(exc), exc)
        return
    except Exception as exc:
        # Catch everything else: any escaped exception (e.g. a pymupdf error
        # on a corrupt upload) would otherwise leave the job stuck in
        # "running" forever, with the client polling indefinitely and the
        # uploaded file stranded on disk. Raw messages can leak server paths,
        # so users get a generic message; the full detail is emailed to support.
        fail_job(
            job,
            files,
            input_dir,
            "Processing failed unexpectedly. The file may be corrupt, "
            "password-protected, or in an unsupported format.",
            exc,
        )
        return

    job.refresh_from_db()
    if job.status != Job.Status.RUNNING:
        # A watchdog has already marked this stale job as failed. Do not let a
        # late worker revive it or leave a result behind.
        shutil.rmtree(output_dir, ignore_errors=True)
        return
    job.status = Job.Status.DONE
    job.result_name = build_result_name(files[0].name if files else "file", result)
    job.result_path = str(result.relative_to(settings.MEDIA_ROOT))
    job.save(update_fields=["status", "result_name", "result_path", "updated_at"])
    record_job_audit(job, files, result)
    # The uploaded originals are only needed for processing and audit hashing,
    # both done by this point -- remove them so nothing the user sent stays on
    # disk. The output is removed by download_job the moment it is downloaded.
    shutil.rmtree(input_dir, ignore_errors=True)


def fail_job(job: Job, files: list[Path], input_dir: Path, user_error: str, exc: Exception) -> None:
    job.status = Job.Status.FAILED
    job.error = user_error or exc.__class__.__name__
    job.save(update_fields=["status", "error", "updated_at"])
    record_job_audit(job, files)
    shutil.rmtree(input_dir, ignore_errors=True)
    notify_support_of_failure(job, exc)


def notify_support_of_failure(job: Job, exc: Exception) -> None:
    """Email the support inbox about a failed job. fail_silently so a broken
    or unconfigured mail server can never take down job handling itself."""
    mail_admins(
        subject=f"NFIU-PDF job failed: {job.operation} ({job.id})",
        message=(
            f"Operation: {job.operation}\n"
            f"Job ID: {job.id}\n"
            f"Files: {job.original_filenames}\n"
            f"Client IP: {job.ip_address}\n"
            f"Created: {job.created_at}\n"
            f"Error shown to user: {job.error}\n"
            f"Actual error: {exc}\n\n"
            f"{traceback.format_exc()}"
        ),
        fail_silently=True,
    )


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


def record_job_audit(job: Job, files: list[Path], result: Path | None = None) -> None:
    JobAuditRecord.objects.create(
        job_id=job.id,
        operation=job.operation,
        status=job.status,
        original_filenames=job.original_filenames,
        input_files=[
            {"name": path.name, "size_bytes": path.stat().st_size, "sha256": sha256_file(path)}
            for path in files
        ],
        output_sha256=sha256_file(result) if result else "",
        output_size_bytes=result.stat().st_size if result else None,
        error=job.error,
        ip_address=job.ip_address,
        mac_address=job.mac_address,
        user_agent=job.user_agent,
        job_created_at=job.created_at,
    )


@shared_task
def cleanup_old_jobs() -> int:
    cutoff = timezone.now() - timezone.timedelta(minutes=settings.JOB_RETENTION_MINUTES)
    old_jobs = Job.objects.filter(created_at__lt=cutoff)
    count = 0
    for job in old_jobs:
        job_dir = Path(settings.MEDIA_ROOT) / "jobs" / str(job.id)
        shutil.rmtree(job_dir, ignore_errors=True)
        try:
            job.delete()
        except ProtectedError:
            continue
        count += 1
    return count


@shared_task
def expire_stalled_jobs() -> int:
    """Fail queued/running jobs that outlive the user-visible time limit."""
    cutoff = timezone.now() - timezone.timedelta(minutes=settings.JOB_MAX_PROCESSING_MINUTES)
    stalled_jobs = Job.objects.filter(
        status__in=[Job.Status.QUEUED, Job.Status.RUNNING],
        updated_at__lt=cutoff,
    )
    count = 0
    for job in stalled_jobs:
        job_dir = Path(settings.MEDIA_ROOT) / "jobs" / str(job.id)
        input_dir = job_dir / "input"
        files = sorted(path for path in input_dir.glob("*") if path.is_file())
        fail_job(
            job,
            files,
            input_dir,
            "Processing took too long and was stopped. Please try a smaller or simpler file.",
            TimeoutError("Job exceeded the maximum processing time"),
        )
        count += 1
    return count
