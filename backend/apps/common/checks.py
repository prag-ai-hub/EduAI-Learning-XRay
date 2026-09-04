"""Deployment checks that refuse a dangerously open configuration.

`manage.py check --deploy` already warns about Django's own settings. These
cover the ones specific to this service, and they are errors rather than
warnings: a wildcard CORS origin on an API that reads student data is not a
style preference, and a warning in a deploy log is something nobody reads.

They only fire when DEBUG is off, so local development is untouched.
"""

from __future__ import annotations

from django.conf import settings
from django.core.checks import Error, register

WILDCARD = "*"


@register(deploy=True)
def cors_is_not_wildcarded(app_configs, **kwargs):
    """CORS must name real origins in production."""
    if settings.DEBUG:
        return []

    errors = []
    origins = list(settings.CORS_ALLOWED_ORIGINS or [])

    if not origins:
        errors.append(
            Error(
                "CORS_ALLOWED_ORIGINS is empty.",
                hint="Name the frontend origin(s). An empty list blocks the browser "
                "app entirely, which usually means the variable was not set.",
                id="eduai.E001",
            )
        )
    if any(WILDCARD in origin for origin in origins):
        errors.append(
            Error(
                "CORS_ALLOWED_ORIGINS contains a wildcard.",
                hint="List each origin. A wildcard lets any site call this API with "
                "a user's token.",
                id="eduai.E002",
            )
        )
    if settings.CORS_ALLOW_CREDENTIALS and any(WILDCARD in o for o in origins):
        errors.append(
            Error(
                "CORS_ALLOW_CREDENTIALS is on with a wildcard origin.",
                hint="Browsers refuse this combination outright; it is always a misconfiguration.",
                id="eduai.E003",
            )
        )
    return errors


@register(deploy=True)
def allowed_hosts_is_not_wildcarded(app_configs, **kwargs):
    """ALLOWED_HOSTS must name real hosts in production."""
    if settings.DEBUG:
        return []
    if WILDCARD in (settings.ALLOWED_HOSTS or []):
        return [
            Error(
                "ALLOWED_HOSTS is a wildcard.",
                hint="Name the hosts this service answers on. A wildcard allows "
                "Host-header attacks against password reset and absolute links.",
                id="eduai.E004",
            )
        ]
    return []


@register(deploy=True)
def secrets_are_not_placeholders(app_configs, **kwargs):
    """Catch a .env that was copied but never filled in."""
    if settings.DEBUG:
        return []

    errors = []
    if "not-a-real-secret" in settings.SECRET_KEY or len(settings.SECRET_KEY) < 40:
        errors.append(
            Error(
                "SECRET_KEY looks like a placeholder or is too short.",
                hint="Generate one with get_random_secret_key().",
                id="eduai.E005",
            )
        )
    if not settings.SUPABASE_JWT_SECRET:
        errors.append(
            Error(
                "SUPABASE_JWT_SECRET is empty - every request would fail to authenticate.",
                id="eduai.E006",
            )
        )
    return errors
