"""Rate limits: that every route has one, and that the numbers are enforced.

Plan row 16.3. Two different questions, and the first is the one that rots:

  * **Coverage.** `ScopedRateThrottle` is the only default throttle class, and
    it does nothing at all unless the view sets `throttle_scope`. So a view
    shipped without one is not throttled loosely - it is not throttled. Nothing
    in the type system or in a code review reliably catches that, so this walks
    the real URLconf, the same way tests/test_endpoint_authorisation.py does.
  * **Tuning.** The numbers have to keep a shape - DRF must be able to parse
    them, and the ordering between them is the policy: a request that writes a
    row for a new identity is worth less allowance than reading a screen.

Enforcement - that a limit actually refuses the eleventh request, with the right
envelope - is the companion file, `apps/common/tests/test_throttling.py`, which
arms throttling per test. It is separate because arming it needs the app
registry and a client; this file only needs the URLconf.

The thresholds themselves live in `apps/common/throttling.py`; this file imports
that module rather than restating any number, so tuning a rate cannot silently
disagree with the test that guards it.
"""

from __future__ import annotations

import pytest
from django.conf import settings
from django.urls import get_resolver

from apps.common import throttling

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# Coverage: what the URLconf actually publishes
# ---------------------------------------------------------------------------

#: Routes with no throttle, and why that is defensible. Anything else that
#: appears here is a view someone forgot to scope.
UNTHROTTLED = {
    "health": (
        "Unversioned liveness probe, AllowAny by design. A load balancer polls it on a "
        "fixed interval and a throttled probe reads as an outage. It runs one `SELECT 1`."
    ),
    "APIRootView": (
        "DRF's generated router index. Authenticated, lists route names, reads no data - "
        "see test_the_router_index_exposes_no_data in test_endpoint_authorisation.py."
    ),
}


#: Django's admin is not part of this API surface and is deliberately excluded
#: from the walk below. It is session-authenticated by a Django account, gated
#: by that framework's own `is_staff` and per-model permissions rather than by
#: this product's capability matrix, and every write through it is mirrored into
#: `audit_events` (apps/common/admin.py). Walking it here would assert the wrong
#: rule against the wrong surface - and did, loudly, the moment it was mounted.
def _is_admin_route(path: str) -> bool:
    return path.startswith(str(settings.ADMIN_URL).lstrip("/"))


def _routes():
    """(path, view class or function name, scope, throttle class names)."""
    found = []

    def walk(resolver, prefix=""):
        for pattern in resolver.url_patterns:
            path = prefix + str(pattern.pattern)
            if hasattr(pattern, "url_patterns"):
                walk(pattern, path)
                continue
            if _is_admin_route(path):
                continue
            callback = pattern.callback
            view = getattr(callback, "cls", None) or getattr(callback, "view_class", None)
            if view is None:
                found.append((path, callback.__name__, None, []))
                continue
            classes = [c.__name__ for c in (getattr(view, "throttle_classes", None) or [])]
            found.append((path, view.__name__, getattr(view, "throttle_scope", None), classes))

    walk(get_resolver())
    return found


ROUTES = _routes()


def test_the_route_table_is_not_empty():
    """A resolver that yields nothing would make every test below vacuous."""
    assert len(ROUTES) > 20, f"only {len(ROUTES)} routes found - did the URLconf move?"


def test_every_published_route_is_throttled():
    """The regression this file exists for.

    A new view without `throttle_scope` is unthrottled, because the only default
    class is `ScopedRateThrottle` and an unscoped view makes it a no-op.
    """
    naked = sorted(
        {
            f"{name} ({path})"
            for path, name, scope, classes in ROUTES
            if name not in UNTHROTTLED
            # A view naming its own throttle class does not need a scope.
            and not scope
            and classes in ([], ["ScopedRateThrottle"])
        }
    )
    assert not naked, (
        "these routes have no effective rate limit - give the view a `throttle_scope`, "
        "or add it to UNTHROTTLED with a reason:\n  " + "\n  ".join(naked)
    )


def test_every_scope_a_view_declares_has_a_configured_rate():
    """A scope with no rate is not a loose limit either.

    DRF raises ImproperlyConfigured on the first request - a 500 on a live
    endpoint - so a typo in `throttle_scope` fails here instead.
    """
    declared = {scope for _, _, scope, _ in ROUTES if scope}
    missing = sorted(declared - set(throttling.THROTTLE_RATES))
    assert not missing, f"scopes used by views with no rate in apps/common/throttling.py: {missing}"


def test_the_settings_read_the_rates_module():
    """One source for the numbers, so a tuned rate cannot miss this file.

    Asserted against `settings.base`, not the settings in force: the test
    settings blank the rates on purpose (see the test below), and it is the base
    module that every real environment loads.
    """
    import sys

    base = sys.modules["eduai_backend.settings.base"]
    assert base.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] is throttling.THROTTLE_RATES


def test_the_suite_runs_with_throttling_off():
    """States the premise of every enforcement test below.

    If this ever fails, the 900 other tests have started sharing throttle
    buckets with each other and will fail in ways that look unrelated.
    """
    assert settings.REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"] == []


# ---------------------------------------------------------------------------
# Tuning: the numbers themselves, and the shape they have to keep
# ---------------------------------------------------------------------------


def parse(rate: str) -> tuple[int, str]:
    count, _, period = rate.partition("/")
    return int(count), period


@pytest.mark.parametrize("scope,rate", sorted(throttling.THROTTLE_RATES.items()))
def test_every_rate_is_a_shape_drf_can_parse(scope, rate):
    """`parse_rate` splits on "/" and reads the first letter of the period. A
    typo like "10/minute " parses as something else entirely, or crashes on the
    first request to that scope."""
    count, period = parse(rate)
    assert count > 0
    assert period[0] in {"s", "m", "h", "d"}, f"{scope}: {rate}"


def test_the_webhook_allowance_survives_a_gateway_retry_storm():
    """A throttled webhook is a payment the product never learns about, and the
    gateway's redelivery is finite. It has to sit well above ordinary traffic."""
    webhook, _ = parse(throttling.WEBHOOK)
    user, _ = parse(throttling.USER)
    assert webhook >= 2 * user


def test_the_money_and_signup_paths_are_tighter_than_ordinary_reads():
    """The ordering is the policy: a request that writes a row for a new
    identity, or opens an order at the gateway, is worth less of an allowance
    than reading a screen."""
    user, _ = parse(throttling.USER)
    for tighter in (throttling.AUTH, throttling.CHECKOUT, throttling.AI):
        count, _ = parse(tighter)
        assert count < user


def test_the_invite_code_limit_is_hourly_and_small():
    """The one limit that is a brute-force control rather than a fair-use one.
    An account gets ten guesses an hour at a 50-bit code."""
    count, period = parse(throttling.PARENT_LINK)
    assert period.startswith("h")
    assert count <= 10


def test_the_redemption_throttle_agrees_with_the_configured_rate():
    """`RedemptionThrottle` carries its own fallback so that blanking the rates
    (as the test settings do) cannot switch the brute-force limit off. The two
    must not drift apart."""
    from apps.tenants.parents.views import RedemptionThrottle

    assert RedemptionThrottle.FALLBACK_RATE == throttling.PARENT_LINK
    assert RedemptionThrottle.scope == "parent_link"
