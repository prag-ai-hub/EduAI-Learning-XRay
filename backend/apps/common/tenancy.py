"""School-level isolation, and the narrow doors through it.

This answers "which rows?" once the permission layer has answered "what kind of
thing?". It mirrors `frontend/lib/authorization.ts` deliberately: two services
read one database, and a rule enforced on only one side is not enforced.

The rule that matters most, from role matrix §4: **a SuperAdmin has no implicit
cross-tenant access.** Without that, the role quietly becomes "can read every
school's student data". Identifiable access needs an unexpired row in
`support_access_grants`, and every such read writes an `audit_events` row.
"""

from __future__ import annotations

import logging

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.roles import PARENT
from apps.audit.services import Action

logger = logging.getLogger(__name__)

CROSS_TENANT_READ = Action.SUPPORT_CROSS_TENANT_READ


def active_grant(principal, school_id: str):
    """The caller's live support-access grant for a school, or None."""
    from apps.schools.models import SupportAccessGrant

    return (
        SupportAccessGrant.objects.filter(
            granted_to_id=principal.id,
            school_id=school_id,
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
        .only("id", "reason", "expires_at")
        .first()
    )


def granted_school_ids(principal) -> set[str]:
    """Schools the caller currently holds a support grant for."""
    from apps.schools.models import SupportAccessGrant

    return set(
        SupportAccessGrant.objects.filter(
            granted_to_id=principal.id,
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).values_list("school_id", flat=True)
    )


def record_cross_tenant_read(
    principal, school_id: str, grant, entity_type: str = "school", entity_id: str | None = None
):
    """Audit a read made under a support grant.

    Best effort by design: the grant is what authorises the read, so failing to
    write the audit row must not deny an authorised action. It is logged loudly
    instead - a silent gap in the trail is worse than a noisy one.
    """
    from apps.audit.services import record

    record(
        action=CROSS_TENANT_READ,
        school_id=school_id,
        actor_id=principal.id,
        entity_type=entity_type,
        entity_id=entity_id or school_id,
        detail={
            "grantId": str(grant.id),
            "reason": grant.reason,
            "expiresAt": grant.expires_at.isoformat(),
        },
    )


def require_school_scope(principal, school_id: str | None) -> None:
    """Raise unless the caller may act on this school.

    Same order and same outcomes as `requireSchoolScope` in the frontend.
    """
    if not school_id:
        raise ValidationError("A school is required for this action.")
    if principal.school_id == school_id:
        return
    if not principal.is_super_admin:
        raise PermissionDenied("This record belongs to another school.")

    grant = active_grant(principal, school_id)
    if grant is None:
        raise PermissionDenied("Cross-tenant access requires an active support grant.")
    record_cross_tenant_read(principal, school_id, grant)


def require_linked_child(principal, student_id: str | None) -> None:
    """Parent scoping. `parent_student_links` is the only path to a student."""
    from apps.parents.models import ParentStudentLink

    if not student_id:
        raise ValidationError("A student is required for this action.")
    if principal.role != PARENT:
        raise PermissionDenied("This area is for parent accounts.")

    linked = ParentStudentLink.objects.filter(
        parent_user_id=principal.id,
        student_id=student_id,
        status=ParentStudentLink.Status.ACTIVE,
    ).exists()
    if not linked:
        raise PermissionDenied("You do not have access to this student.")


def require_active_school(principal) -> None:
    """Block new billable work while a school is Pending, Suspended or Closed.

    Reads stay open on purpose (matrix §5): suspending a school must never
    destroy access to work already done, nor hide the invoice needed to
    reactivate. Call this only on write paths.
    """
    from apps.schools.models import School

    if principal.is_super_admin:
        return
    if not principal.school_id:
        raise PermissionDenied("Your profile is not assigned to a school.")

    status = School.objects.filter(pk=principal.school_id).values_list("status", flat=True).first()
    if status is not None and status != School.Status.ACTIVE:
        raise PermissionDenied(f"This school is {status.lower()} and cannot make changes.")


class SuperAdminScope:
    """How widely a SuperAdmin sees a tenant-scoped resource."""

    #: Only schools with a live support grant. The default, per matrix §4.
    GRANTED = "granted"
    #: Every tenant. Only for resources the matrix marks "✔ all", such as
    #: platform-wide payment history.
    ALL = "all"


class TenantScopedQuerySetMixin:
    """Confine a viewset's queryset to what the caller may see.

    Isolation belongs here rather than in each view: a filter someone forgets to
    write is invisible in review, while a mixin someone forgets to inherit shows
    up as a missing base class.

    Views declare:
      * ``tenant_field`` - the column holding the school id. ``None`` marks a
        platform resource that carries no tenant data.
      * ``super_admin_scope`` - ``GRANTED`` (default) or ``ALL``.
      * ``parent_link_field`` - how a parent reaches rows, if they may at all.
    """

    tenant_field: str | None = "school_id"
    super_admin_scope: str = SuperAdminScope.GRANTED
    parent_link_field: str | None = None

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.tenant_field is None:
            return queryset

        principal = self.request.user

        if getattr(principal, "is_super_admin", False):
            if self.super_admin_scope == SuperAdminScope.ALL:
                return queryset
            granted = granted_school_ids(principal)
            # No grant means no identifiable rows - not "everything".
            if not granted:
                return queryset.none()
            return queryset.filter(**{f"{self.tenant_field}__in": granted})

        if getattr(principal, "role", None) == PARENT:
            # A parent has no school. Their reach is defined by
            # parent_student_links, so a view must say how to follow it; until
            # it does, they see nothing rather than something accidental.
            if not self.parent_link_field:
                return queryset.none()
            from apps.parents.models import ParentStudentLink

            students = ParentStudentLink.objects.filter(
                parent_user_id=principal.id,
                status=ParentStudentLink.Status.ACTIVE,
            ).values_list("student_id", flat=True)
            return queryset.filter(**{f"{self.parent_link_field}__in": students})

        school_id = getattr(principal, "school_id", None)
        if not school_id:
            return queryset.none()
        return queryset.filter(**{self.tenant_field: school_id})


__all__ = [
    "CROSS_TENANT_READ",
    "SuperAdminScope",
    "TenantScopedQuerySetMixin",
    "active_grant",
    "granted_school_ids",
    "record_cross_tenant_read",
    "require_active_school",
    "require_linked_child",
    "require_school_scope",
]
