"""Rate limiting: that the limits are enforced, and how they behave.

The test settings switch throttling off so assertions elsewhere stay
deterministic, so these tests turn it back on explicitly. That means the rules
themselves are still covered - which is the point of disabling them by default
rather than not having them.

The companion file is tests/test_rate_limits.py, which asks the other question -
whether every published route has a limit at all - by walking the URLconf. The
numbers themselves live in apps/common/throttling.py.
"""

import contextlib
from unittest.mock import patch

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.roles import SCHOOL_ADMIN, SUPER_ADMIN
from apps.common import throttling as rates

pytestmark = pytest.mark.django_db


@contextlib.contextmanager
def throttling(**rates):
    """Turn throttling on for the duration of a test.

    `override_settings(REST_FRAMEWORK=...)` cannot do this.
    `APIView.throttle_classes` is read from api_settings when the class body
    executes, so a class imported before the override keeps the old value -
    and the test settings deliberately disable throttling. These tests used to
    rely on the URLconf not having been imported yet, which made them pass
    alone and fail in a full run.

    Patching the attribute is what actually reaches an imported view.
    """
    with (
        patch.object(APIView, "throttle_classes", [ScopedRateThrottle]),
        patch.object(ScopedRateThrottle, "THROTTLE_RATES", dict(rates)),
    ):
        yield


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

    with throttling(auth="3/min"):
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

    with throttling(user="5/min"):
        codes = [client.get("/api/v1/schools/").status_code for _ in range(7)]

    assert codes[0] == 200
    assert 429 in codes


def test_throttling_counts_per_caller_not_globally(make_school, make_user, api_client_for):
    # One noisy administrator must not lock everyone else out.
    make_school()
    first = api_client_for(make_user(SUPER_ADMIN))
    second = api_client_for(make_user(SUPER_ADMIN))

    with throttling(user="5/min"):
        for _ in range(6):
            first.get("/api/v1/schools/")
        assert first.get("/api/v1/schools/").status_code == 429
        assert second.get("/api/v1/schools/").status_code == 200


def test_health_is_never_throttled():
    # A liveness probe that can be rate limited is a liveness probe that lies.
    with throttling(user="5/min", anon="5/min"):
        codes = [APIClient().get("/health").status_code for _ in range(10)]
    assert set(codes) == {200}


# ---------------------------------------------------------------------------
# The configured numbers, and the shape of a refusal (plan row 16.3)
# ---------------------------------------------------------------------------


def test_the_auth_scope_allows_exactly_its_ten(make_identity, api_client_for):
    """The real number, on the real surface: parent sign-up is identity-only and
    writes a row, so it is what an unthrottled script abuses first."""
    assert rates.AUTH == "10/min"
    client = api_client_for(identity=make_identity())
    payload = {"name": "A. Kulkarni"}

    with throttling(auth=rates.AUTH):
        codes = [
            client.post("/api/v1/accounts/parents", payload, format="json").status_code
            for _ in range(10)
        ]
        refused = client.post("/api/v1/accounts/parents", payload, format="json")

    assert all(code != 429 for code in codes), codes
    assert refused.status_code == 429


def test_a_refusal_uses_the_standard_envelope_and_says_when_to_retry(make_identity, api_client_for):
    client = api_client_for(identity=make_identity())
    payload = {"name": "A. Kulkarni"}

    with throttling(auth="1/min"):
        client.post("/api/v1/accounts/parents", payload, format="json")
        refused = client.post("/api/v1/accounts/parents", payload, format="json")

    assert refused.status_code == 429
    # The one envelope the whole API answers failures in.
    assert refused.json()["error"]["code"] == "throttled"
    # Without this a client cannot back off except by guessing.
    assert refused.headers["Retry-After"]


def test_one_scope_is_one_allowance_across_the_views_that_share_it(
    make_school, make_user, api_client_for
):
    """`user` is a per-person budget, not 120/min per endpoint. That is what
    bounds a client looping over several endpoints in turn."""
    client = api_client_for(make_user(SCHOOL_ADMIN, school=make_school()))

    with throttling(user="1/min"):
        first = client.get("/api/v1/billing/plans/")
        # A different view, the same scope, the same spent bucket.
        second = client.get("/api/v1/billing/subscription")

    assert first.status_code != 429
    assert second.status_code == 429


def test_the_throttle_answers_before_the_view_does_any_work(make_school, make_user, api_client_for):
    """Checkout refuses with 503 here because the tax settings are unset. Once
    the bucket is empty it refuses with 429 instead - so the allowance is spent
    before the handler runs, which is what makes it a defence rather than a
    politeness."""
    client = api_client_for(make_user(SCHOOL_ADMIN, school=make_school()))
    body = {
        "plan_code": "school_starter_monthly",
        "billing": {"billing_name": "A School", "place_of_supply": "27"},
    }

    with throttling(checkout="1/min"):
        first = client.post("/api/v1/billing/checkout/subscription", body, format="json")
        second = client.post("/api/v1/billing/checkout/subscription", body, format="json")

    assert first.status_code != 429
    assert second.status_code == 429
