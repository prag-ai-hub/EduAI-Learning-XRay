"""Accounts in the back office.

`public.users` is the profile behind a Supabase identity, not a login. Changing
`role` here is the same edit `manage.py set_role` makes, minus its guard rails:
the command refuses a role/school pairing the database would reject and explains
why, and this does not. Prefer the command; this exists for when somebody is
already in the admin looking at the row.
"""

from __future__ import annotations

from django.contrib import admin

from apps.common.admin import AuditedAdmin, ReadOnlyAdmin

from .models import Invitation, User


@admin.register(User)
class UserAdmin(AuditedAdmin):
    list_display = ("email", "name", "role", "school", "status", "total_credits", "used_credits")
    list_filter = ("role", "status")
    search_fields = ("id", "email", "name", "school__name")
    ordering = ("email",)
    raw_id_fields = ("school",)
    readonly_fields = ("id", "created_at", "updated_at")

    def has_add_permission(self, request, obj=None) -> bool:
        """No. `public.users.id` is a foreign key to `auth.users.id`.

        A profile with no identity behind it is a row nobody can sign in as, and
        the database refuses it anyway. The account is created by signing up or
        being invited; `manage.py set_role` then gives it a role, and creates
        the profile for the first Super Admin, who has an identity and no row.
        """
        return False


@admin.register(Invitation)
class InvitationAdmin(ReadOnlyAdmin):
    """An invitation is a record of something sent. Re-issue rather than edit."""

    list_display = ("email", "role", "school", "status", "expires_at", "created_at")
    list_filter = ("status", "role")
    search_fields = ("email", "school__name")
    ordering = ("-created_at",)
