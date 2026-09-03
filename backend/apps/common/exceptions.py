"""A single, predictable error envelope for the whole API."""

import logging

from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)


def api_exception_handler(exc, context):
    """Normalise DRF errors to `{"error": {"code", "detail"}}`.

    Detail is whatever DRF produced - serializer validation messages are safe
    and useful. Unhandled exceptions are deliberately NOT reshaped here: they
    fall through to Django's 500 handling so nothing internal leaks to the
    client, and the traceback still reaches the logs.
    """
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    response.data = {
        "error": {
            "code": getattr(exc, "default_code", "error"),
            "detail": response.data,
        }
    }
    return response
