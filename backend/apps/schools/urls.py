"""School registration, the caller's own school, and the admin directory."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import MySchoolView, SchoolDirectoryViewSet, SchoolRegistrationView

app_name = "schools"

router = DefaultRouter()
router.register("", SchoolDirectoryViewSet, basename="school")

urlpatterns = [
    path("register", SchoolRegistrationView.as_view(), name="register"),
    path("mine", MySchoolView.as_view(), name="mine"),
    path("", include(router.urls)),
]
