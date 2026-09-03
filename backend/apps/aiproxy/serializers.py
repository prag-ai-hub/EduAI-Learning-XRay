"""Request shapes for the AI proxy."""

from __future__ import annotations

from rest_framework import serializers

from apps.common.serializers import BaseSerializer

ROLES = ("system", "user", "assistant")


class MessageSerializer(BaseSerializer):
    role = serializers.ChoiceField(choices=ROLES)
    content = serializers.CharField(trim_whitespace=False, max_length=200_000)


class CompletionSerializer(BaseSerializer):
    """A chat completion request.

    Note what is absent: `model`. It is chosen server-side from settings,
    because letting a caller name the model turns a proxy into an open tap on
    someone else's bill.
    """

    messages = serializers.ListField(child=MessageSerializer(), allow_empty=False, max_length=50)
    #: label -> value. Each value is replaced with a placeholder before the
    #: request leaves, and mapped back on the response.
    redact = serializers.DictField(
        child=serializers.CharField(allow_blank=True, max_length=200),
        required=False,
        default=dict,
    )
    response_format = serializers.DictField(required=False)
    temperature = serializers.FloatField(required=False, min_value=0, max_value=2)


class OcrSerializer(BaseSerializer):
    """An OCR request.

    Callers send a base64 data URL rather than a fetchable address: the file is
    a student's answer sheet held in private storage, and handing the provider
    a URL it could fetch later is a different exposure from handing it bytes
    once. `kind` picks the provider field, which differs for PDFs and images.
    """

    KINDS = ("document", "image")
    # Mistral's own limit is well above this; the cap exists so one caller
    # cannot push a 200 MB body through a worker.
    MAX_DATA_URL = 15 * 1024 * 1024

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
