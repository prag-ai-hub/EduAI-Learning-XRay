"""Append-only log of admin actions - approvals, suspensions, role changes -
recording actor, action and timestamp but never a sensitive payload.

Read-only by construction: the router registers a ReadOnlyModelViewSet, so
there is no route that could write, amend or delete a row.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AuditTrailViewSet

app_name = "audit"

router = DefaultRouter()
router.register("events", AuditTrailViewSet, basename="event")

urlpatterns = [
    path("", include(router.urls)),
]
