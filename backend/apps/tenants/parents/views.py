"""The parent portal, and the teacher-side invite that opens it.

A Parent is the one role with no `school_id` - `users_role_school_scope_check`
forbids them one - so the ordinary tenant filter does not describe them at all.
Their reach is `parent_student_links`, and every view here says so in one of the
two ways apps/tenants/schools/tenancy.py already provides:

  * a list is scoped by `parent_link_field` on the tenancy mixin, so the rows a
    parent can reach are chosen by the queryset rather than by a filter each
    view remembers to apply;
  * a read by id goes through `require_linked_child`, which is the same rule
    stated for the case where the caller names the row.

Both refuse identically for a child that is not linked and for a child that does
not exist, so neither can be used to find out which students a school has.

The reads are narrower than the tenancy rule alone. A parent holds
`student.report.read` and `student.resources.read` but not
`student.raw_file.read`, `student.ocr_text.read` or
`student.ai_rationale.read`: those are absent from the role rather than scoped
to their own children (matrix §2, "Deliberate restrictions"), because the
product's promise is that the teacher is the author of the mark. So the report
endpoints select through `public.parent_child_reports`, which cannot return any
of the three - see apps/tenants/parents/services.py.
"""

from __future__ import annotations

from rest_framework import status as http
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from apps.accounts.capabilities import Capability
from apps.accounts.permissions import requires
from apps.common.pagination import DefaultPagination
from apps.common.viewsets import ReadOnlyTenantScopedViewSet, TenantScopedViewSet
from apps.tenants.schools.models import Student
from apps.tenants.schools.tenancy import require_active_school, require_linked_child

from . import services
from .models import ParentInviteCode
from .serializers import (
    ChildSerializer,
    InviteCodeCreateSerializer,
    InviteCodeSerializer,
    RedeemSerializer,
    RevokedInviteCodeSerializer,
)


class RedemptionThrottle(SimpleRateThrottle):
    """Ten redemption attempts an hour, per account.

    A code is 50 bits, so this is not what makes guessing infeasible - the
    entropy is. It is what stops a signed-in account being used as a grinder at
    all, and it bounds the audit noise a determined one can generate.

    Per account rather than per IP, deliberately. Parents reach this from mobile
    networks behind carrier-grade NAT, where thousands of unrelated households
    share one address; an IP bucket tight enough to matter would lock out the
    very people the endpoint exists for, and one loose enough not to would not
    be a control. The cost of an extra bucket to an attacker is a Supabase
    signup, which is the account gate, not this one.

    The rate is carried here because `settings.REST_FRAMEWORK` declares no scope
    for it; `DEFAULT_THROTTLE_RATES` still wins if one is added.
    """

    scope = "parent_link"
    FALLBACK_RATE = "10/hour"

    def get_rate(self) -> str:
        return self.THROTTLE_RATES.get(self.scope) or self.FALLBACK_RATE

    def get_cache_key(self, request, view) -> str | None:
        principal = request.user
        if not getattr(principal, "is_authenticated", False):
            return None
        return self.cache_format % {"scope": self.scope, "ident": principal.pk}


class InviteCodeViewSet(TenantScopedViewSet):
    """POST /api/v1/parents/invite-codes - "Invite a parent" (matrix §2).

    Held by Teacher and SchoolAdmin, and by no one else: a SuperAdmin does not
    hold `teaching.parent.invite`, so there is no cross-tenant path to issuing a
    code even under a support grant.

    `http_method_names` is the reason there is no list or retrieve. A code is a
    bearer credential; an endpoint that reads one back would let anyone holding
    the issuing capability collect every live code in their school, which is a
    strictly larger power than issuing one.
    """

    queryset = ParentInviteCode.objects.all()
    serializer_class = InviteCodeSerializer
    http_method_names = ["post"]
    capability_map = {
        "create": Capability.TEACHING_PARENT_INVITE,
        "revoke": Capability.TEACHING_PARENT_INVITE,
    }
    tenant_field = "school_id"

    def create(self, request, *args, **kwargs):
        serializer = InviteCodeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # A write, so the school lifecycle gate applies: a suspended school may
        # read its own history but may not enrol new parents.
        require_active_school(request.user)
        student = services.scoped_student(principal=request.user, student_id=data["student_id"])

        invite = services.issue_code(
            principal=request.user,
            student=student,
            relationship=data["relationship"],
            email=data.get("email") or None,
            expires_in_days=data["expires_in_days"],
        )
        return Response(InviteCodeSerializer(invite).data, status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        """Kill a code that went to the wrong address, or was issued in error.

        `get_object` runs through the tenancy mixin, so a code belonging to
        another school is a 404 here rather than a 403 - the same answer as a
        code that does not exist.
        """
        invite = services.revoke_code(principal=request.user, invite=self.get_object())
        return Response(RevokedInviteCodeSerializer(invite).data)


class RedeemInviteCodeView(APIView):
    """POST /api/v1/parents/links/redeem - a parent links themselves to a child.

    The security-critical endpoint of the B2C product, and the only way a
    `parent_student_links` row is ever created from outside the school.

    Four properties, none of them optional:

      * every refusal is identical - wrong, expired, spent, revoked and
        wrong-address all return the same 400 with the same wording, so the
        endpoint is not an oracle for which codes exist;
      * redeeming twice returns the same link rather than creating a second, so
        a retried request is not a duplicate;
      * the check, the insert and the `used_count` increment happen inside one
        SQL function under `FOR UPDATE`, so two concurrent redemptions of a
        single-use code cannot both succeed;
      * every attempt is audited to the school that issued the code.

    `parent.child.link` is a Parent-only capability, so a Teacher or SchoolAdmin
    is refused before any of that - and the M8 trigger
    `parent_student_links_role_check` refuses them again at the table, which is
    what makes the rule survive a future view that forgets it.
    """

    permission_classes = [requires(Capability.PARENT_CHILD_LINK)]
    throttle_classes = [RedemptionThrottle]

    def post(self, request):
        serializer = RedeemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        link = services.redeem(principal=request.user, code=serializer.validated_data["code"])
        child = (
            services.annotate_link(
                Student.objects.select_related("school", "school_class"), request.user.pk
            )
            .filter(pk=link.student_id)
            .first()
        )
        return Response(
            {
                "link": {
                    "id": link.link_id,
                    "student_id": link.student_id,
                    "relationship": link.relationship,
                },
                "child": ChildSerializer(child).data if child else None,
            },
            status=http.HTTP_201_CREATED,
        )


class ChildrenViewSet(ReadOnlyTenantScopedViewSet):
    """The parent's own children, and what a school has approved about them.

    `parent_link_field = "id"` is the whole scoping rule: the tenancy mixin
    turns it into `students.id IN (linked, active)`. Nothing here filters by
    school, because a parent has none and may hold children at several.
    """

    queryset = Student.objects.select_related("school", "school_class").all()
    serializer_class = ChildSerializer
    pagination_class = DefaultPagination
    lookup_value_regex = "[^/]+"  # student ids are text, not integers
    http_method_names = ["get", "post"]
    capability_map = {
        "list": Capability.PARENT_CHILDREN_LIST,
        "retrieve": Capability.PARENT_CHILDREN_LIST,
        "reports": Capability.PARENT_CHILD_REPORTS_READ,
        "unlink": Capability.PARENT_CHILD_UNLINK,
    }
    tenant_field = "school_id"
    parent_link_field = "id"

    def get_queryset(self):
        # The mixin decides which rows; the annotation only adds the caller's
        # own link to each of them. Doing the scoping here instead would be the
        # second rule tenancy.py exists to prevent.
        return services.annotate_link(super().get_queryset(), self.request.user.pk).order_by("name")

    def get_object(self):
        # Stated once, for every detail action. The queryset above already
        # excludes an unlinked child, so this is the second layer - but it is
        # the layer that names the rule, and it answers the same way whether the
        # student is another parent's or does not exist.
        require_linked_child(self.request.user, self.kwargs.get(self.lookup_field))
        return super().get_object()

    @action(detail=True, methods=["get"])
    def reports(self, request, pk=None):
        """GET /api/v1/parents/children/{id}/reports"""
        self.get_object()
        payload = _reports_for(request.user.pk, only_student=pk)
        return Response({"child": payload[0] if payload else None})

    @action(detail=True, methods=["post"])
    def unlink(self, request, pk=None):
        """POST /api/v1/parents/children/{id}/unlink - "Unlink themselves".

        A parent may end their own access; the matrix gives them
        `parent.child.unlink` and gives them no way to end anyone else's. The
        row is marked revoked rather than deleted, so the access that existed
        stays on the record.
        """
        self.get_object()
        link = services.active_link(parent_id=request.user.pk, student_id=pk)
        if link is not None:
            services.revoke_link(principal=request.user, link=link)
        return Response(status=http.HTTP_204_NO_CONTENT)


class ChildReportsView(APIView):
    """GET /api/v1/parents/reports - every linked child, in one call.

    What the portal's home screen needs. Scoping is inside
    `public.parent_child_reports`, which joins through the active links itself,
    so an unlinked parent gets an empty list rather than an error.
    """

    permission_classes = [requires(Capability.PARENT_CHILD_REPORTS_READ)]
    throttle_scope = "user"

    def get(self, request):
        return Response({"children": _reports_for(request.user.pk)})


# --- shared shaping ---------------------------------------------------------


def _reports_for(parent_id, *, only_student: str | None = None) -> list[dict]:
    """The read-model payload, with each child's interventions attached.

    Built for every linked child even when one was asked for. The function is
    the field whitelist, and calling it the same way each time is what stops a
    second, narrower query drifting away from what it permits; a parent has a
    handful of children, so the cost is a filter on a short list.
    """
    children = services.child_reports(parent_id)
    if only_student is not None:
        children = [child for child in children if child.get("studentId") == only_student]

    interventions = services.interventions_by_student(
        [child["studentId"] for child in children if child.get("studentId")]
    )
    for child in children:
        # `classInterventions`, not `interventions`. public.interventions carries
        # an assessment_id and no student_id, so an intervention is the plan for
        # a CLASS's assessment - two siblings in one class get byte-identical
        # lists. Under a key that reads as personal, a parent would reasonably
        # take "practise equivalent fractions" as advice written about their own
        # child. Naming it for what it is costs nothing here and is the kind of
        # thing that is never renamed once a screen renders it.
        child["classInterventions"] = interventions.get(child.get("studentId"), [])
    return children


__all__ = [
    "ChildReportsView",
    "ChildrenViewSet",
    "InviteCodeViewSet",
    "RedeemInviteCodeView",
    "RedemptionThrottle",
]
