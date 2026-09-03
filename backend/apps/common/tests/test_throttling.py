"""Rate limiting.

The test settings switch throttling off so assertions elsewhere stay
deterministic, so these tests turn it back on explicitly. That means the rules
themselves are still covered - which is the point of disabling them by default
rather than not having them.
"""

import pytest
from django.conf import settings
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.roles import SUPER_ADMIN

pytestmark = pytest.mark.django_db

# Merge rather than replace: override_settings swaps the whole dict, and a bare
# one would drop DEFAULT_AUTHENTICATION_CLASSES and turn every request into a 403.
THROTTLED = {
    **settings.REST_FRAMEWORK,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"auth": "3/min", "user": "5/min"},
}


@pytest.fixture(autouse=True)
def _clear_throttle_history():
    # Throttle counters live in the cache; a leaked bucket would fail the next
    # test for no reason.
    cache.clear()
    yield
    cache.clear()


def test_registration_is_rate_limited(make_identity, api_client_for):
    subject, email = make_identity()
    client = api_client_for(identity=(subject, email))
    payload = {"name": "Nehru Vidyalaya", "admin_name": "S. Rao"}

    with override_settings(REST_FRAMEWORK=THROTTLED):
        codes = [
            client.post("/api/v1/schools/register", payload, format="json").status_code
            for _ in range(4)
        ]

    # The first succeeds and creates the school; the next two are refused as
    # duplicates; the fourth is refused by the throttle rather than reaching the
    # handler at all.
    assert codes[0] == 201
    assert codes[-1] == 429


def test_the_directory_is_rate_limited(make_school, make_user, api_client_for):
    make_school()
    client = api_client_for(make_user(SUPER_ADMIN))

    with override_settings(REST_FRAMEWORK=THROTTLED):
        codes = [client.get("/api/v1/schools/").status_code for _ in range(7)]

    assert codes[0] == 200
    assert 429 in codes


def test_throttling_counts_per_caller_not_globally(make_school, make_user, api_client_for):
    # One noisy administrator must not lock everyone else out.
    make_school()
    first = api_client_for(make_user(SUPER_ADMIN))
    second = api_client_for(make_user(SUPER_ADMIN))

    with override_settings(REST_FRAMEWORK=THROTTLED):
        for _ in range(6):
            first.get("/api/v1/schools/")
        assert first.get("/api/v1/schools/").status_code == 429
        assert second.get("/api/v1/schools/").status_code == 200


def test_health_is_never_throttled():
    # A liveness probe that can be rate limited is a liveness probe that lies.
    with override_settings(REST_FRAMEWORK=THROTTLED):
        codes = [APIClient().get("/health").status_code for _ in range(10)]
    assert set(codes) == {200}
