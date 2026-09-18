"""Parent links and invite codes in the back office.

An invite code is a bearer credential: whoever holds it can attach themselves to
a child. The list deliberately does not display the code itself - an admin
screen listing live codes would be a place to collect them - and revoking is
done by setting `revoked_at`, which is what the API does too.
"""

from __future__ import annotations

from django.contrib import admin

from apps.common.admin import AuditedAdmin

from .models import ParentInviteCode, ParentStudentLink


@admin.register(ParentStudentLink)
class ParentStudentLinkAdmin(AuditedAdmin):
    """Revoking a link here ends a parent's access, as the API's unlink does.

    Restoring it needs a fresh invite code (M18): an old one cannot undo a
    safeguarding decision, and neither should a stray click here.
    """

    list_display = ("parent_user", "student", "school", "relationship", "status", "created_at")
    list_filter = ("status", "relationship", "linked_via")
    search_fields = ("parent_user__email", "student__name", "school__name")
    ordering = ("-created_at",)
    raw_id_fields = ("parent_user", "student", "school", "invite_code", "revoked_by")
    readonly_fields = ("id", "created_at", "linked_via", "invite_code")

    def has_add_permission(self, request, obj=None) -> bool:
        """No. Redeeming a code is the only thing that links a parent to a child.

        A link written by hand here is a parent reaching a child's reports with
        no code, no teacher, and nothing to point at as authority - and it would
        restore access a school revoked, which M18 exists to prevent.
        """
        return False


@admin.register(ParentInviteCode)
class ParentInviteCodeAdmin(AuditedAdmin):
    list_display = ("student", "school", "relationship", "used_count", "expires_at", "revoked_at")
    list_filter = ("relationship",)
    search_fields = ("student__name", "school__name", "email")
    raw_id_fields = ("student", "school", "created_by")
    ordering = ("-created_at",)
    #: Never `code`. See the module docstring.
    exclude = ("code",)
    readonly_fields = ("id", "created_at", "used_count")

    def has_add_permission(self, request, obj=None) -> bool:
        """No. A code issued here would have no code.

        `code` is excluded from the form on purpose, and the column is NOT NULL
        with a format the schema checks. Issuing goes through the product, which
        generates an unguessable one, gives it an expiry, and records who issued
        it for which child. The back office is here to revoke.
        """
        return False
