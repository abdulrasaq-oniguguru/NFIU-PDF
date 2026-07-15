import mimetypes
import os
from pathlib import Path

# Python's mimetypes module doesn't know about .mjs (ES modules), so Django's
# static file server falls back to text/plain. Browsers enforce strict MIME
# checking on dynamic `import()` of modules (used by pdf.js's worker) and
# reject anything that isn't a JS type, breaking the PDF preview/editor.
mimetypes.add_type("text/javascript", ".mjs")

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "local-dev-change-me")
DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "jazzmin",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "pdf_tool",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_ROOT = BASE_DIR / "media"
MEDIA_URL = "media/"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 100 * 1024 * 1024

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_ALWAYS_EAGER = os.getenv("CELERY_TASK_ALWAYS_EAGER", "0") == "1"
CELERY_BEAT_SCHEDULE = {
    "cleanup-old-jobs": {
        "task": "pdf_tool.tasks.cleanup_old_jobs",
        "schedule": int(os.getenv("JOB_CLEANUP_INTERVAL_MINUTES", "15")) * 60,
    },
}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": os.getenv("DJANGO_CACHE_URL", "redis://127.0.0.1:6379/2"),
    }
}

JOB_RETENTION_MINUTES = int(os.getenv("JOB_RETENTION_MINUTES", "60"))

# Only enable this when a trusted reverse proxy (nginx, a load balancer, etc.) sits in front
# of this app and is configured to overwrite/strip any client-supplied X-Forwarded-For header.
# With no proxy in front (the default docker-compose/gunicorn setup), REMOTE_ADDR is already
# the real client IP, and trusting X-Forwarded-For here would let a client spoof its own IP
# for audit purposes.
TRUST_X_FORWARDED_FOR = os.getenv("TRUST_X_FORWARDED_FOR", "0") == "1"

JAZZMIN_SETTINGS = {
    "site_title": "NFIU-PDF Admin",
    "site_header": "NFIU-PDF",
    "site_brand": "NFIU-PDF",
    "site_logo": "pdf_tool/react/nfiu-logo.jpg",
    "login_logo": "pdf_tool/react/nfiu-logo.jpg",
    "welcome_sign": "NFIU-PDF Admin Dashboard",
    "copyright": "NFIU-PDF",
    "custom_css": "pdf_tool/admin/custom.css",
    "search_model": ["pdf_tool.Job", "pdf_tool.JobAuditRecord"],
    "show_sidebar": True,
    "navigation_expanded": True,
    "order_with_respect_to": ["pdf_tool", "pdf_tool.Job", "pdf_tool.JobAuditRecord"],
    "icons": {
        "auth": "fas fa-users-cog",
        "auth.user": "fas fa-user",
        "auth.Group": "fas fa-users",
        "pdf_tool.Job": "fas fa-file-pdf",
        "pdf_tool.JobAuditRecord": "fas fa-shield-alt",
        "pdf_tool.SignatureAuditLog": "fas fa-signature",
        "pdf_tool.AnnotationLayer": "fas fa-pen",
    },
    "default_icon_parents": "fas fa-chevron-circle-right",
    "default_icon_children": "fas fa-circle",
    "default_theme_mode": "auto",
}

JAZZMIN_UI_TWEAKS = {
    "theme": "flatly",
    "navbar": "navbar-dark",
    "sidebar": "sidebar-dark-primary",
    "brand_colour": "navbar-dark",
    "accent": "accent-primary",
}
