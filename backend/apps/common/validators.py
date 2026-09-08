"""Input sanitisation primitives.

Every guard here answers one question: what may a string a human typed actually
contain by the time it reaches a database row, an email header, or the screen
where a Super Admin approves a school?

None of these threats are hypothetical. Each was reproduced against this code
before its guard was written:

  * A newline in a school name reaches ``SUBJECTS[event].format(school=...)`` in
    apps/tenants/schools/notifications.py. Django refuses the header, the
    surrounding ``except Exception`` swallows the failure so the decision is not
    undone, and the school is simply never told it was approved. A silent
    non-delivery is worse than a 500, because nobody goes looking for it.
  * A right-to-left override in a school name reorders what follows it without
    being visible. On the approval screen that is a human reading one name and
    approving another.
  * The same accented name typed as NFC and as NFD is two distinct values in
    Postgres, so a directory shows two schools that look identical.
  * Zero-width characters satisfy every "is it blank" and "is it long enough"
    check there is: a school registers today under a name of four invisible
    characters.
  * A NUL byte cannot live in a Postgres TEXT column - psycopg raises DataError,
    which is a 500. DRF's CharField already refuses it; a DictField's *keys* are
    not a CharField and are validated by nothing at all.

Sanitisation is not universally correct, which is why nothing here is applied
blindly - see the RAW_FIELDS escape hatch in apps/common/serializers.py.
"""

from __future__ import annotations

import unicodedata

from rest_framework import serializers

# --- the character classes --------------------------------------------------

#: Bidirectional overrides, embeddings and isolates. Invisible themselves, they
#: reorder everything that follows, so a name stored as "Nehru <RLO>gnidnep"
#: renders as "Nehru pending". Refused rather than stripped: a value that
#: renders as something other than itself is not a typo to be quietly corrected.
#:
#: Written as escapes deliberately - a literal RLO in this file would reorder
#: the source you are reading now.
BIDI = "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"

#: Invisible, but not deceptive on their own: zero-width space, the directional
#: marks, word joiner, byte-order mark, soft hyphen. Removed rather than
#: refused - the user cannot see what they pasted, so an error naming it would
#: be unactionable.
#:
#: U+200C and U+200D are deliberately absent. ZWNJ and ZWJ change the rendering
#: of Devanagari conjuncts, so in this product they are content, not noise.
INVISIBLE = "\u200b\u200e\u200f\u2060\ufeff\u00ad"

_INVISIBLE_MAP = {ord(character): None for character in INVISIBLE}

#: Permitted in a multi-line field only. Everything else in Unicode category Cc
#: (the C0 range, DEL, and the C1 range) is refused: none of it survives a round
#: trip through a database row, a log line and an HTML page unchanged.
LINE_BREAKS = "\t\n\r"

# --- the bounds on a JSON body ----------------------------------------------

#: A response_format carrying a grading schema nests around nine levels, so the
#: ceiling is set well clear of legitimate use and far below the point where a
#: small body becomes an expensive one to walk.
MAX_JSON_DEPTH = 16

#: Values, not keys - a key is bounded by the value it introduces.
MAX_JSON_NODES = 2000


def sanitise_text(value: str, *, multiline: bool = False) -> str:
    """Return `value` fit to store, or raise ValidationError explaining why not.

    Normalise, remove the invisibles, trim, then refuse what is left over.
    Trimming before the scan matters: a name pasted with a trailing newline is
    an accident worth absorbing, one with a newline in the middle of it is not.
    """
    text = unicodedata.normalize("NFC", value).translate(_INVISIBLE_MAP).strip()

    allowed = LINE_BREAKS if multiline else ""
    for character in text:
        if character in BIDI:
            raise serializers.ValidationError(
                "Remove the text-direction characters from this value."
            )
        if unicodedata.category(character) == "Cc" and character not in allowed:
            raise serializers.ValidationError(
                "Enter this on a single line, without control characters."
                if not multiline
                else "Remove the control characters from this value."
            )
    return text


def sanitise(value, *, multiline: bool = False):
    """`sanitise_text` applied to every string in a nested structure.

    Dictionary keys are cleaned too. They are the half of a JSON body that no
    field declaration ever validates, and they reach a database row as readily
    as a value does.
    """
    if isinstance(value, str):
        return sanitise_text(value, multiline=multiline)
    if isinstance(value, dict):
        return {
            sanitise(key, multiline=False): sanitise(item, multiline=multiline)
            for key, item in value.items()
        }
    if isinstance(value, list | tuple):
        return [sanitise(item, multiline=multiline) for item in value]
    return value


def reject_nul(value) -> None:
    """Refuse U+0000 anywhere in a structure, including dictionary keys.

    This is the one guard that applies to RAW_FIELDS as well. "Raw" means the
    text is not normalised, trimmed or stripped of invisibles - prompt prose and
    base64 blobs need all of that left alone. It does not mean a NUL byte is
    acceptable: Postgres `text` cannot store one at all, and a value that gets
    as far as the driver raises where a 400 belongs.

    Deliberately a containment test rather than a character walk. `"\x00" in s`
    is one pass in C, so a 15 MB data URL costs a couple of milliseconds; the
    per-character loop in `sanitise_text` over the same string would not.
    """
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            if "\x00" in item:
                raise serializers.ValidationError("Remove the null bytes from this value.")
        elif isinstance(item, dict):
            # Keys as well as values: a key is the half of a JSON body that no
            # field declaration validates, and it reaches a row just the same.
            stack.extend(item.keys())
            stack.extend(item.values())
        elif isinstance(item, list | tuple):
            stack.extend(item)


def check_json_shape(
    data,
    *,
    max_depth: int = MAX_JSON_DEPTH,
    max_nodes: int = MAX_JSON_NODES,
) -> None:
    """Refuse a body that is deeper or wider than anything this API accepts.

    Iterative on purpose. A recursive walk over a body nested a few thousand
    deep raises RecursionError, and an uncaught RecursionError is the 500 this
    function exists to prevent.

    Only containers are descended into: a 15 MB base64 string is one node here,
    not fifteen million.
    """
    stack = [(data, 1)]
    nodes = 0
    while stack:
        value, depth = stack.pop()
        nodes += 1
        if depth > max_depth:
            raise serializers.ValidationError("This payload is nested too deeply.")
        if nodes > max_nodes:
            raise serializers.ValidationError("This payload carries too many values.")
        if isinstance(value, dict):
            stack.extend((item, depth + 1) for item in value.values())
        elif isinstance(value, list | tuple):
            stack.extend((item, depth + 1) for item in value)


class BoundedDictField(serializers.DictField):
    """A DictField that bounds its key count and key length.

    DRF bounds neither. `child=CharField(max_length=...)` constrains the values
    and nothing else, so a caller may send ten thousand keys, each of them a
    hundred kilobytes long, to a field documented as holding a handful of
    labels.
    """

    def __init__(self, *, max_keys: int, max_key_length: int, **kwargs):
        self.max_keys = max_keys
        self.max_key_length = max_key_length
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        if isinstance(data, dict):
            if len(data) > self.max_keys:
                raise serializers.ValidationError(f"Send at most {self.max_keys} entries.")
            if any(len(str(key)) > self.max_key_length for key in data):
                raise serializers.ValidationError(
                    f"A key may be at most {self.max_key_length} characters."
                )
        return super().to_internal_value(data)


__all__ = [
    "reject_nul",
    "BIDI",
    "INVISIBLE",
    "LINE_BREAKS",
    "MAX_JSON_DEPTH",
    "MAX_JSON_NODES",
    "BoundedDictField",
    "check_json_shape",
    "sanitise",
    "sanitise_text",
]
