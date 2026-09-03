"""Server-side access to the AI providers.

The API keys live here and only here. A caller sends a prompt and gets a
completion; it never sees, and cannot ask for, the credential. That is the
whole point of the proxy - the key stops being something every consumer has to
hold and rotate.

Two rules the security checklist sets for this file:

  * The key is read from the environment and is never returned in a response.
  * Logging captures metadata only - timestamps, a hashed caller id, token
    counts. Never the prompt or the completion, both of which carry student
    work.
"""

from __future__ import annotations

import hashlib
import logging
import time

import httpx
from django.conf import settings
from rest_framework.exceptions import APIException

logger = logging.getLogger(__name__)

# A hung provider must not hold a worker open indefinitely. Generation is slow,
# so the read budget is generous; connecting is not.
TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)


class ProviderUnavailable(APIException):
    status_code = 502
    default_detail = "The AI provider could not be reached."
    default_code = "provider_unavailable"


class ProviderNotConfigured(APIException):
    status_code = 503
    default_detail = "AI features are not configured in this environment."
    default_code = "provider_not_configured"


def _actor(principal) -> str:
    """A stable, non-identifying handle for the caller, safe to log."""
    return hashlib.sha256(str(getattr(principal, "id", "")).encode()).hexdigest()[:12]


def _record(provider: str, principal, started: float, usage: dict | None, ok: bool):
    logger.info(
        "ai.%s actor=%s ok=%s ms=%d prompt_tokens=%s completion_tokens=%s",
        provider,
        _actor(principal),
        ok,
        int((time.monotonic() - started) * 1000),
        (usage or {}).get("prompt_tokens", "-"),
        (usage or {}).get("completion_tokens", "-"),
    )


def complete(*, messages: list[dict], principal, response_format=None, temperature=None) -> dict:
    """One chat completion.

    The model is chosen from settings, never from the request: letting a caller
    name the model turns a proxy into an open tap on someone else's bill.
    """
    key = settings.OPENAI_API_KEY
    model = settings.OPENAI_MODEL
    if not key or not model:
        raise ProviderNotConfigured()

    payload: dict = {"model": model, "messages": messages}
    if response_format:
        payload["response_format"] = response_format
    if temperature is not None:
        payload["temperature"] = temperature

    started = time.monotonic()
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(
                f"{settings.OPENAI_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=payload,
            )
    except httpx.HTTPError as exc:
        _record("completion", principal, started, None, ok=False)
        raise ProviderUnavailable() from exc

    if response.status_code >= 400:
        _record("completion", principal, started, None, ok=False)
        # The provider's body can quote the prompt back. Log the status only.
        logger.warning("ai.completion provider returned HTTP %s", response.status_code)
        raise ProviderUnavailable(
            detail="The AI provider rejected the request."
            if response.status_code < 500
            else "The AI provider is unavailable."
        )

    body = response.json()
    usage = body.get("usage") or {}
    _record("completion", principal, started, usage, ok=True)
    return {
        "content": (body.get("choices") or [{}])[0].get("message", {}).get("content", ""),
        "model": body.get("model", model),
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
        },
    }


def ocr(*, data_url: str, kind: str, principal) -> dict:
    """Extract text from one document or image with Mistral OCR."""
    key = settings.MISTRAL_API_KEY
    if not key:
        raise ProviderNotConfigured()

    # The provider names the field differently for the two shapes.
    source = (
        {"type": "document_url", "document_url": data_url}
        if kind == "document"
        else {"type": "image_url", "image_url": data_url}
    )

    started = time.monotonic()
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(
                f"{settings.MISTRAL_BASE_URL}/ocr",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": settings.MISTRAL_OCR_MODEL, "document": source},
            )
    except httpx.HTTPError as exc:
        _record("ocr", principal, started, None, ok=False)
        raise ProviderUnavailable() from exc

    if response.status_code >= 400:
        _record("ocr", principal, started, None, ok=False)
        logger.warning("ai.ocr provider returned HTTP %s", response.status_code)
        raise ProviderUnavailable()

    body = response.json()
    _record("ocr", principal, started, None, ok=True)
    pages = body.get("pages") or []
    # Page markers preserved: the evaluator UI cites a page number per question.
    return {
        "text": "\n\n".join(
            f"--- Page {index + 1} ---\n{page.get('markdown', '')}"
            for index, page in enumerate(pages)
        ),
        "pages": len(pages),
    }


def verify_model(*, principal) -> dict:
    """Check the configured model actually exists for this key.

    A reachable provider with a wrong model id fails every grading run while
    the service looks healthy - the exact failure this check was written for
    when the model id was hardcoded to a string no account had. Cheap: one
    metadata lookup, no completion.
    """
    key = settings.OPENAI_API_KEY
    model = settings.OPENAI_MODEL
    if not key or not model:
        return {
            "model": model or None,
            "ok": False,
            "error": "OPENAI_API_KEY or OPENAI_MODEL is not set.",
        }

    started = time.monotonic()
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.get(
                f"{settings.OPENAI_BASE_URL}/models/{model}",
                headers={"Authorization": f"Bearer {key}"},
            )
    except httpx.HTTPError as exc:
        return {"model": model, "ok": False, "error": f"Provider unreachable: {type(exc).__name__}"}

    ms = int((time.monotonic() - started) * 1000)
    if response.status_code == 200:
        return {"model": model, "ok": True, "ms": ms}
    if response.status_code == 404:
        return {
            "model": model,
            "ok": False,
            "ms": ms,
            "error": f'Model "{model}" is not available to this API key. '
            "Set OPENAI_MODEL to a model the account has.",
        }
    return {
        "model": model,
        "ok": False,
        "ms": ms,
        "error": f"Model check failed with HTTP {response.status_code}.",
    }
