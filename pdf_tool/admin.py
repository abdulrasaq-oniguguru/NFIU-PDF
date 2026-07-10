from django.contrib import admin

from .models import Job


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ("id", "operation", "status", "created_at", "updated_at")
    list_filter = ("operation", "status", "created_at")
    search_fields = ("id", "operation", "result_name")

