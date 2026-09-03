"""Keep identifiable data out of prompts sent to a third-party model.

The confirmed finding this exists for: frontend/app/api/grade/route.ts builds
its prompt as `Student: ${studentName}`, so a real child's name leaves the
system on every grading call. Routing through this proxy replaces each such
value with a stable placeholder before the request goes out, and maps the
placeholders back on the way in, so the caller still gets readable text.

The caller says what is sensitive - it knows a student name is a student name,
and the proxy cannot infer that from arbitrary prompt text. Guessing with a
name detector would miss the ones that matter and mangle the ones that do not.
"""

from __future__ import annotations

import re

# Uppercase and bracketed so a model treats it as an opaque token rather than a
# name to be helpfully corrected, and so a stray one is obvious in a log.
_PLACEHOLDER = "[{label}_{index}]"
_LABEL_SAFE = re.compile(r"[^A-Z0-9]+")


class Redaction:
    """A two-way mapping between sensitive values and their placeholders."""

    def __init__(self, values: dict[str, str] | None = None):
        self._to_token: dict[str, str] = {}
        self._to_value: dict[str, str] = {}
        for index, (label, value) in enumerate(sorted((values or {}).items()), start=1):
            value = (value or "").strip()
            # A one-character value would match inside half the words in the
            # prompt; refuse rather than corrupt the text.
            if len(value) < 2:
                continue
            token = _PLACEHOLDER.format(
                label=_LABEL_SAFE.sub("_", label.upper()).strip("_") or "REDACTED",
                index=index,
            )
            self._to_token[value] = token
            self._to_value[token] = value

    def __bool__(self) -> bool:
        return bool(self._to_token)

    @property
    def tokens(self) -> list[str]:
        return list(self._to_value)

    def scrub(self, text: str) -> str:
        """Replace every sensitive value with its placeholder.

        Longest value first: replacing "Rao" before "A. Rao" would leave a
        half-redacted "A. [STUDENT_NAME_1]" behind.
        """
        if not text:
            return text
        for value in sorted(self._to_token, key=len, reverse=True):
            text = re.sub(re.escape(value), self._to_token[value], text, flags=re.IGNORECASE)
        return text

    def restore(self, text: str) -> str:
        """Put the real values back into a model response."""
        if not text:
            return text
        for token, value in self._to_value.items():
            text = text.replace(token, value)
        return text

    def leaked(self, text: str) -> list[str]:
        """Any sensitive value still present. Used to assert, not to clean up."""
        return [
            value
            for value in self._to_token
            if re.search(re.escape(value), text or "", flags=re.IGNORECASE)
        ]


def scrub_messages(messages: list[dict], redaction: Redaction) -> list[dict]:
    """Scrub every message body, leaving roles untouched."""
    return [
        {**message, "content": redaction.scrub(str(message.get("content", "")))}
        for message in messages
    ]
