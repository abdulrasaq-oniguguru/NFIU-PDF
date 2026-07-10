import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("pdf_tool", "0001_initial")]

    operations = [
        migrations.CreateModel(
            name="AnnotationLayer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("document", models.JSONField(default=dict)),
                ("revision", models.PositiveIntegerField(default=1)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("job", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="annotation_layer", to="pdf_tool.job")),
            ],
        ),
        migrations.CreateModel(
            name="SignatureAuditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("signer_name", models.CharField(max_length=255)),
                ("signer_email", models.EmailField(blank=True, max_length=254)),
                ("ip_address", models.GenericIPAddressField(blank=True, null=True)),
                ("user_agent", models.TextField(blank=True)),
                ("signed_at", models.DateTimeField()),
                ("input_sha256", models.CharField(max_length=64)),
                ("output_sha256", models.CharField(max_length=64)),
                ("previous_hash", models.CharField(blank=True, max_length=64)),
                ("entry_hash", models.CharField(editable=False, max_length=64, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("job", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="signature_audit_logs", to="pdf_tool.job")),
            ],
            options={"ordering": ["created_at", "pk"]},
        ),
    ]
