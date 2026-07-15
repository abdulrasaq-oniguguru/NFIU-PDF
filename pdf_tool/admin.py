import types

from django.contrib import admin
from django.contrib.admin.sites import AdminSite
from django.utils import timezone

from .models import Job, JobAuditRecord


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "operation",
        "status",
        "original_filenames",
        "ip_address",
        "mac_address",
        "created_at",
        "updated_at",
    )
    list_filter = ("operation", "status", "created_at")
    search_fields = (
        "id",
        "operation",
        "result_name",
        "original_filenames",
        "ip_address",
        "mac_address",
    )
    readonly_fields = (
        "id",
        "operation",
        "status",
        "options",
        "error",
        "original_filenames",
        "result_name",
        "result_path",
        "ip_address",
        "mac_address",
        "user_agent",
        "created_at",
        "updated_at",
    )


@admin.register(JobAuditRecord)
class JobAuditRecordAdmin(admin.ModelAdmin):
    list_display = (
        "job_id",
        "operation",
        "status",
        "original_filenames",
        "ip_address",
        "mac_address",
        "job_created_at",
        "recorded_at",
    )
    list_filter = ("operation", "status", "recorded_at")
    search_fields = ("job_id", "operation", "original_filenames", "ip_address", "mac_address")
    readonly_fields = [field.name for field in JobAuditRecord._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


def _dashboard_index(self, request, extra_context=None):
    extra_context = extra_context or {}
    today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    extra_context["nfiu_stats"] = {
        "jobs_today": Job.objects.filter(created_at__gte=today_start).count(),
        "jobs_running": Job.objects.filter(status=Job.Status.RUNNING).count(),
        "jobs_failed_today": Job.objects.filter(
            status=Job.Status.FAILED, created_at__gte=today_start
        ).count(),
        "audit_records_total": JobAuditRecord.objects.count(),
    }
    return AdminSite.index(self, request, extra_context)


admin.site.index = types.MethodType(_dashboard_index, admin.site)

