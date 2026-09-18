"""Root URL configuration.

Every application route is versioned. `v1` is a namespace so DRF's
NamespaceVersioning can resolve `request.version`, and so a future `v2` can
be added beside it without touching existing clients.
"""

from django.conf import settings
from django.contrib import admin
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

# The operator back office, cookie-authenticated by a Django account that exists
# nowhere else in the product. Off with DJANGO_ADMIN_ENABLED=False, and movable
# off /admin/ with DJANGO_ADMIN_URL - see settings/base.py for what it is and is
# not, and apps/common/admin.py for why every write through it is audited.
if settings.ADMIN_ENABLED:
    admin.site.site_header = "EduAI Learning X-Ray"
    admin.site.site_title = "Learning X-Ray admin"
    admin.site.index_title = "Operations"
    urlpatterns.append(path(settings.ADMIN_URL, admin.site.urls))
