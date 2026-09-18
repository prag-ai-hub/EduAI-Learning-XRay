"""Schools, classes and students in the back office."""

from __future__ import annotations

from django.contrib import admin

from apps.common.admin import AuditedAdmin, ReadOnlyAdmin

from .models import School, SchoolClass, Student, SupportAccessGrant


@admin.register(School)
class SchoolAdmin(AuditedAdmin):
    list_display = ("name", "city", "board", "status", "created_at")
    list_filter = ("status", "board")
    search_fields = ("id", "name", "city")
    ordering = ("name",)
    id_prefix = "school-"
    readonly_fields = ("id", "created_at", "updated_at", "approved_at", "approved_by")

    #: `status` is editable here on purpose - putting a school back to Active
    #: when the approval flow has wedged is the reason a back office exists -
    #: but the ordinary path is the audited transition on the API, which also
    #: emails the school and grants the free tier. Changing it here does neither.
    fieldsets = (
        (None, {"fields": ("id", "name", "city", "board", "status")}),
        ("Lifecycle", {"fields": ("approved_at", "approved_by", "suspended_at")}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )


@admin.register(SchoolClass)
class SchoolClassAdmin(AuditedAdmin):
    list_display = ("class_name", "section", "subject", "academic_year", "school", "teacher")
    list_filter = ("academic_year", "class_name")
    search_fields = ("id", "subject", "school__name")
    ordering = ("school__name", "class_name", "section")
    id_prefix = "cls-"
    raw_id_fields = ("school", "teacher")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Student)
class StudentAdmin(AuditedAdmin):
    list_display = ("name", "roll_number", "school", "school_class", "status")
    list_filter = ("status",)
    search_fields = ("id", "name", "roll_number", "school__name")
    ordering = ("school__name", "name")
    id_prefix = "student-"
    raw_id_fields = ("school", "school_class")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(SupportAccessGrant)
class SupportAccessGrantAdmin(ReadOnlyAdmin):
    """The record of a Super Admin being let into a school's data.

    Visible here because the point of a grant is that somebody can see it -
    and read-only for the same reason. A grant is the whole of the control on
    cross-tenant access: it expires, it is revocable, and every read under it is
    audited. An editable `expires_at` or a clearable `revoked_at` would let
    somebody with back-office access re-open a school's data to a named Super
    Admin indefinitely, with the audit trail still saying a grant authorised it.
    Issue and revoke through the product, which records who did it.
    """

    list_display = ("school", "granted_to", "expires_at", "revoked_at", "created_at")
    search_fields = ("school__name",)
    ordering = ("-created_at",)
