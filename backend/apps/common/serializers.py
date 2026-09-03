"""Serializer base classes.

Day 8 adds the full input-validation and sanitisation pass. What lives here is
the part every serializer needs from the start: unknown fields are rejected
rather than ignored.

DRF's default is to drop keys it does not recognise. That turns a client typo
into a silent no-op - a PATCH that looks like it worked and changed nothing -
and it lets a caller probe for accepted field names without ever being told no.
"""

from __future__ import annotations

from rest_framework import serializers


class StrictFieldsMixin:
    """Reject payload keys the serializer does not declare."""

    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError(
                    {field: "Unrecognised field." for field in sorted(unknown)}
                )
        return super().to_internal_value(data)


class BaseSerializer(StrictFieldsMixin, serializers.Serializer):
    """Non-model serializer: request bodies, action payloads."""


class BaseModelSerializer(StrictFieldsMixin, serializers.ModelSerializer):
    """Model serializer for the unmanaged tables.

    Bookkeeping columns are never client-writable. `school_id` in particular is
    set from the caller's own principal, never from the request body - accepting
    it would let a caller write into another tenant with a single field.
    """

    NEVER_WRITABLE = ("id", "created_at", "updated_at", "school", "school_id")

    def get_fields(self):
        fields = super().get_fields()
        for name in self.NEVER_WRITABLE:
            if name in fields:
                fields[name].read_only = True
        return fields
