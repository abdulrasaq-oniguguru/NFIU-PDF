<#
Starts all services for local development on Windows, no Docker involved.
Uses the existing .venv for everything.

  1. Django dev server (new window) on 0.0.0.0:9000
  2. Celery worker (new window) -- only if Redis is reachable on 127.0.0.1:6379
     Otherwise falls back to CELERY_TASK_ALWAYS_EAGER=1 so background jobs
     (compress, OCR, conversions, etc.) run synchronously in Django itself.

Usage:  .\start-all.ps1
#>

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# --- Check for Redis (optional) ------------------------------------------
$redisUp = (Test-NetConnection -ComputerName 127.0.0.1 -Port 6379 -WarningAction SilentlyContinue).TcpTestSucceeded

if ($redisUp) {
    Write-Host "[redis] reachable on 127.0.0.1:6379"
} else {
    Write-Host "[redis] not reachable, running without Celery (tasks execute synchronously)"
}

# --- Django dev server -----------------------------------------------------
Write-Host "[django] launching in new window"
$djangoEnv = if ($redisUp) { "" } else { "`$env:CELERY_TASK_ALWAYS_EAGER='1'; " }
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$root'; .\.venv\Scripts\Activate.ps1; `$env:DJANGO_DEBUG='1'; ${djangoEnv}python manage.py runserver 0.0.0.0:9000"
)

# --- Celery worker (only if Redis is up) ------------------------------------
if ($redisUp) {
    Write-Host "[celery] launching in new window"
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "Set-Location '$root'; .\.venv\Scripts\Activate.ps1; celery -A config worker -l INFO --pool=solo"
    )
} else {
    Write-Host "[celery] skipped (no Redis)"
}

Write-Host ""
Write-Host "All services starting. App will be available at:"
Write-Host "  http://127.0.0.1:9000   (local)"
Write-Host "  http://<this-machine-ip>:9000   (from other devices on the network)"
Write-Host "Close the opened windows (or Ctrl+C inside them) to stop."
