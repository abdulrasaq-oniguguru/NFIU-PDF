# NFIU PDF

Private LAN-only PDF processing app inspired by tools like iLovePDF. Files are uploaded to your own server, processed locally, and stored only in per-job temporary folders.

## Features

- Merge, split, reorder, delete pages, rotate, crop, compress, lock, and unlock PDFs
- Watermark and remove watermark (heuristic detection of stamped text/images)
- Convert PDF to Word, Excel, and PowerPoint
- Convert Word, Excel, and PowerPoint to PDF
- Convert PDF pages to images and images to PDF
- Extract embedded images from a PDF
- Edit, annotate, and sign PDFs
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

Run a worker in another terminal:

```bash
celery -A config worker -l INFO
```

On Windows, use `celery -A config worker -l INFO --pool=solo` (the default prefork pool isn't supported).

### Full functionality without Docker

Compress, OCR, and Office↔PDF conversion shell out to Ghostscript, Tesseract/OCRmyPDF, and
LibreOffice respectively. These aren't Python packages and don't come from `requirements.txt` —
see **[DEPENDENCIES.md](DEPENDENCIES.md)** for install steps on Windows, Linux, and macOS,
verification commands, and troubleshooting. Docker installs all of this automatically; native
installs are only needed if you're running the app directly on the host.

## Sensitive Data Notes

- Keep this app behind your LAN/VPN and add Django authentication before exposing it broadly.
- Set `JOB_RETENTION_MINUTES` to control cleanup timing.
- Run `cleanup_old_jobs` periodically through Celery Beat, cron, or a scheduled task.
- Use a strong `DJANGO_SECRET_KEY` in production.

