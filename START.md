# Starting the App

Two ways to run this: **Docker** (easiest, no local dependency setup) or **local/native**
(Windows PowerShell, needed if you want to iterate quickly without rebuilding containers).

---

## Option 1: Docker (recommended)

Requires Docker Desktop running.

```bash
docker compose up --build
```

First time only, run migrations in another terminal:

```bash
docker compose exec web python manage.py migrate
```

Open **http://127.0.0.1:8000**.

This starts three containers: `redis` (Celery broker), `web` (Django, port 8000), and `worker`
(Celery worker). Stop with `Ctrl+C`, or `docker compose down` to remove containers.

> The frontend (React/Vite) is already built into `static/pdf_tool/react/` and committed/rebuilt
> as part of the image, so you don't need Node inside Docker unless you change frontend code (see
> [Frontend changes](#frontend-changes) below).

---

## Option 2: Local (Windows, no Docker)

You need **3 terminals**: Redis, Django, and Celery worker.

### 0. One-time setup

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm install
python manage.py migrate
```

Compress/OCR/Office-conversion features also need Ghostscript, Tesseract, and LibreOffice
installed on the host — see **[DEPENDENCIES.md](DEPENDENCIES.md)** for Windows install commands.
Everything else (merge, split, rotate, crop, lock/unlock, watermark, PDF↔image) works without them.

### 1. Start Redis

Redis has no native Windows build. Easiest option — run just the Redis container from Docker:

```powershell
docker run -d --name nfiu-redis -p 6379:6379 redis:7-alpine
```

(Only needs to be started once; `docker start nfiu-redis` on subsequent runs.)

### 2. Start the Django server (terminal 1)

```powershell
.venv\Scripts\Activate.ps1
$env:DJANGO_DEBUG = "1"
python manage.py runserver 127.0.0.1:8000
```

`DJANGO_DEBUG=1` is required locally — without it, `runserver` won't serve the built frontend's
static files (`app.js`, `main.css`) at all, and the page loads blank with 404s in the console.

> **Skip Redis/Celery entirely:** if you don't want to run Redis, also set
> `$env:CELERY_TASK_ALWAYS_EAGER = "1"` before starting the server, and skip step 3/the worker
> terminal below. Background jobs (compress, OCR, conversions, etc.) then run synchronously in
> the request itself instead of via a queue — fine for solo local use, but requests block until
> the job finishes and there's no real concurrency.

### 3. Start the Celery worker (terminal 2)

```powershell
.venv\Scripts\Activate.ps1
celery -A config worker -l INFO --pool=solo
```

`--pool=solo` is required on Windows — the default prefork pool isn't supported there.

Open **http://127.0.0.1:8000**.

---

## Frontend changes

The React app is pre-built to static files (`static/pdf_tool/react/app.js`) that Django serves
directly — there's no dev-server proxy wired up. After editing anything in `frontend/src/`,
rebuild before refreshing the browser:

```powershell
npm run build
```

`npm run dev` starts a standalone Vite dev server on port 5173, but since Django doesn't proxy to
it, use `npm run build` + refresh the Django page for changes to show up.

---

## Environment variables (optional)

Defaults work for local dev. Override via a `.env` file or shell env if needed:

| Variable | Default | Purpose |
|---|---|---|
| `DJANGO_SECRET_KEY` | `local-dev-change-me` (dev only) | Django secret key |
| `DJANGO_DEBUG` | `1` | Debug mode |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1,0.0.0.0` | Allowed hosts |
| `CELERY_BROKER_URL` | `redis://127.0.0.1:6379/0` | Celery broker |
| `CELERY_RESULT_BACKEND` | `redis://127.0.0.1:6379/1` | Celery result backend |
| `JOB_RETENTION_MINUTES` | see `config/settings.py` | How long uploaded job files are kept |

---

## Quick reference

| Task | Command |
|---|---|
| Full stack via Docker | `docker compose up --build` |
| Django only (local) | `python manage.py runserver 127.0.0.1:8000` |
| Celery worker (local, Windows) | `celery -A config worker -l INFO --pool=solo` |
| Rebuild frontend | `npm run build` |
| Run migrations | `python manage.py migrate` |
| Run tests | `python manage.py test` |
