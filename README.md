# NFIU PDF

Private LAN-only PDF processing app inspired by tools like iLovePDF. Files are uploaded to your own server, processed locally, and stored only in per-job temporary folders.

## Features

- Merge, split, rotate, compress, lock, unlock, and watermark PDFs
- Convert PDF to Word
- Convert Office files to PDF
- Convert PDF pages to images
- Convert images to PDF
- OCR scanned PDFs into searchable PDFs
- Background processing with Celery and Redis
- Job cleanup task for sensitive-file retention

## Run With Docker

```bash
docker compose up --build
```

Open `http://127.0.0.1:8000`.

Then initialize the database once:

```bash
docker compose exec web python manage.py migrate
```

## Local Development

```bash
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

For full functionality outside Docker, install Ghostscript, Poppler, LibreOffice, Tesseract, and OCRmyPDF.

Run a worker in another terminal:

```bash
celery -A config worker -l INFO
```

## Sensitive Data Notes

- Keep this app behind your LAN/VPN and add Django authentication before exposing it broadly.
- Set `JOB_RETENTION_MINUTES` to control cleanup timing.
- Run `cleanup_old_jobs` periodically through Celery Beat, cron, or a scheduled task.
- Use a strong `DJANGO_SECRET_KEY` in production.

