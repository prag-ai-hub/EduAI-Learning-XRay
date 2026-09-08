"""The AI proxy.

Why this exists rather than each caller holding the key: a credential held in
one place is a credential that can be rotated in one place, rate limited in one
place, and audited in one place. It also means the frontend never has to hold
it at all.

Two guarantees this endpoint makes that a direct provider call cannot:

  * Identifiable values named by the caller are replaced before the request
    leaves, and the outgoing payload is checked afterwards - a redaction that
    somehow failed refuses the call rather than sending the name anyway.
  * Nothing is logged but metadata. The prompt and the completion both carry
    student work and neither reaches a log line.
"""

from __future__ import annotations

import logging

from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.capabilities import Capability
from apps.accounts.permissions import requires

from . import services
from .scrubbing import Redaction, scrub_messages
from .serializers import CompletionSerializer, OcrSerializer

logger = logging.getLogger(__name__)


class RedactionFailed(APIException):
    """A value that should have been scrubbed survived into the payload.

    Refusing is the only safe answer: the alternative is sending a child's name
    to a third party because a replacement did not match.
    """

    status_code = 500
    default_detail = "The request could not be anonymised and was not sent."
    default_code = "redaction_failed"


class CompletionView(APIView):
    """POST /api/v1/ai/completions"""

    permission_classes = [requires(Capability.AI_COMPLETION_RUN)]
    throttle_scope = "ai"

    def post(self, request):
        serializer = CompletionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        redaction = Redaction(data.get("redact"))
        messages = scrub_messages(data["messages"], redaction)

        # Belt and braces: prove the scrub worked before anything leaves.
        if redaction:
            outgoing = " ".join(message["content"] for message in messages)
            if redaction.leaked(outgoing):
                logger.error("ai.completion redaction failed; request not sent")
                raise RedactionFailed()

        result = services.complete(
            messages=messages,
            principal=request.user,
            response_format=data.get("response_format"),
            temperature=data.get("temperature"),
        )
        return Response(
            {
                **result,
                # Mapped back so the caller gets readable text, having never
                # exposed the value to the provider.
                "content": redaction.restore(result["content"]),
                "redacted": redaction.tokens,
            }
        )


class OcrView(APIView):
    """POST /api/v1/ai/ocr"""

    permission_classes = [requires(Capability.AI_OCR_RUN)]
    throttle_scope = "ai"

    def post(self, request):
        serializer = OcrSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        return Response(
            services.ocr(data_url=data["data_url"], kind=data["kind"], principal=request.user)
        )


class AiHealthView(APIView):
    """GET /api/v1/ai/health - is the proxy usable, and is the model real?

    Capability-gated like the rest: a health endpoint that reveals which
    providers an account holds is reconnaissance if left open.
    """

    permission_classes = [requires(Capability.AI_COMPLETION_RUN)]
    throttle_scope = "ai"

    def get(self, request):
        from django.conf import settings as django_settings

        return Response(
            {
                "openai_configured": bool(django_settings.OPENAI_API_KEY),
                "mistral_configured": bool(django_settings.MISTRAL_API_KEY),
                "model": services.verify_model(principal=request.user),
            }
        )
