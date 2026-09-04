"""Deployment checks and response headers.

The checks are errors rather than warnings on purpose: a wildcard CORS origin
on an API that reads student data is not a style preference, and a warning in a
deploy log is something nobody reads.
"""

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.common.checks import (
    allowed_hosts_is_not_wildcarded,
    cors_is_not_wildcarded,
    secrets_are_not_placeholders,
)

REAL = {
    "DEBUG": False,
    "ALLOWED_HOSTS": ["api.eduaihub.in"],
    "CORS_ALLOWED_ORIGINS": ["https://app.eduaihub.in"],
    "CORS_ALLOW_CREDENTIALS": False,
    "SECRET_KEY": "x" * 60,
    "SUPABASE_JWT_SECRET": "a-real-jwt-secret",
}


def ids(errors):
    return sorted(error.id for error in errors)


def test_a_sound_configuration_raises_nothing():
    with override_settings(**REAL):
        assert not cors_is_not_wildcarded(None)
        assert not allowed_hosts_is_not_wildcarded(None)
        assert not secrets_are_not_placeholders(None)


def test_a_wildcard_cors_origin_is_an_error():
    # A wildcard lets any site call this API with a user's token.
    with override_settings(**{**REAL, "CORS_ALLOWED_ORIGINS": ["*"]}):
        assert "eduai.E002" in ids(cors_is_not_wildcarded(None))


def test_an_empty_cors_list_is_an_error():
    # Usually means the variable was never set, not that CORS was intended off.
    with override_settings(**{**REAL, "CORS_ALLOWED_ORIGINS": []}):
        assert "eduai.E001" in ids(cors_is_not_wildcarded(None))


def test_credentials_with_a_wildcard_is_flagged():
    with override_settings(
        **{**REAL, "CORS_ALLOWED_ORIGINS": ["*"], "CORS_ALLOW_CREDENTIALS": True}
    ):
        assert "eduai.E003" in ids(cors_is_not_wildcarded(None))


def test_a_wildcard_allowed_host_is_an_error():
    with override_settings(**{**REAL, "ALLOWED_HOSTS": ["*"]}):
        assert "eduai.E004" in ids(allowed_hosts_is_not_wildcarded(None))


@pytest.mark.parametrize("key", ["dev-only-not-a-real-secret-replace-me", "short"])
def test_a_placeholder_secret_key_is_an_error(key):
    with override_settings(**{**REAL, "SECRET_KEY": key}):
        assert "eduai.E005" in ids(secrets_are_not_placeholders(None))


def test_an_empty_jwt_secret_is_an_error():
    # Every request would fail to authenticate; better to refuse to start.
    with override_settings(**{**REAL, "SUPABASE_JWT_SECRET": ""}):
        assert "eduai.E006" in ids(secrets_are_not_placeholders(None))


@pytest.mark.parametrize(
    "check", [cors_is_not_wildcarded, allowed_hosts_is_not_wildcarded, secrets_are_not_placeholders]
)
def test_none_of_them_fire_in_development(check):
    # Local work uses wildcards and throwaway secrets by design.
    with override_settings(
        DEBUG=True,
        ALLOWED_HOSTS=["*"],
        CORS_ALLOWED_ORIGINS=["*"],
        SECRET_KEY="short",
        SUPABASE_JWT_SECRET="",
    ):
        assert check(None) == []


# --- response headers -------------------------------------------------------


@pytest.mark.django_db
def test_api_responses_deny_everything_a_browser_could_do(make_user, api_client_for):
    from apps.accounts.roles import SUPER_ADMIN

    response = api_client_for(make_user(SUPER_ADMIN)).get("/api/v1/schools/")
    csp = response["Content-Security-Policy"]
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    assert response["X-Content-Type-Options"] == "nosniff"


@pytest.mark.django_db
def test_api_answers_are_never_shared_cached(make_user, api_client_for):
    from apps.accounts.roles import SUPER_ADMIN

    # Per-user data behind a shared cache is one user reading another's rows.
    response = api_client_for(make_user(SUPER_ADMIN)).get("/api/v1/schools/")
    assert "no-store" in response["Cache-Control"]


def test_health_is_not_treated_as_an_api_response():
    # A liveness probe is cacheable and carries nothing per-user.
    response = APIClient().get("/health")
    assert response.status_code == 200
    assert "no-store" not in response.get("Cache-Control", "")


def test_cors_applies_to_the_api_only():
    from django.conf import settings

    assert settings.CORS_URLS_REGEX == r"^/api/.*$"
