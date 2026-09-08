"""Request shapes for the AI proxy.

The base serializer sanitises every string it is given (see
apps/common/serializers.py). This is the one place in the codebase where that
default is wrong for particular fields, so each exemption is named and argued
for here rather than being inherited by accident.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.common.serializers import BaseSerializer
from apps.common.validators import BoundedDictField

ROLES = ("system", "user", "assistant")


class MessageSerializer(BaseSerializer):
    """One turn of a prompt.

    `content` is exempt from sanitisation. It carries prompt text and a
    student's transcribed answer: newlines, tabs and unusual Unicode are the
    content, not an attack on it. Normalising or trimming here would change the
    text a teacher is grading, and grading is judged on exactly what the child
    wrote. Nothing in this field reaches a database row, an email header or an
    approval screen - it is serialised into a JSON body and posted to a provider.

    What still applies: DRF's CharField refuses NUL and lone surrogates whatever
    else it is told, and the length is capped.
    """

    RAW_FIELDS = ("content",)

    role = serializers.ChoiceField(choices=ROLES)
    content = serializers.CharField(trim_whitespace=False, max_length=200_000)


class CompletionSerializer(BaseSerializer):
    """A chat completion request.

    Note what is absent: `model`. It is chosen server-side from settings,
    because letting a caller name the model turns a proxy into an open tap on
    someone else's bill.

    `redact` is exempt for a subtler reason than `content`. Its values are
    matched against the prompt character by character - `re.escape`, literally,
    in Redaction.scrub - and the prompt is deliberately raw. Normalising one
    side and not the other would let a name typed as NFD slip past a redaction
    written as NFC.

    The outgoing guard does not catch that, and it is worth being exact about
    why: `Redaction.leaked` searches for the very same normalised values that
    `scrub` just failed to find, so it reports nothing missing and the request
    goes out. The failure is not a refused call - it is a child's name reaching
    the provider with the redaction reporting success. Bounds still apply below,
    and the labels themselves are reduced to `[A-Z0-9_]` before they leave.

    `response_format` is exempt for a plainer reason: the standard OpenAI
    json_schema shape carries prose in `description`, and prose wraps. Sanitising
    it does not adjust the schema, it rejects it - one newline anywhere inside
    and the whole completion is a 400.
    """

    RAW_FIELDS = ("redact", "response_format")

    messages = serializers.ListField(child=MessageSerializer(), allow_empty=False, max_length=50)
    #: label -> value. Each value is replaced with a placeholder before the
    #: request leaves, and mapped back on the response. A call redacts a handful
    #: of names, so the bounds are set at what a classroom needs and no more:
    #: DRF's DictField constrains its values and neither the number of keys nor
    #: their length.
    redact = BoundedDictField(
        child=serializers.CharField(allow_blank=True, max_length=200),
        max_keys=32,
        max_key_length=64,
        required=False,
        default=dict,
    )
    #: A provider-defined schema. Genuinely passed through - it is in RAW_FIELDS
    #: above - so its only bound is the depth and node ceiling from the base.
    response_format = serializers.DictField(required=False)
    temperature = serializers.FloatField(required=False, min_value=0, max_value=2)


class OcrSerializer(BaseSerializer):
    """An OCR request.

    Callers send a base64 data URL rather than a fetchable address: the file is
    a student's answer sheet held in private storage, and handing the provider
    a URL it could fetch later is a different exposure from handing it bytes
    once. `kind` picks the provider field, which differs for PDFs and images.

    `data_url` is exempt on two counts. Cost: it is up to 15 MB, and the base
    class's per-character scan would walk every one of those characters on every
    OCR call. Correctness: normalisation or trimming would rewrite the base64
    and corrupt the answer sheet outright. It is also the wrong shape of threat
    - this value is posted to the provider as one JSON string and is never
    stored, rendered to a human, or put in a header. NUL and lone surrogates are
    still refused by CharField, and the length is capped.
    """

    KINDS = ("document", "image")
    # Mistral's own limit is well above this; the cap exists so one caller
    # cannot push a 200 MB body through a worker.
    MAX_DATA_URL = 15 * 1024 * 1024

    RAW_FIELDS = ("data_url",)

    kind = serializers.ChoiceField(choices=KINDS)
    data_url = serializers.CharField(max_length=MAX_DATA_URL, trim_whitespace=False)

    def validate_data_url(self, value: str) -> str:
        if not value.startswith("data:"):
            raise serializers.ValidationError(
                "Send the file as a base64 data URL, not a fetchable address."
            )
        if ";base64," not in value:
            raise serializers.ValidationError("The data URL must be base64 encoded.")
        return value
