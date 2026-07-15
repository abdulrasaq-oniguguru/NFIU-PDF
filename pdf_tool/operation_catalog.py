"""Human-readable labels for operation slugs, shared by the Job/JobAuditRecord
admin (dropdown filters, list display) so they don't show raw snake_case ids.
Keep in sync with the operation ids/labels in views.OPERATION_GROUPS.
"""

OPERATION_LABELS = {
    "merge": "Merge PDF",
    "split": "Split PDF",
    "delete_pages": "Delete Pages",
    "reorder_pages": "Reorder Pages",
    "crop": "Crop PDF",
    "compress": "Compress PDF",
    "ocr": "OCR PDF",
    "pdf_to_word": "PDF to Word",
    "word_to_pdf": "Word to PDF",
    "pdf_to_excel": "PDF to Excel",
    "excel_to_pdf": "Excel to PDF",
    "pdf_to_powerpoint": "PDF to PowerPoint",
    "powerpoint_to_pdf": "PowerPoint to PDF",
    "html_to_pdf": "HTML to PDF",
    "pdf_to_images": "PDF to JPG",
    "images_to_pdf": "JPG to PDF",
    "extract_images": "Extract Images",
    "edit": "Edit & Sign PDF",
    "watermark": "Watermark",
    "page_numbers": "Page Numbers",
    "rotate": "Rotate PDF",
    "protect": "Protect PDF",
    "unlock": "Unlock PDF",
    "remove_watermark": "Remove Watermark",
}

OPERATION_CHOICES = tuple(OPERATION_LABELS.items())
