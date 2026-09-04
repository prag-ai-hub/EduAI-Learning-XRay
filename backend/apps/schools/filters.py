"""Filtering, search and ordering for the school directory.

Written by hand rather than with django-filter: the surface is one model and
four parameters, and a whitelist is easier to audit than a generated filterset.
The whitelists are the point - a caller must not be able to order by, or filter
on, a column simply because it exists.
"""

from __future__ import annotations

from django.db.models import Q, QuerySet
from rest_framework.exceptions import ValidationError

from .models import School

#: Columns a caller may order by, mapped to the ORM field. An arbitrary
#: `?ordering=` would let a caller probe columns and read intent from row order.
ORDERING = {
    "created_at": "created_at",
    "name": "name",
    "status": "status",
    "approved_at": "approved_at",
}

#: Free-text search looks here. `id` is matched exactly rather than by
#: substring: the ids are `school-{uuid}`, so a substring match on a partial
#: uuid is a fishing expedition, not a search.
SEARCH_FIELDS = ("name", "city", "board")

MAX_SEARCH_LENGTH = 120


def apply(queryset: QuerySet, params) -> QuerySet:
    """Apply `status`, `board`, `city`, `search` and `ordering`."""
    status = params.get("status")
    if status:
        valid = {choice for choice, _ in School.Status.choices}
        if status not in valid:
            raise ValidationError({"status": f"Must be one of: {', '.join(sorted(valid))}."})
        queryset = queryset.filter(status=status)

    for field in ("board", "city"):
        value = (params.get(field) or "").strip()
        if value:
            queryset = queryset.filter(**{f"{field}__iexact": value})

    search = (params.get("search") or "").strip()
    if search:
        if len(search) > MAX_SEARCH_LENGTH:
            raise ValidationError({"search": "Search text is too long."})
        matches = Q(id=search)
        for field in SEARCH_FIELDS:
            matches |= Q(**{f"{field}__icontains": search})
        queryset = queryset.filter(matches)

    ordering = (params.get("ordering") or "-created_at").strip()
    descending = ordering.startswith("-")
    key = ordering.lstrip("-")
    if key not in ORDERING:
        allowed = ", ".join(sorted(ORDERING))
        raise ValidationError(
            {"ordering": f"Must be one of: {allowed}, optionally prefixed with '-'."}
        )
    column = ORDERING[key]
    # A stable tiebreak: without one, two schools created in the same
    # transaction can swap places between pages and a row is silently skipped.
    return queryset.order_by(f"-{column}" if descending else column, "id")
