"""The back office, and the rule every model registered in it follows.

The Django admin is a second authority path into the same rows. A Django
superuser reaches them directly: no capability matrix in front of them, no
support grant, no tenancy filter. That is exactly what makes it useful when a
school is stuck at 11pm, and exactly why an edit made here must not be invisible
to the school it happened to.

So every registration below subclasses `AuditedAdmin`, which mirrors each save
and delete into `public.audit_events` - the same trail the product's own
privileged actions write to, readable by the school through
`/api/v1/audit/events`. Django's `LogEntry` records it too, but only somebody
with admin access can read that, which is the wrong audience for "who changed
our student's record".

The models here are `managed = False`: `supabase/migrations` owns their shape
and Django only maps them. The admin edits rows; it has never created a table.
"""

from __future__ import annotations

import uuid

from django.contrib import admin
from django.db import models
from django.utils import timezone

from apps.platform.audit.services import record

#: `audit_events.school_id` is NOT NULL and many rows here belong to no school.
PLATFORM_SCOPE = "platform"

#: Written for an admin edit. Distinct from the product's own action names so a
#: school can tell "our administrator changed this" from "support did".
ADMIN_CHANGED = "admin.object.changed"
ADMIN_DELETED = "admin.object.deleted"


def _school_of(obj) -> str:
    """The school an object belongs to, for the audit row's tenant column."""
    for attribute in ("school_id", "id"):
        value = getattr(obj, attribute, None)
        if attribute == "school_id" and value:
            return str(value)
        if attribute == "id" and type(obj).__name__ == "School" and value:
            return str(value)
    return PLATFORM_SCOPE


class AuditedAdmin(admin.ModelAdmin):
    """A ModelAdmin whose writes reach the school's own audit trail.

    `save_model` and `delete_model` are the two hooks every admin write passes
    through - including bulk actions, which call `delete_model` per object - so
    overriding them covers the surface without touching each registration.
    """

    #: Prefix for a minted text id, e.g. "student-". Ignored for a UUID column.
    id_prefix = ""

    def save_model(self, request, obj, form, change):
        self._stamp(obj, change)
        super().save_model(request, obj, form, change)
        record(
            action=ADMIN_CHANGED,
            school_id=_school_of(obj),
            # A Django operator is not a `public.users` row, so the id column
            # stays empty and the username goes in the detail where it cannot
            # be mistaken for a product account.
            actor_id=None,
            entity_type=obj._meta.model_name or "object",
            entity_id=str(obj.pk),
            detail={
                "adminUser": request.user.get_username(),
                "created": not change,
                "fields": sorted(form.changed_data) if change else [],
            },
        )

    def _stamp(self, obj, change: bool) -> None:
        """Fill the columns the schema requires and the form cannot show.

        `id`, `created_at` and `updated_at` are server-owned - which is why they
        are in `readonly_fields` - so the add form carries none of them and the
        INSERT would go in with an empty id against a text primary key and NULL
        against two NOT NULL columns. Nothing in these models supplies a
        default: `supabase/migrations` owns their shape and Django only maps it,
        so `auto_now_add` would be a Django-side fiction about a column this
        service does not own.

        Minted the way the product mints them: a prefixed uuid4 for a text id
        ("student-...", the form the API writes), a bare uuid4 for a uuid one.
        """
        now = timezone.now()
        primary = obj._meta.pk
        if not change and primary is not None and not getattr(obj, primary.attname, None):
            minted = (
                uuid.uuid4()
                if isinstance(primary, models.UUIDField)
                else f"{self.id_prefix}{uuid.uuid4()}"
            )
            setattr(obj, primary.attname, minted)

        fields = {field.name for field in obj._meta.get_fields()}
        if not change and "created_at" in fields and not getattr(obj, "created_at", None):
            obj.created_at = now
        # Bumped on an edit too: the row did change, and the back office is not
        # exempt from saying when.
        if "updated_at" in fields:
            obj.updated_at = now

    def delete_model(self, request, obj):
        identifier, school = str(obj.pk), _school_of(obj)
        entity = obj._meta.model_name or "object"
        super().delete_model(request, obj)
        record(
            action=ADMIN_DELETED,
            school_id=school,
            actor_id=None,
            entity_type=entity,
            entity_id=identifier,
            detail={"adminUser": request.user.get_username()},
        )


class ReadOnlyAdmin(AuditedAdmin):
    """For rows the product's own rules must remain the only way to write.

    Payments, invoices and the audit trail itself are records of something that
    happened. Editing a captured payment in a back office does not change what
    the gateway did; it just makes the two disagree, with the gateway right.
    """

    def has_add_permission(self, request, obj=None) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
