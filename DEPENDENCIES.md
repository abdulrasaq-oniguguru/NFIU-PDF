# System Dependencies (No Docker Required)

This app's Python dependencies (`requirements.txt`) are enough to run merge, split, rotate,
crop, lock/unlock, watermark, page numbers, and PDF↔image/Word/Excel/PowerPoint conversions.
Three features shell out to external binaries that are **not** Python packages, so they need
a one-time system install:

| Feature | Operations | Needs |
|---|---|---|
| Compress PDF | `compress` | Ghostscript (`gs` / `gswin64c`) |
| Office ↔ PDF | `office_to_pdf`, `word_to_pdf`, `excel_to_pdf`, `powerpoint_to_pdf` | LibreOffice (`soffice`) |
| OCR | `ocr` | Tesseract (`tesseract`) + OCRmyPDF (Python package, already in `requirements.txt`) |

The app looks these up via `PATH` at runtime (`pdf_tool/operations.py:resolve_binary`), which
also has a Windows-specific fallback that scans common `Program Files` install locations, so on
Windows a `PATH` entry usually isn't even required — see the note at the end of each section.

The Docker image (`Dockerfile`) installs all of this automatically via `apt`. Everything below is
only needed for running the Django app + Celery worker directly on the host (no containers).

---

## Windows

### 1. LibreOffice (Office ↔ PDF conversion)

```powershell
winget install --id TheDocumentFoundation.LibreOffice --silent --accept-package-agreements --accept-source-agreements
```

Installs to `C:\Program Files\LibreOffice\program\soffice.exe`. `resolve_binary()` already checks
this exact path automatically — no `PATH` edit needed. If you want `soffice` available in your own
shell too, add `C:\Program Files\LibreOffice\program` to `PATH`.

### 2. Ghostscript (Compress PDF)

Ghostscript isn't reliably available via `winget`, so install the official build directly:

```powershell
# Check the latest release tag at:
# https://github.com/ArtifexSoftware/ghostpdl-downloads/releases
$installer = "$env:TEMP\gs_installer.exe"
Invoke-WebRequest "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10071/gs10071w64.exe" -OutFile $installer
Start-Process -FilePath $installer -ArgumentList "/S" -Wait
```

Installs to `C:\Program Files\gs\gs<version>\bin\gswin64c.exe`. Also auto-detected by
`resolve_binary()`'s Windows fallback — no `PATH` edit needed.

### 3. Tesseract + OCRmyPDF (OCR)

```powershell
winget install --id UB-Mannheim.TesseractOCR --silent --accept-package-agreements --accept-source-agreements
```

Installs to `C:\Program Files\Tesseract-OCR\tesseract.exe` (also auto-detected).

`ocrmypdf` itself is a Python package and already installs via `pip install -r requirements.txt`
— it wraps Ghostscript + Tesseract, so both of the above must be present first. Its CLI entry
point lands in your venv's `Scripts\` folder (e.g. `.venv\Scripts\ocrmypdf.exe`), which **is not**
covered by the Windows fallback scan (that only checks `Program Files`), so it must be on `PATH`:

```powershell
$venvScripts = "C:\path\to\project\.venv\Scripts"
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
[Environment]::SetEnvironmentVariable('Path', "$current;$venvScripts", 'User')
```

### Verifying

Open a **new** terminal (so the updated `PATH` takes effect) and run:

```powershell
soffice --version
gswin64c --version
tesseract --version
ocrmypdf --version
```

Then restart the Celery worker so it picks up the new `PATH`:

```powershell
celery -A config worker -l INFO --pool=solo
```

---

## Linux

```bash
sudo apt update
sudo apt install -y ghostscript poppler-utils libreoffice tesseract-ocr ocrmypdf
```

(Mirrors the `Dockerfile` exactly.) These land on `PATH` automatically via the system package
manager — no extra configuration needed.

## macOS

```bash
brew install ghostscript libreoffice tesseract
pip install ocrmypdf
```

---

## Troubleshooting

- **`OperationError: Missing system dependency: one of gs, gswin64c, gswin32c`** (or `soffice`,
  `ocrmypdf`) — the Celery worker process can't see the binary on its `PATH`. Confirm the binary
  runs in a *fresh* terminal first (old terminals/services won't see `PATH` changes made after
  they started), then restart the Celery worker.
- **Compress/OCR work from a terminal but not through the app** — the Celery worker is usually
  started as a background service (systemd, Task Scheduler, etc.) with its own environment,
  separate from your interactive shell. Set `PATH` in that service's environment, not just your
  terminal's.
- **LibreOffice conversion hangs or fails under load** — LibreOffice's headless mode doesn't handle
  concurrent invocations well. Keep Celery worker concurrency low (`--concurrency=1` on Windows,
  where `--pool=solo` already limits it to one task at a time) if running many Office conversions
  back to back.
