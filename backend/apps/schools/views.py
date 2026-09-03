"""School registration and the approval lifecycle.

The lifecycle is a state machine, not a settable field:

    Pending ──approve──▶ Active ──suspend──▶ Suspended ──reactivate──▶ Active
       └────reject────▶ Closed

Every transition is validated against the current status, so a double-click
cannot approve an already-suspended school, and every one writes an audit row.
`status` is read-only on the serializer for the same reason - there is no PATCH
that can move a school sideways into a state nobody chose.
"""

from __future__ import annotations

import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework import status as http
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import SupabaseIdentityAuthentication
from apps.accounts.capabilities import Capability
from apps.accounts.models import User
from apps.accounts.permissions import IsAuthenticatedPrincipal
from apps.accounts.roles import SCHOOL_ADMIN
from apps.audit.services import Action, record
from apps.common.viewsets import ReadOnlyPlatformViewSet

from .models import School
from .serializers import (
    SchoolDecisionSerializer,
    SchoolRegistrationSerializer,
    SchoolSerializer,
)


class SchoolRegistrationView(APIView):
    """POST /api/v1/schools/register - 'Register your school'.

    Authenticated by Supabase identity alone: the caller has just signed up and
    has no profile row yet, which is exactly what this endpoint creates. Django
    cannot create the identity itself - `public.users.id` references
    `auth.users.id` - so signup happens in Supabase first and lands here second.

    Throttled tightly: an unauthenticated-adjacent surface that writes two rows
    is worth rate limiting well below the default.
    """

    authentication_classes = [SupabaseIdentityAuthentication]
    permission_classes = [IsAuthenticatedPrincipal]
    throttle_scope = "auth"

    @transaction.atomic
    def post(self, request):
        serializer = SchoolRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        caller = request.user

        # An existing profile means an existing place in the product. Letting a
        # teacher or parent register a school would leave them holding two
        # roles, which the schema forbids anyway.
        if User.objects.filter(pk=caller.id).exists():
            raise ValidationError(
                {
                    "detail": "This account already belongs to a school. Contact support "
                    "to register another."
                }
            )

        now = timezone.now()
        school = School.objects.create(
            id=f"school-{uuid.uuid4()}",
            name=data["name"],
            city=data.get("city") or None,
            board=data.get("board") or None,
            settings_json={},
            # Never Active on creation: approval is the whole point.
            status=School.Status.PENDING,
            created_at=now,
            updated_at=now,
        )
        User.objects.create(
            id=caller.id,
            school=school,
            name=data["admin_name"],
            email=caller.email,
            role=SCHOOL_ADMIN,
            phone=data.get("phone") or None,
            status=User.Status.ACTIVE,
            profile_json={},
            total_credits=0,
            used_credits=0,
            created_at=now,
            updated_at=now,
        )
        record(
            action=Action.SCHOOL_REGISTERED,
            school_id=school.id,
            actor_id=caller.id,
            entity_type="school",
            entity_id=school.id,
            detail={"name": school.name, "city": school.city, "board": school.board},
        )
        return Response(
            {"school": SchoolSerializer(school).data, "role": SCHOOL_ADMIN},
            status=http.HTTP_201_CREATED,
        )


class MySchoolView(APIView):
    """GET /api/v1/schools/mine - the caller's own school and its status.

    What the frontend polls after registering, to tell an administrator whether
    they are still waiting for approval.
    """

    permission_classes = [IsAuthenticatedPrincipal]
    throttle_scope = "user"

    def get(self, request):
        school_id = getattr(request.user, "school_id", None)
        if not school_id:
            return Response({"school": None})
        school = School.objects.filter(pk=school_id).first()
        if school is None:
            return Response({"school": None})
        return Response({"school": SchoolSerializer(school).data})


class SchoolDirectoryViewSet(ReadOnlyPlatformViewSet):
    """The cross-tenant school directory, and the decisions taken on it.

    Read is `platform.schools.list`; each decision carries its own capability so
    a future "reviewer" role could approve without being able to suspend.
    Day 7 adds filtering and search over this list.
    """

    queryset = School.objects.all().order_by("-created_at")
    serializer_class = SchoolSerializer
    lookup_value_regex = "[^/]+"  # school ids are text, not integers
    capability_map = {
        "list": Capability.PLATFORM_SCHOOLS_LIST,
        "retrieve": Capability.PLATFORM_SCHOOLS_LIST,
        "approve": Capability.PLATFORM_SCHOOL_APPROVE,
        "reject": Capability.PLATFORM_SCHOOL_APPROVE,
        "suspend": Capability.PLATFORM_SCHOOL_SUSPEND,
        "reactivate": Capability.PLATFORM_SCHOOL_SUSPEND,
    }

    def get_queryset(self):
        queryset = super().get_queryset()
        status_filter = self.request.query_params.get("status")
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        return queryset

    # --- transitions --------------------------------------------------------

    def _transition(self, request, *, expected, to, audit_action, reason=None):
        school = self.get_object()
        if school.status not in expected:
            raise ValidationError(
                {
                    "detail": f"A {school.status.lower()} school cannot be "
                    f"{audit_action.split('.')[-1]}."
                }
            )

        now = timezone.now()
        school.status = to
        school.updated_at = now
        fields = ["status", "updated_at"]
        if to == School.Status.ACTIVE and audit_action == Action.SCHOOL_APPROVED:
            school.approved_at = now
            school.approved_by_id = request.user.id
            fields += ["approved_at", "approved_by"]
        if to == School.Status.SUSPENDED:
            school.suspended_at = now
            fields.append("suspended_at")
        school.save(update_fields=fields)

        record(
            action=audit_action,
            school_id=school.id,
            actor_id=request.user.id,
            entity_type="school",
            entity_id=school.id,
            detail={"from": expected[0], "to": to, **({"reason": reason} if reason else {})},
        )
        return Response(SchoolSerializer(school).data)

    def _reason(self, request) -> str:
        serializer = SchoolDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data["reason"]

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._transition(
            request,
            expected=[School.Status.PENDING],
            to=School.Status.ACTIVE,
            audit_action=Action.SCHOOL_APPROVED,
        )

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._transition(
            request,
            expected=[School.Status.PENDING],
            to=School.Status.CLOSED,
            audit_action=Action.SCHOOL_REJECTED,
            reason=self._reason(request),
        )

    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        return self._transition(
            request,
            expected=[School.Status.ACTIVE],
            to=School.Status.SUSPENDED,
            audit_action=Action.SCHOOL_SUSPENDED,
            reason=self._reason(request),
        )

    @action(detail=True, methods=["post"])
    def reactivate(self, request, pk=None):
        return self._transition(
            request,
            expected=[School.Status.SUSPENDED],
            to=School.Status.ACTIVE,
            audit_action=Action.SCHOOL_REACTIVATED,
            reason=self._reason(request),
        )


__all__ = ["MySchoolView", "SchoolDirectoryViewSet", "SchoolRegistrationView"]
