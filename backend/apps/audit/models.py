"""Audit trail for privileged actions.

Unmanaged - see apps/accounts/models.py for the rule and the reasoning.
`public.audit_events` predates this service and is already written by the
Next.js surface; Django appends to the same table rather than starting a
second, competing trail.
"""

from django.db import models
from django.db.models.functions import Now


class AuditEvent(models.Model):
    """One privileged action: who did what, to what, when.

    `detail_json` must stay free of sensitive payloads. It records enough to
    reconstruct the decision - identifiers, before/after status - and never a
    prompt, a card detail, or a student's identifiable data.

    The actor and school columns are plain text rather than foreign keys on
    purpose: an audit row has to survive the deletion of whatever it describes.
    """

    id = models.TextField(primary_key=True)
    school_id = models.TextField()
    actor_id = models.TextField(blank=True, null=True)
    action = models.TextField()
    entity_type = models.TextField()
    entity_id = models.TextField(blank=True, null=True)
    # Both columns carry database defaults ('{}'::jsonb and now()). Declaring
    # them here lets Django omit the columns on insert and let Postgres fill
    # them, so a row written from Django is timestamped by the same clock as one
    # written by the Next.js surface.
    detail_json = models.JSONField(db_default=models.Value({}))
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = "audit_events"

    def __str__(self) -> str:
        return f"{self.action} {self.entity_type}:{self.entity_id} by {self.actor_id}"
