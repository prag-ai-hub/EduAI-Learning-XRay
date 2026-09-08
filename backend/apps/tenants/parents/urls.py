"""Parent-student links, invite codes, and the parent dashboard read APIs.

Mounted at `/api/v1/parents/`:

    POST   invite-codes/                  issue a code          Teacher, SchoolAdmin
    POST   invite-codes/{id}/revoke/      kill a code           Teacher, SchoolAdmin
    POST   links/redeem                   link a child          Parent
    GET    children/                      the caller's children Parent
    GET    children/{student_id}/         one child             Parent
    GET    children/{student_id}/reports/ that child's reports  Parent
    POST   children/{student_id}/unlink/  end own access        Parent

`reports` is registered as a plain path rather than a list-route action on the
children viewset: student ids are text and match `[^/]+`, so `children/reports/`
and `children/{student_id}/` would be the same URL, resolved by whichever route
the router happened to emit first.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ChildrenViewSet, ChildReportsView, InviteCodeViewSet, RedeemInviteCodeView

app_name = "parents"

router = DefaultRouter()
router.register("invite-codes", InviteCodeViewSet, basename="invite-code")
router.register("children", ChildrenViewSet, basename="child")

urlpatterns = [
    path("links/redeem", RedeemInviteCodeView.as_view(), name="redeem"),
    path("reports", ChildReportsView.as_view(), name="reports"),
    path("", include(router.urls)),
]
