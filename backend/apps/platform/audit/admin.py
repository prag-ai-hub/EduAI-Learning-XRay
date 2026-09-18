"""The audit trail in the back office - readable, never writable.

A trail somebody can edit is not a trail. Django's own `LogEntry` records what
was done in the admin, and this is the product's record of what was done to a
school; neither is a place to make corrections.
"""

from __future__ import annotations

from django.contrib import admin

from apps.common.admin import ReadOnlyAdmin

from .models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(ReadOnlyAdmin):
    list_display = ("created_at", "action", "school_id", "actor_id", "entity_type", "entity_id")
    list_filter = ("action", "entity_type")
    search_fields = ("school_id", "actor_id", "entity_id", "action")
    ordering = ("-created_at",)
