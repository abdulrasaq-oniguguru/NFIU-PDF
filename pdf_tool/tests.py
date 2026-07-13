import json
import base64
from pathlib import Path
from tempfile import TemporaryDirectory

import fitz
from django.http import QueryDict
from django.test import TestCase
from django.utils import timezone

from .models import Job, SignatureAuditLog
from .operations import flatten_edits, remove_watermark_pdf, watermark_pdf
from .views import read_options


class WatermarkTests(TestCase):
    def test_read_options_keeps_watermark_formatting(self):
        expected = {
            "watermark_font": "times",
            "watermark_size": "72",
            "watermark_bold": "true",
            "watermark_italic": "true",
            "watermark_underline": "true",
            "watermark_color": "#ff0000",
            "watermark_position": "bottom-right",
            "watermark_mosaic": "true",
            "watermark_transparency": "0.5",
            "watermark_rotation": "0",
            "watermark_from_page": "1",
            "watermark_to_page": "2",
            "watermark_layer": "under",
        }
        post = QueryDict(mutable=True)
        post["options"] = json.dumps(expected)
        self.assertEqual(read_options(post), expected)

    def test_watermark_pdf_applies_size_color_and_font(self):
        with TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            output = Path(directory) / "watermarked.pdf"
            document = fitz.open()
            document.new_page(width=595, height=842)
            document.save(source)
            document.close()

            watermark_pdf(
                [source],
                output,
                {
                    "text": "FORMATTED",
                    "watermark_font": "times",
                    "watermark_size": "72",
                    "watermark_bold": "true",
                    "watermark_italic": "true",
                    "watermark_color": "#ff0000",
                    "watermark_transparency": "1",
                    "watermark_rotation": "-45",
                },
            )

            with fitz.open(output) as result:
                lines = [
                    line
                    for block in result[0].get_text("dict")["blocks"]
                    for line in block.get("lines", [])
                    if any(span.get("text") == "FORMATTED" for span in line.get("spans", []))
                ]
                spans = [span for line in lines for span in line["spans"] if span.get("text") == "FORMATTED"]
                self.assertEqual(len(spans), 1)
                self.assertAlmostEqual(spans[0]["size"], 72, places=1)
                self.assertEqual(spans[0]["color"] & 0xFFFFFF, 0xFF0000)
                self.assertIn("Times", spans[0]["font"])
                self.assertLess(lines[0]["dir"][1], 0)

    def test_removes_diagonal_watermark_from_only_one_page(self):
        with TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            watermarked = Path(directory) / "watermarked.pdf"
            output = Path(directory) / "removed.pdf"
            document = fitz.open()
            for page_number in (1, 2):
                page = document.new_page(width=595, height=842)
                page.insert_text((72, 72), f"ORIGINAL PAGE {page_number}")
            document.save(source)
            document.close()

            watermark_pdf(
                [source],
                watermarked,
                {
                    "text": "CONFIDENTIAL",
                    "watermark_size": "72",
                    "watermark_rotation": "-45",
                    "watermark_from_page": "1",
                    "watermark_to_page": "1",
                },
            )
            remove_watermark_pdf([watermarked], output, {})

            with fitz.open(output) as result:
                text = "\n".join(page.get_text() for page in result)
                self.assertNotIn("CONFIDENTIAL", text)
                self.assertIn("ORIGINAL PAGE 1", text)
                self.assertIn("ORIGINAL PAGE 2", text)

    def test_removes_legacy_standalone_stream_without_redacting_content(self):
        with TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            watermarked = Path(directory) / "watermarked.pdf"
            legacy = Path(directory) / "legacy.pdf"
            output = Path(directory) / "removed.pdf"
            document = fitz.open()
            page = document.new_page(width=595, height=842)
            page.insert_text((190, 421), "PRESERVE UNDER WATERMARK", fontsize=20)
            document.save(source)
            document.close()

            watermark_pdf(
                [source],
                watermarked,
                {
                    "text": "CONFIDENTIAL",
                    "watermark_size": "72",
                    "watermark_rotation": "-45",
                },
            )
            with fitz.open(watermarked) as document:
                document.xref_set_key(document[0].xref, "NFIUWatermarkStreams", "null")
                document.save(legacy)

            remove_watermark_pdf([legacy], output, {})

            with fitz.open(output) as result:
                text = result[0].get_text()
                self.assertNotIn("CONFIDENTIAL", text)
                self.assertIn("PRESERVE UNDER WATERMARK", text)


class FlattenEditsTests(TestCase):
    def test_replaces_existing_text_using_original_text_bounds(self):
        with TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            output = Path(directory) / "edited.pdf"
            document = fitz.open()
            page = document.new_page(width=300, height=400)
            page.insert_text((30, 60), "THIS ORIGINAL PHRASE MUST DISAPPEAR", fontsize=12)
            document.save(source)
            document.close()

            flatten_edits(
                [source],
                output,
                {
                    "annotations": {
                        "pages": [{
                            "page": 0,
                            "objects": [{
                                "type": "text", "x": 0.1, "y": 0.1, "width": 0.4, "height": 0.05,
                                "erase": True, "erase_x": 0.09, "erase_y": 0.09,
                                "erase_width": 0.82, "erase_height": 0.09,
                                "text": "REPLACED", "font_size": 12, "viewport_width": 300,
                            }],
                        }],
                    },
                },
            )

            with fitz.open(output) as result:
                text = result[0].get_text()
                self.assertNotIn("ORIGINAL PHRASE", text)
                self.assertIn("REPLACED", text)

    def test_flattens_text_shape_and_path(self):
        with TemporaryDirectory() as directory:
            source = Path(directory) / "source.pdf"
            output = Path(directory) / "edited.pdf"
            document = fitz.open()
            document.new_page(width=300, height=400)
            document.save(source)
            document.close()
            pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 12, 12), False)
            pixmap.clear_with(0xD92D20)
            image_data = "data:image/png;base64," + base64.b64encode(pixmap.tobytes("png")).decode("ascii")

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
                                {"type": "line", "x": 0.1, "y": 0.65, "width": 0.3, "height": 0.02, "color": "#d92d20", "stroke_width": 3},
                                {"type": "arrow", "x": 0.5, "y": 0.65, "width": 0.3, "height": 0.08, "color": "#176b47", "stroke_width": 3},
                                {"type": "stamp", "x": 0.1, "y": 0.72, "width": 0.3, "height": 0.08, "text": "APPROVED", "color": "#176b47"},
                                {"type": "image", "x": 0.5, "y": 0.72, "width": 0.15, "height": 0.1, "image": image_data},
                                {"type": "signature_field", "x": 0.1, "y": 0.84, "width": 0.4, "height": 0.08, "field_name": "ApprovalSignature"},
                            ],
                        }],
                    },
                },
            )

            with fitz.open(output) as result:
                self.assertEqual(len(result), 1)
                self.assertIn("Approved", result[0].get_text())
                self.assertIn("APPROVED", result[0].get_text())
                self.assertEqual([widget.field_name for widget in result[0].widgets()], ["ApprovalSignature"])


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
