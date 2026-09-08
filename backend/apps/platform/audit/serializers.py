"""Audit trail serialisation. Output only - nothing here is ever written from.

The one decision worth explaining is `detail_json`, which is **not** returned
verbatim.

`services.record()` promises to keep a sensitive payload out of it, and every
call in this service honours that. But `public.audit_events` is not this
service's table alone: the older Next.js surface appends to it too, and it does
not keep the same promise. `app/src/app/api/evaluations/submit+api.ts` writes an
`evaluation.submitted` row whose `detail_json` carries the whole canonical
evaluation - the student's name, and the per-question evidence and AI rationale
that the role matrix keeps from parents and from an ungranted SuperAdmin alike.
Returning the column as stored would hand that to any reader of this endpoint.

So the column is filtered to the keys this service knows it wrote, per action,
and everything else is dropped. A whitelist rather than a blocklist for the
usual reason - a key nobody has thought of yet defaults to hidden - and keyed by
action rather than flat, because a bare key name like "name" means one thing in
a row this service wrote and could mean a student in a row it did not.

`detail_redacted` says that something was dropped, so a reader is never left
believing they are looking at the whole row.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import AuditEvent
from .services import Action

#: What `detail_json` may contain, per action, mirroring what the callers of
#: `record()` actually pass. Adding a key to a `record()` call means adding it
#: here too, or it will not be visible - which is the failure direction to
#: prefer. An action absent from this map shows no detail at all.
DETAIL_KEYS: dict[str, frozenset[str]] = {
    Action.SCHOOL_REGISTERED: frozenset({"name", "city", "board"}),
    Action.SCHOOL_APPROVED: frozenset({"from", "to", "reason"}),
    Action.SCHOOL_REJECTED: frozenset({"from", "to", "reason"}),
    Action.SCHOOL_SUSPENDED: frozenset({"from", "to", "reason"}),
    Action.SCHOOL_REACTIVATED: frozenset({"from", "to", "reason"}),
    Action.SUPPORT_CROSS_TENANT_READ: frozenset({"grantId", "reason", "expiresAt"}),
}


def visible_detail(event: AuditEvent) -> tuple[dict, bool]:
    """The vouched-for part of a row's detail, and whether anything was dropped."""
    stored = event.detail_json
    if not isinstance(stored, dict):
        # jsonb also permits a list, a string or a number. Nothing this service
        # writes is shaped that way, so such a row came from elsewhere and none
        # of it is vouched for.
        return {}, bool(stored)
    allowed = DETAIL_KEYS.get(event.action, frozenset())
    visible = {key: value for key, value in stored.items() if key in allowed}
    return visible, len(visible) < len(stored)


class AuditEventSerializer(serializers.ModelSerializer):
    """One row of the trail: who did what, to what, when.

    `entity_id` and `actor_id` are returned as stored. They are opaque
    identifiers - the thing an investigation follows - and carry no attribute of
    the person or record they point at.
    """

    detail = serializers.SerializerMethodField()
    detail_redacted = serializers.SerializerMethodField()

    class Meta:
        model = AuditEvent
        fields = [
            "id",
            "school_id",
            "actor_id",
            "action",
            "entity_type",
            "entity_id",
            "detail",
            "detail_redacted",
            "created_at",
        ]
        # Only the model-backed fields: DRF rejects naming a declared field here.
        # The trail is append-only in any case - there is no write path to this
        # serializer, and adding one would defeat the purpose of the table.
        read_only_fields = [f for f in fields if not f.startswith("detail")]

    def get_detail(self, event: AuditEvent) -> dict:
        return visible_detail(event)[0]

    def get_detail_redacted(self, event: AuditEvent) -> bool:
        return visible_detail(event)[1]


__all__ = ["DETAIL_KEYS", "AuditEventSerializer", "visible_detail"]
