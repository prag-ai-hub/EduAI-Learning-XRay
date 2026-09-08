"""Filtering and ordering for the audit trail.

Hand-written and whitelisted, the same way apps/tenants/schools/filters.py is
and for the same reason: client input never reaches the ORM as a field name, and
a caller must not be able to filter on, or order by, a column simply because it
exists.

One rule is stricter here than in the directory. An unrecognised parameter is
**rejected**, not ignored, which is `StrictFieldsMixin`'s rule for a request
body applied to a query string. On an investigative surface a silently dropped
filter is worse than an error: `?school_id=other-school` quietly answered with
this school's rows reads as proof of something it does not prove, and a typed
`?actor=` returning everything looks like an actor who touched everything.
"""

from __future__ import annotations

import uuid

from django.db.models import QuerySet
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from apps.common.validators import reject_nul

#: Everything a caller may name. `page`, `page_size` and `format` are DRF's own
#: - pagination and content negotiation, not filters - and are listed so that
#: rejecting the unknown does not reject them.
ALLOWED_PARAMS = frozenset(
    {
        "action",
        "entity_type",
        "actor_id",
        "created_from",
        "created_to",
        "ordering",
        "page",
        "page_size",
        "format",
    }
)

#: Columns a caller may order by. `created_at` alone: the trail is a chronology,
#: and ordering it by actor or action would let a caller read intent from row
#: order on a surface whose whole value is that it is chronological.
ORDERING = {"created_at": "created_at"}

#: `action` and `entity_type` are matched exactly, so an over-long value can
#: only ever match nothing - but it should not reach the database to find that
#: out. The longest name either column holds is around thirty characters.
MAX_TERM_LENGTH = 80

_datetime = serializers.DateTimeField()


def apply(queryset: QuerySet, params) -> QuerySet:
    """Apply `action`, `entity_type`, `actor_id`, the created_at range, `ordering`."""
    unknown = set(params) - ALLOWED_PARAMS
    if unknown:
        allowed = ", ".join(sorted(ALLOWED_PARAMS - {"page", "page_size", "format"}))
        raise ValidationError(
            {field: f"Unrecognised filter. Use one of: {allowed}." for field in sorted(unknown)}
        )

    for field in ("action", "entity_type"):
        value = (params.get(field) or "").strip()
        if value:
            if len(value) > MAX_TERM_LENGTH:
                raise ValidationError({field: "That value is too long."})
            # A query parameter reaches the database as directly as a request
            # body does, and no serializer runs on this path. Postgres `text`
            # cannot hold a NUL, so without this the driver raises and the
            # caller gets a 500 where the answer is plainly a 400.
            try:
                reject_nul(value)
            except ValidationError as exc:
                raise ValidationError({field: exc.detail}) from exc
            # Exact, not a substring match: `?action=school` matching every
            # school.* action would be a filter that lies about what it selected.
            queryset = queryset.filter(**{field: value})

    actor_id = (params.get("actor_id") or "").strip()
    if actor_id:
        try:
            # `actor_id` is text, not a uuid column, so the comparison is textual
            # and a caller's braces or upper case would silently match nothing.
            # Round-tripping through UUID both validates and canonicalises it.
            actor_id = str(uuid.UUID(actor_id))
        except ValueError as exc:
            raise ValidationError({"actor_id": "Must be a user id (a UUID)."}) from exc
        queryset = queryset.filter(actor_id=actor_id)

    # Both ends inclusive: an investigator names the day an incident happened,
    # not an interval, and an exclusive end would drop the event on the boundary.
    for field, lookup in (("created_from", "created_at__gte"), ("created_to", "created_at__lte")):
        raw = (params.get(field) or "").strip()
        if raw:
            try:
                moment = _datetime.to_internal_value(raw)
            except ValidationError as exc:
                raise ValidationError({field: exc.detail}) from exc
            queryset = queryset.filter(**{lookup: moment})

    # Newest first: the trail is read to answer "what just happened".
    ordering = (params.get("ordering") or "-created_at").strip()
    descending = ordering.startswith("-")
    key = ordering.lstrip("-")
    if key not in ORDERING:
        allowed = ", ".join(sorted(ORDERING))
        raise ValidationError(
            {"ordering": f"Must be one of: {allowed}, optionally prefixed with '-'."}
        )
    column = ORDERING[key]
    # A stable tiebreak. It matters more here than in the directory: rows written
    # inside one transaction all carry that transaction's now(), so without it a
    # page boundary falling inside a burst of events silently skips one.
    return queryset.order_by(f"-{column}" if descending else column, "id")


__all__ = ["ALLOWED_PARAMS", "ORDERING", "apply"]
