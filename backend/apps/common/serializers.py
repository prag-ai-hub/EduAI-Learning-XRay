"""Serializer base classes.

Two things happen to every request body before a single field validator runs:

  * Unknown keys are rejected rather than ignored. DRF's default is to drop a
    key it does not recognise, which turns a client typo into a silent no-op - a
    PATCH that looks like it worked and changed nothing - and lets a caller
    probe for accepted field names without ever being told no.
  * Every string in the payload is sanitised, and the shape of the payload is
    bounded. What that means, and why each rule exists, is in
    apps/common/validators.py.
"""

from __future__ import annotations

from rest_framework import serializers

from .validators import check_json_shape, reject_nul, sanitise


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


class SanitisedInputMixin:
    """Clean and bound the incoming body before any field sees it.

    Done here rather than in a CharField subclass, and the choice matters. A
    subclass only protects fields whose author remembered to use it, and it
    never sees a DictField's keys or the strings inside a JSON body - both of
    which reach a database row exactly as a CharField's value does. Cleaning the
    payload once, at the one place every serializer passes through, means a
    serializer written next month is covered by default. Fail-closed applies to
    validation as much as to authorisation.

    Two escape hatches, because sanitising is not universally correct:

      RAW_FIELDS        left exactly as sent. Prompt text and base64 blobs
                        belong here; see apps/platform/aiproxy/serializers.py
                        for what it costs to get this wrong.
      MULTILINE_FIELDS  line breaks and tabs are content, not an attack. Used
                        for text that reaches an email body, never a header.

    Both name top-level fields only. A field whose contents are too unusual to
    describe that simply is a field that should validate itself.
    """

    RAW_FIELDS: tuple[str, ...] = ()
    MULTILINE_FIELDS: tuple[str, ...] = ()

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            return super().to_internal_value(data)

        # Bound the shape first: there is no point sanitising two million
        # strings to discover afterwards that the body was never acceptable.
        check_json_shape(data)

        # A QueryDict must stay a QueryDict. DRF decides list and boolean
        # semantics with `html.is_html_input`, which is `hasattr(data,
        # "getlist")` - so handing the parent a plain dict would silently
        # change how form and multipart bodies are read, for every serializer
        # in the codebase. Rebuilding through setlist also keeps the repeated
        # keys that a plain `cleaned[name] = ...` would flatten to the last one.
        multi = hasattr(data, "getlist")
        cleaned = data.copy() if multi else {}

        for name in list(data.keys()):
            raw = name in self.RAW_FIELDS or self._defers_to_nested(name)
            try:
                if raw:
                    # Not sanitised, but still not allowed to carry a NUL.
                    reject_nul(data.getlist(name) if multi else data[name])
                if multi:
                    values = data.getlist(name)
                    cleaned.setlist(
                        name,
                        values
                        if raw
                        else [sanitise(v, multiline=name in self.MULTILINE_FIELDS) for v in values],
                    )
                else:
                    value = data[name]
                    cleaned[name] = (
                        value if raw else sanitise(value, multiline=name in self.MULTILINE_FIELDS)
                    )
            except serializers.ValidationError as exc:
                # Keyed to the field so the caller is told which one, rather
                # than being handed a bare message about "a value".
                raise serializers.ValidationError({name: exc.detail}) from exc
        return super().to_internal_value(cleaned)

    def _defers_to_nested(self, name: str) -> bool:
        """Is this field, or the child of this list, a serializer of its own?

        If so it will run this same mixin over its own payload, and it knows its
        own RAW_FIELDS. Cleaning it here would overrule that: the AI proxy's
        prompt text is exempt on MessageSerializer, and a parent that sanitised
        the whole `messages` list would trim and normalise it before the child
        ever saw it - silently undoing an exemption written two files away.
        """
        field = self.fields.get(name)
        if isinstance(field, serializers.BaseSerializer):
            return True
        return isinstance(getattr(field, "child", None), serializers.BaseSerializer)


class BaseSerializer(StrictFieldsMixin, SanitisedInputMixin, serializers.Serializer):
    """Non-model serializer: request bodies, action payloads."""


class BaseModelSerializer(StrictFieldsMixin, SanitisedInputMixin, serializers.ModelSerializer):
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
