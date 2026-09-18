"""School registration, the caller's own school, and the admin directory."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    MySchoolView,
    SchoolClassViewSet,
    SchoolDirectoryViewSet,
    SchoolRegistrationView,
    StudentViewSet,
)

app_name = "schools"

router = DefaultRouter()
# Registered before the directory: its prefix is "", which matches anything,
# so a later registration would never be reached.
router.register("classes", SchoolClassViewSet, basename="school-class")
router.register("students", StudentViewSet, basename="student")
router.register("", SchoolDirectoryViewSet, basename="school")

urlpatterns = [
    path("register", SchoolRegistrationView.as_view(), name="register"),
    path("mine", MySchoolView.as_view(), name="mine"),
    path("", include(router.urls)),
]
