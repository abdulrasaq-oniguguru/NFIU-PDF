from pathlib import Path
from tempfile import TemporaryDirectory

import fitz
from django.test import TestCase
from django.utils import timezone

from .models import Job, SignatureAuditLog
from .operations import flatten_edits


class FlattenEditsTests(TestCase):
    def test_flattens_text_shape_and_path(self):
        with TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            output = Path(directory) / "edited.pdf"
            document = fitz.open()
            document.new_page(width=300, height=400)
            document.save(source)
            document.close()

            flatten_edits(
                [source],
                output,
                {
                    "annotations": {
                        "pages": [{
                            "page": 0,
                            "objects": [
                                {"type": "text", "x": 0.1, "y": 0.1, "width": 0.5, "height": 0.1, "text": "Approved", "font_size": 18, "viewport_width": 300},
                                {"type": "highlight", "x": 0.1, "y": 0.3, "width": 0.5, "height": 0.05, "fill": "#fde047", "opacity": 0.4},
                                {"type": "path", "points": [[0.1, 0.5], [0.5, 0.6]], "color": "#d92d20", "stroke_width": 3},
                            ],
                        }],
                    },
                },
            )

            result = fitz.open(output)
            self.assertEqual(len(result), 1)
            self.assertIn("Approved", result[0].get_text())
            result.close()


class SignatureAuditLogTests(TestCase):
    def test_audit_record_is_append_only(self):
        job = Job.objects.create(operation="edit")
        audit = SignatureAuditLog.objects.create(
            job=job,
            signer_name="A. Signer",
            signer_email="signer@example.com",
            ip_address="127.0.0.1",
            user_agent="test",
            signed_at=timezone.now(),
            input_sha256="a" * 64,
            output_sha256="b" * 64,
        )
        self.assertEqual(len(audit.entry_hash), 64)
        with self.assertRaises(ValueError):
            audit.save()
        with self.assertRaises(ValueError):
            audit.delete()
        with self.assertRaises(ValueError):
            SignatureAuditLog.objects.filter(pk=audit.pk).update(signer_name="Changed")
        with self.assertRaises(ValueError):
            SignatureAuditLog.objects.filter(pk=audit.pk).delete()
