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

from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework import status as http
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import SupabaseIdentityAuthentication
from apps.accounts.capabilities import Capability
from apps.accounts.models import User
from apps.accounts.permissions import IsAuthenticatedPrincipal, requires
from apps.accounts.roles import SCHOOL_ADMIN
from apps.common.pagination import DefaultPagination
from apps.common.viewsets import ReadOnlyPlatformViewSet, TenantScopedViewSet
from apps.platform.audit.services import Action, record

from . import filters, notifications
from .models import School, SchoolClass, Student
from .serializers import (
    RosterImportSerializer,
    SchoolClassSerializer,
    SchoolDecisionSerializer,
    SchoolProfileSerializer,
    SchoolRegistrationSerializer,
    SchoolSerializer,
    StudentSerializer,
    current_academic_year,
)
from .tenancy import SuperAdminScope, require_active_school, require_school_scope


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
        # After commit: a registration that rolls back must not have emailed
        # the applicant to say it succeeded.
        transaction.on_commit(lambda: notifications.notify(school, "registered"))
        return Response(
            {"school": SchoolSerializer(school).data, "role": SCHOOL_ADMIN},
            status=http.HTTP_201_CREATED,
        )


class MySchoolView(APIView):
    """GET /api/v1/schools/mine - the caller's own school and its status.

    What the frontend polls after registering, to tell an administrator whether
    they are still waiting for approval.
    """

    throttle_scope = "user"

    def get_permissions(self):
        """Reading your own school needs no capability; editing it does.

        Per method rather than per view, because the two answer different
        questions: "where does my registration stand" is something every member
        of a school may ask, and "rename the school" is `school.profile.edit`,
        which the matrix gives to a SchoolAdmin and to nobody below them.
        """
        if self.request.method == "PATCH":
            return [requires(Capability.SCHOOL_PROFILE_EDIT)()]
        return [IsAuthenticatedPrincipal()]

    def get(self, request):
        school_id = getattr(request.user, "school_id", None)
        if not school_id:
            return Response({"school": None})
        school = School.objects.filter(pk=school_id).first()
        if school is None:
            return Response({"school": None})
        return Response({"school": SchoolSerializer(school).data})

    def patch(self, request):
        """Correct the school's own name, city or board.

        `status` is not a field here and cannot be reached through this: a
        school that could set its own status could approve itself. The lifecycle
        moves only through the Super Admin decisions in `SchoolDirectoryViewSet`.
        """
        require_active_school(request.user)
        school = School.objects.filter(pk=getattr(request.user, "school_id", None)).first()
        if school is None:
            raise ValidationError({"detail": "Your profile is not assigned to a school."})

        serializer = SchoolProfileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        changes = serializer.validated_data
        if not changes:
            return Response({"school": SchoolSerializer(school).data})

        for field, value in changes.items():
            setattr(school, field, value or None if field != "name" else value)
        school.updated_at = timezone.now()
        school.save(update_fields=[*changes, "updated_at"])

        record(
            action=Action.SCHOOL_PROFILE_UPDATED,
            school_id=school.id,
            actor_id=request.user.id,
            entity_type="school",
            entity_id=school.id,
            # The fields that changed, not their values: an audit row is read by
            # every administrator of the school and does not need the old name.
            detail={"fields": sorted(changes)},
        )
        return Response({"school": SchoolSerializer(school).data})


class SchoolDirectoryViewSet(ReadOnlyPlatformViewSet):
    """The cross-tenant school directory, and the decisions taken on it.

    Read is `platform.schools.list`; each decision carries its own capability so
    a future "reviewer" role could approve without being able to suspend.
    Filtering, search and ordering are whitelisted in `filters.py`: a caller
    must not be able to order by, or filter on, a column simply because it
    exists.
    """

    queryset = School.objects.all()
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
        queryset = (
            super()
            .get_queryset()
            .annotate(
                # distinct=True: without it the two joins multiply and both counts
                # come back as their product.
                user_count=Count("users", distinct=True),
                student_count=Count("students", distinct=True),
            )
        )
        return filters.apply(queryset, self.request.query_params)

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

        if audit_action == Action.SCHOOL_APPROVED:
            # Approval puts a school on the free tier, with no checkout: nothing
            # is charged, so this works before the payment gateway exists. It is
            # idempotent and leaves a paid subscription alone, so re-approving
            # after a suspension never hands out a second free pack.
            #
            # Imported here rather than at module scope: `apps.billing` loads
            # after `tenants.schools` (it holds the FK to School), so a
            # top-level import would be a cycle at startup.
            from apps.billing.subscriptions import services as billing

            billing.grant_free_plan(school, actor_id=request.user.id)
        # The school is told what happened and why. Sending never blocks the
        # decision - see apps/tenants/schools/notifications.py.
        event = audit_action.split(".", 1)[1]
        transaction.on_commit(lambda: notifications.notify(school, event, reason=reason or ""))
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


# ---------------------------------------------------------------------------
# The roster (plan row 17.4)
# ---------------------------------------------------------------------------


class _RosterViewSet(TenantScopedViewSet):
    """What classes and students have in common.

    Three things, and each is the reason this base exists rather than the rules
    being repeated twice:

      * **The school is the caller's own.** `tenant_field` hands the queryset to
        the tenancy mixin, and `perform_create` stamps the same school onto the
        row - a `school` in the request body is ignored rather than trusted.
      * **Writes need an Active school.** Matrix §5: a Pending, Suspended or
        Closed school may read its own history and may not change it. A school
        setting itself up before approval is the case people meet first, and it
        is the documented answer - approval comes before a roster.
      * **The id is the server's.** `classes` and `students` carry text primary
        keys, not sequences, so something has to mint them. A caller-supplied id
        would let one school overwrite another's row by naming it.
    """

    super_admin_scope = SuperAdminScope.GRANTED
    tenant_field = "school_id"
    throttle_scope = "user"
    pagination_class = DefaultPagination

    #: Prefix for minted ids, e.g. "cls-".
    id_prefix = ""

    #: Shown when a write collides with one of the roster's unique indexes.
    integrity_message: dict[str, str] = {"detail": "That record already exists."}

    def get_serializer_context(self):
        # The serializers validate a teacher or a class against the caller's
        # school; they must not re-derive it from the request.
        return {**super().get_serializer_context(), "school_id": self._school_id()}

    def get_queryset(self):
        # `TenantScopedQuerySetMixin` confines a SuperAdmin to every school they
        # hold a live grant for. This narrows that to the one school they named:
        # a second, unrelated grant must not widen the page, and the
        # `support.cross_tenant_read` row records one school - reading a second
        # one under it would be exactly the untraceable access the grant exists
        # to prevent. For everyone else this is the school they already had.
        return super().get_queryset().filter(school_id=self._school_id())

    def _school_id(self) -> str:
        # Resolved once per request: for a SuperAdmin the resolution itself
        # writes the audit row, and the queryset, the serializer context and the
        # create path all ask for it.
        cached = getattr(self, "_resolved_school_id", None)
        if cached:
            return cached
        principal = self.request.user
        school_id = getattr(principal, "school_id", None)
        if not school_id:
            # A SuperAdmin has no school of their own and must name one, which
            # `require_school_scope` checks against a live support grant and
            # audits.
            school_id = (self.request.query_params.get("school") or "").strip()
            if not school_id:
                raise ValidationError({"school": "Name the school whose roster you are managing."})
            require_school_scope(principal, school_id)
        self._resolved_school_id = school_id
        return school_id

    def perform_create(self, serializer):
        require_active_school(self.request.user)
        self._write(
            serializer,
            id=f"{self.id_prefix}{uuid.uuid4()}",
            school_id=self._school_id(),
            created_at=timezone.now(),
            updated_at=timezone.now(),
        )

    def perform_update(self, serializer):
        require_active_school(self.request.user)
        self._write(serializer, updated_at=timezone.now())

    def _write(self, serializer, **fields) -> None:
        """Save, turning a unique-index violation into a readable 400.

        The serializer cannot close these races on its own: two requests both
        read "no such row", both insert, and only the index (M19) refuses the
        second. An edit collides the same way a creation does - renaming 7B-15
        to 7B-14 is the ordinary typo - so both paths come through here rather
        than only the one that was written first.
        """
        try:
            # A savepoint: a violation aborts the transaction, and without one
            # this request could not go on to answer at all.
            with transaction.atomic():
                serializer.save(**fields)
        except IntegrityError as exc:
            raise ValidationError(self.integrity_message) from exc


class SchoolClassViewSet(_RosterViewSet):
    """GET/POST /api/v1/schools/classes/ - the school's teaching units.

    Held by SchoolAdmin and Teacher (matrix: "Manage classes"), which is
    deliberate: a teacher creating the class they are about to assess is the
    ordinary case, and routing it through an administrator would mean the
    product's first step needs two people.
    """

    queryset = SchoolClass.objects.select_related("teacher").all()
    serializer_class = SchoolClassSerializer
    required_capabilities = frozenset({Capability.SCHOOL_CLASSES_MANAGE})
    lookup_value_regex = "[^/]+"  # class ids are text
    id_prefix = "cls-"
    integrity_message = {  # classes_identity_key
        "detail": "That class, section and subject already exists for this year."
    }
    ordering = ("class_name", "section", "subject")

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .annotate(student_count=Count("students"))
            .order_by(*self.ordering)
        )

    def create(self, request, *args, **kwargs):
        """Create, defaulting the academic year to the current one.

        The year is part of a class's identity, and a school office does not
        think about it when adding a class mid-term. Defaulted rather than
        required, and still overridable.
        """
        # `.copy()`, not `{**request.data}`: a form-encoded or multipart body
        # arrives as a QueryDict, whose dict expansion hands back every value as
        # a *list* and fails the serializer on every field.
        data = request.data.copy()
        if not (data.get("academic_year") or "").strip():
            data["academic_year"] = current_academic_year()
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=http.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        """Refuse while students are attached, rather than orphaning them.

        `students.class_id` has no ON DELETE clause, so the database would
        refuse this anyway with a foreign-key error. Answering here means the
        school is told how many students to move first.
        """
        require_active_school(request.user)
        school_class = self.get_object()
        attached = Student.objects.filter(school_class_id=school_class.id).count()
        if attached:
            raise ValidationError(
                {
                    "detail": f"{attached} student{'s' if attached != 1 else ''} are in this "
                    "class. Move them to another class first.",
                }
            )
        school_class.delete()
        return Response(status=http.HTTP_204_NO_CONTENT)


class StudentViewSet(_RosterViewSet):
    """GET/POST /api/v1/schools/students/ - the school's roster.

    Filterable by `?class=<id>` and `?status=`, because the screens that use it
    are a class list and a roster list.
    """

    queryset = Student.objects.select_related("school_class").all()
    serializer_class = StudentSerializer
    required_capabilities = frozenset({Capability.SCHOOL_ROSTER_MANAGE})
    lookup_value_regex = "[^/]+"
    id_prefix = "student-"
    integrity_message = {  # students_roll_number_key
        "roll_number": "Another student at this school already has that roll number."
    }
    ordering = ("name",)

    def get_queryset(self):
        queryset = super().get_queryset()
        school_class = (self.request.query_params.get("class") or "").strip()
        if school_class:
            queryset = queryset.filter(school_class_id=school_class)
        status = (self.request.query_params.get("status") or "").strip()
        if status:
            queryset = queryset.filter(status=status)
        return queryset.order_by(*self.ordering)

    def destroy(self, request, *args, **kwargs):
        """A student leaves the roster; their work does not leave the product.

        Grade results, parent links and audit rows all point at this id. Deleting
        the row would either fail on a foreign key or, worse, strand a parent's
        reports. Marking them Inactive is what "remove from the roster" means
        here, and the tenancy filters already read only Active students.
        """
        require_active_school(request.user)
        student = self.get_object()
        student.status = Student.INACTIVE
        student.updated_at = timezone.now()
        student.save(update_fields=["status", "updated_at"])
        return Response(StudentSerializer(student).data, status=http.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="import")
    def bulk_import(self, request):
        """POST /students/import - a roster pasted or uploaded in one go.

        Every row is resolved and validated before anything is written, and the
        whole import is one transaction: a file with a bad row on line 40 leaves
        no half-imported roster behind. The response names the failures by row
        so the office can fix the spreadsheet rather than guess.

        A row whose roll number already exists is an **update**, not a refusal -
        re-importing a corrected file is the ordinary way a school fixes a typo,
        and it must not create a second child.
        """
        require_active_school(request.user)
        serializer = RosterImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        school_id = self._school_id()

        classes = list(SchoolClass.objects.filter(school_id=school_id))
        by_label: dict[str, list[SchoolClass]] = {}
        for entry in classes:
            by_label.setdefault(f"{entry.class_name}{entry.section}".upper(), []).append(entry)

        resolved, problems = [], []
        for index, row in enumerate(serializer.validated_data["rows"], start=1):
            label = (row.get("class_label") or "").strip().upper().replace(" ", "").replace("-", "")
            school_class = None
            if label:
                matches = by_label.get(label, [])
                if not matches:
                    problems.append({"row": index, "detail": f"No class {label} at this school."})
                    continue
                if len(matches) > 1:
                    # "6C" is three rows when 6C is taught Maths, Science and
                    # English. Guessing one would attach the child to a subject
                    # nobody chose.
                    subjects = ", ".join(sorted(entry.subject for entry in matches))
                    problems.append(
                        {
                            "row": index,
                            "detail": f"{label} is taught {subjects}. Import one subject at a "
                            "time, or leave the class blank and assign it after.",
                        }
                    )
                    continue
                school_class = matches[0]
            resolved.append((row, school_class))

        if problems:
            raise ValidationError({"rows": problems})

        now = timezone.now()
        created = updated = 0
        with transaction.atomic():
            for row, school_class in resolved:
                roll = (row.get("roll_number") or "").strip() or None
                existing = (
                    Student.objects.filter(school_id=school_id, roll_number=roll).first()
                    if roll
                    else None
                )
                if existing:
                    existing.name = row["name"].strip()
                    existing.school_class = school_class or existing.school_class
                    existing.status = Student.ACTIVE
                    existing.updated_at = now
                    existing.save()
                    updated += 1
                else:
                    Student.objects.create(
                        id=f"student-{uuid.uuid4()}",
                        school_id=school_id,
                        school_class=school_class,
                        name=row["name"].strip(),
                        roll_number=roll,
                        status=Student.ACTIVE,
                        created_at=now,
                        updated_at=now,
                    )
                    created += 1

        return Response(
            {"created": created, "updated": updated, "total": created + updated},
            status=http.HTTP_201_CREATED,
        )
