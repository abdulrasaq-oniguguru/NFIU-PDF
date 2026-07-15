@echo off
REM Double-click this file to start all services (Redis, Django, Celery).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-all.ps1"
pause
