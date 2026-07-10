from django.urls import path

from . import views

app_name = "pdf_tool"

urlpatterns = [
    path("", views.home, name="home"),
    path("jobs/", views.create_job, name="create_job"),
    path("jobs/<uuid:job_id>/", views.job_status, name="job_status"),
    path("jobs/<uuid:job_id>/download/", views.download_job, name="download_job"),
]

