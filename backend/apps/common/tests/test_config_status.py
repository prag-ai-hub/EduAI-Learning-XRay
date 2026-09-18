"""`config_status` - the set-up report.

It exists to answer "what works here, and what is stopping the rest" without
anyone reading four modules to find out. Two properties matter enough to pin:
it must never print a secret's value, and a capability whose settings are unset
must be reported as blocked rather than quietly passed over.
"""

from __future__ import annotations

from io import StringIO

import pytest
from django.core.management import call_command

pytestmark = pytest.mark.django_db


def report(**options) -> str:
    out = StringIO()
    call_command("config_status", stdout=out, stderr=out, **options)
    return out.getvalue()


def test_it_reports_every_capability():
    from apps.common.management.commands.config_status import CAPABILITIES

    output = report()

    for capability in CAPABILITIES:
        assert capability.name in output


def test_an_unset_capability_is_blocked_and_says_what_it_stops(settings):
    settings.OPENAI_API_KEY = ""
    settings.OPENAI_MODEL = ""

    output = report()

    assert "AI grading" in output
    assert "OPENAI_API_KEY" in output
    assert "Grading an answer sheet" in output


def test_a_configured_capability_is_ready(settings):
    settings.OPENAI_API_KEY = "present-for-this-test"
    settings.OPENAI_MODEL = "gpt-5"

    output = report()

    line = next(line for line in output.splitlines() if line.strip().startswith("AI grading"))
    assert "READY" in line


def test_it_never_prints_the_value_of_a_secret(settings):
    """The report is meant to be safe to paste into a ticket.

    The stand-in values deliberately carry no provider prefix: `tests/
    test_secrets_audit.py` scans this file like any other, and an `sk-` string
    here would fail the build - as it did when this test was first written.
    """
    settings.OPENAI_API_KEY = "secret-value-that-must-not-be-printed"
    settings.PAYMENT_GATEWAY_KEY_SECRET = "another-value-that-must-not-be-printed"

    output = report()

    assert "must-not-be-printed" not in output


def test_an_optional_capability_degrades_rather_than_blocks(settings):
    """A missing REDIS_URL loosens the rate limits; it does not stop the product."""
    settings.REDIS_URL = ""

    line = next(
        line for line in report().splitlines() if line.strip().startswith("Shared rate limits")
    )

    assert "DEGRADED" in line
    assert "BLOCKED" not in line


def test_email_is_not_required_in_development(settings):
    settings.DEBUG = True
    settings.EMAIL_HOST = ""

    line = next(line for line in report().splitlines() if line.strip().startswith("Outbound email"))

    assert "READY" in line


def test_email_is_required_once_debug_is_off(settings):
    settings.DEBUG = False
    settings.EMAIL_HOST = ""
    settings.EMAIL_HOST_USER = ""
    settings.EMAIL_HOST_PASSWORD = ""

    line = next(line for line in report().splitlines() if line.strip().startswith("Outbound email"))

    assert "BLOCKED" in line


def test_placeholder_pricing_is_reported_as_degraded(db, monkeypatch):
    """A catalogue of unconfirmed amounts is not the same as a priced product.

    `PRICING_CONFIRMED` is patched to False rather than read: the prices were
    confirmed on 2026-09-18, and what is under test is the report's behaviour
    while they are not - which is what the next price change will meet.
    """
    from apps.billing.subscriptions.management.commands import seed_plans

    monkeypatch.setattr(seed_plans, "PRICING_CONFIRMED", False)
    import uuid

    from django.utils import timezone

    from apps.billing.subscriptions.models import GATEWAY_RAZORPAY, Plan

    now = timezone.now()
    Plan.objects.create(
        id=uuid.uuid4(),
        code=f"config_status_probe_{uuid.uuid4().hex[:8]}",
        name="Probe",
        description="",
        audience=Plan.Audience.SCHOOL,
        billing_period=Plan.BillingPeriod.MONTHLY,
        amount_paise=100_000,
        currency="INR",
        credits_included=10,
        features={},
        sort_order=999,
        gateway=GATEWAY_RAZORPAY,
        status=Plan.Status.ACTIVE,
        created_at=now,
        updated_at=now,
    )

    line = next(line for line in report().splitlines() if line.strip().startswith("Plans on sale"))

    assert "DEGRADED" in line
    assert "PRICING_CONFIRMED" in line


def test_strict_exits_non_zero_while_something_is_blocked(settings):
    settings.OPENAI_API_KEY = ""
    settings.OPENAI_MODEL = ""

    with pytest.raises(SystemExit) as exit_code:
        report(strict=True)

    assert exit_code.value.code == 1


def test_confirmed_pricing_is_reported_as_ready(db):
    """The state the product is actually in since the pricing table arrived."""
    import uuid

    from django.utils import timezone

    from apps.billing.subscriptions.models import GATEWAY_RAZORPAY, Plan

    now = timezone.now()
    Plan.objects.create(
        id=uuid.uuid4(),
        code=f"config_status_priced_{uuid.uuid4().hex[:8]}",
        name="Priced",
        description="",
        audience=Plan.Audience.SCHOOL,
        billing_period=Plan.BillingPeriod.ONE_TIME,
        amount_paise=350_000,
        currency="INR",
        credits_included=50,
        features={},
        sort_order=998,
        gateway=GATEWAY_RAZORPAY,
        status=Plan.Status.ACTIVE,
        created_at=now,
        updated_at=now,
    )

    line = next(line for line in report().splitlines() if line.strip().startswith("Plans on sale"))

    assert "READY" in line
