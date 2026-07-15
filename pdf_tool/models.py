import hashlib
import json
import uuid

from django.db import models

from .operation_catalog import OPERATION_CHOICES


class AppendOnlyQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ValueError("Signature audit records cannot be updated")

    def delete(self):
        raise ValueError("Signature audit records cannot be deleted")


class Job(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    operation = models.CharField("Operation", max_length=64, choices=OPERATION_CHOICES)
    status = models.CharField("Status", max_length=16, choices=Status.choices, default=Status.QUEUED)
    options = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    original_filenames = models.TextField(blank=True)
    result_name = models.CharField(max_length=255, blank=True)
    result_path = models.CharField(max_length=500, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    mac_address = models.CharField(max_length=17, blank=True)
    user_agent = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.operation} {self.id} ({self.status})"


class JobAuditRecord(models.Model):
    """Permanent record of a job's outcome, kept after the job (and its files) are cleaned up.

    Deliberately does not store the document itself -- only hashes/sizes/metadata -- so we
    retain proof of what was processed without retaining the content.
    """

    job_id = models.UUIDField(db_index=True)
    operation = models.CharField("Operation", max_length=64, choices=OPERATION_CHOICES)
    status = models.CharField("Status", max_length=16, choices=Job.Status.choices)
    original_filenames = models.TextField(blank=True)
    input_files = models.JSONField(default=list, blank=True)
    output_sha256 = models.CharField(max_length=64, blank=True)
    output_size_bytes = models.BigIntegerField(null=True, blank=True)
    error = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    mac_address = models.CharField(max_length=17, blank=True)
    user_agent = models.TextField(blank=True)
    job_created_at = models.DateTimeField()
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-recorded_at"]

    def __str__(self) -> str:
        return f"{self.operation} {self.job_id} ({self.status})"


class AnnotationLayer(models.Model):
    job = models.OneToOneField(Job, on_delete=models.CASCADE, related_name="annotation_layer")
    document = models.JSONField(default=dict)
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class SignatureAuditLog(models.Model):
    objects = AppendOnlyQuerySet.as_manager()
    job = models.ForeignKey(Job, on_delete=models.PROTECT, related_name="signature_audit_logs")
    signer_name = models.CharField(max_length=255)
    signer_email = models.EmailField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    signed_at = models.DateTimeField()
    input_sha256 = models.CharField(max_length=64)
    output_sha256 = models.CharField(max_length=64)
    previous_hash = models.CharField(max_length=64, blank=True)
    entry_hash = models.CharField(max_length=64, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValueError("Signature audit records are append-only")
        payload = {
            "job": str(self.job_id),
            "signer_name": self.signer_name,
            "signer_email": self.signer_email,
            "ip_address": str(self.ip_address or ""),
            "user_agent": self.user_agent,
            "signed_at": self.signed_at.isoformat(),
            "input_sha256": self.input_sha256,
            "output_sha256": self.output_sha256,
            "previous_hash": self.previous_hash,
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        self.entry_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Signature audit records cannot be deleted")
