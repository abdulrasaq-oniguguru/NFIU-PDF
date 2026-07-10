import hashlib
import json
import uuid

from django.db import models


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
    operation = models.CharField(max_length=64)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    options = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    result_name = models.CharField(max_length=255, blank=True)
    result_path = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.operation} {self.id} ({self.status})"


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
