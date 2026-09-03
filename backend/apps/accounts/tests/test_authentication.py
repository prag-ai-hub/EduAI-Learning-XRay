"""Token verification. No database: every case here fails before the profile
lookup, and the auth bridge is the whole security boundary - a forged or
expired token that authenticates defeats every permission class behind it.
"""

import time

import jwt
import pytest
from django.conf import settings
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIRequestFactory

from apps.accounts.authentication import SupabaseJWTAuthentication

# Read the configured secret rather than a literal, so the suite is correct
# whether or not a developer has a backend/.env loaded.
SECRET = settings.SUPABASE_JWT_SECRET


def token(**overrides) -> str:
    claims = {
        "sub": "11111111-1111-4111-8111-111111111111",
        "email": "teacher@school.test",
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    return jwt.encode(claims, SECRET, algorithm="HS256")


def authenticate(raw: str | None):
    factory = APIRequestFactory()
    headers = {"HTTP_AUTHORIZATION": f"Bearer {raw}"} if raw is not None else {}
    return SupabaseJWTAuthentication().authenticate(factory.get("/api/v1/", **headers))


def test_no_header_defers_rather_than_failing():
    # Returning None lets the permission class decide; raising here would make
    # every public endpoint impossible to serve.
    assert authenticate(None) is None


def test_a_header_that_is_not_bearer_is_ignored():
    request = APIRequestFactory().get("/api/v1/", HTTP_AUTHORIZATION="Basic abc123")
    assert SupabaseJWTAuthentication().authenticate(request) is None


def test_a_malformed_bearer_header_is_rejected():
    request = APIRequestFactory().get("/api/v1/", HTTP_AUTHORIZATION="Bearer a b c")
    with pytest.raises(AuthenticationFailed):
        SupabaseJWTAuthentication().authenticate(request)


def test_expired_token_is_rejected():
    with pytest.raises(AuthenticationFailed, match="expired"):
        authenticate(token(exp=int(time.time()) - 1))


def test_token_signed_with_the_wrong_secret_is_rejected():
    forged = jwt.encode(
        {"sub": "x", "aud": "authenticated", "exp": int(time.time()) + 60},
        "an-attackers-secret",
        algorithm="HS256",
    )
    with pytest.raises(AuthenticationFailed):
        authenticate(forged)


def test_unsigned_token_is_rejected():
    # The classic alg=none downgrade.
    unsigned = jwt.encode(
        {"sub": "x", "aud": "authenticated", "exp": int(time.time()) + 60},
        key="",
        algorithm="none",
    )
    with pytest.raises(AuthenticationFailed):
        authenticate(unsigned)


def test_wrong_audience_is_rejected():
    with pytest.raises(AuthenticationFailed):
        authenticate(token(aud="some-other-service"))


def test_token_without_a_subject_is_rejected():
    raw = jwt.encode(
        {"aud": "authenticated", "exp": int(time.time()) + 60}, SECRET, algorithm="HS256"
    )
    with pytest.raises(AuthenticationFailed):
        authenticate(raw)


def test_a_token_with_no_expiry_is_rejected():
    raw = jwt.encode({"sub": "x", "aud": "authenticated"}, SECRET, algorithm="HS256")
    with pytest.raises(AuthenticationFailed):
        authenticate(raw)


def test_failure_messages_do_not_say_why_beyond_expiry():
    # Telling a caller exactly which check failed helps them forge the next
    # token. Expiry is the one safe exception - the client must know to refresh.
    with pytest.raises(AuthenticationFailed) as bad_secret:
        authenticate(
            jwt.encode(
                {"sub": "x", "aud": "authenticated", "exp": int(time.time()) + 60},
                "wrong",
                algorithm="HS256",
            )
        )
    with pytest.raises(AuthenticationFailed) as bad_audience:
        authenticate(token(aud="elsewhere"))
    assert str(bad_secret.value) == str(bad_audience.value) == "Invalid token."


def test_settings_only_accept_hs256():
    assert settings.SUPABASE_JWT_ALGORITHMS == ["HS256"]
