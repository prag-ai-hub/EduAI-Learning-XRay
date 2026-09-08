"""Root URL configuration.

Every application route is versioned. `v1` is a namespace so DRF's
NamespaceVersioning can resolve `request.version`, and so a future `v2` can
be added beside it without touching existing clients.
"""

from django.urls import include, path

from apps.common.views import health

v1_patterns = [
    path("accounts/", include("apps.accounts.urls")),
    path("schools/", include("apps.tenants.schools.urls")),
    path("billing/", include("apps.billing.subscriptions.urls")),
    path("parents/", include("apps.tenants.parents.urls")),
    path("ai/", include("apps.platform.aiproxy.urls")),
    path("audit/", include("apps.platform.audit.urls")),
]

urlpatterns = [
    # Unversioned operational surface - load balancers and uptime checks.
    path("health", health, name="health"),
    path("api/v1/", include((v1_patterns, "v1"), namespace="v1")),
]
