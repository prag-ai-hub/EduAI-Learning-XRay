"""Fixtures for the billing suite.

Two things every test here needs and neither of which may be real:

  * **Settings.** Checkout refuses to price anything until the GST hooks are
    set, which is the point of them, so every test that reaches a total has to
    supply a rate. 18% and state 27 are used throughout as *arbitrary test
    values* - nothing here is a claim about what EduAI Hub should charge.
  * **A gateway that does not exist.** `fake_gateway` replaces
    `httpx.Client.request`, which is the single place gateway.py opens a socket.
    Any test that forgets it gets `GatewayNotConfigured` rather than a network
    call, because the keys are empty in the test settings - the suite cannot
    reach Razorpay even by mistake.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import httpx
import pytest
from django.utils import timezone

#: Deliberately fake credentials and an arbitrary tax rate. `PAYMENT_GATEWAY_*`
#: must be non-empty for `gateway.configured()` to let a request through to the
#: patched transport at all.
#:
#: The key id is kept deliberately short. `tests/test_secrets_audit.py` treats
#: `rzp_(live|test)_` followed by ten or more characters as a real Razorpay key
#: wherever it appears in the tree, and it is right to: a fixture that looks
#: exactly like a credential is how a real one eventually gets committed beside
#: it and read straight past.
BILLING_SETTINGS = {
    "PAYMENT_GATEWAY_KEY_ID": "rzp_test_x",
    "PAYMENT_GATEWAY_KEY_SECRET": "notarealsecret",
    "PAYMENT_GATEWAY_BASE_URL": "https://api.razorpay.test/v1",
    "GST_RATE_BPS": 1800,
    "GST_SELLER_STATE_CODE": "27",
    "GST_SELLER_GSTIN": "27AAAAA0000A1Z5",
    "GST_SAC_CODE": "997331",
}

#: A valid-shaped Maharashtra GSTIN (state 27), matching the seller above, so
#: the default billing block exercises the intra-state path.
BILLING_BODY = {
    "billing_name": "Nehru Vidyalaya Trust",
    "billing_address": {"line1": "12 MG Road", "city": "Pune", "pincode": "411001"},
    "gstin": "27AAACN0000A1Z5",
    "place_of_supply": "27",
}


def billing(**over) -> dict:
    return {**BILLING_BODY, **over}


@pytest.fixture
def fake_gateway(monkeypatch):
    """Stand in for Razorpay. Records every call; opens no socket.

    Returns the patch object so a test can assert how many orders were created -
    which is how the idempotency tests prove there was only ever one.
    """

    def _install(*, order_id: str | None = None, status: int = 200, body: dict | None = None):
        calls: list[dict] = []

        def _request(self, method, url, **kwargs):
            calls.append({"method": method, "url": url, **kwargs})
            payload = (
                body if body is not None else {"id": order_id or f"order_{uuid.uuid4().hex[:14]}"}
            )
            return httpx.Response(status, json=payload, request=httpx.Request(method, url))

        monkeypatch.setattr(httpx.Client, "request", _request)
        return calls

    return _install


@pytest.fixture
def make_plan(db):
    """A plan on sale. Amounts are test values, not prices."""

    def _make(
        *,
        audience="school",
        billing_period="annual",
        amount_paise=100_000,
        credits_included=100,
        status="active",
        code=None,
        name=None,
        features=None,
        max_teachers=None,
        max_students=None,
    ):
        from apps.billing.subscriptions.models import GATEWAY_RAZORPAY, Plan

        now = timezone.now()
        code = code or f"test_{uuid.uuid4().hex[:12]}"
        return Plan.objects.create(
            id=uuid.uuid4(),
            code=code,
            name=name or code,
            description="A test plan.",
            audience=audience,
            billing_period=billing_period,
            amount_paise=amount_paise,
            currency="INR",
            credits_included=credits_included,
            max_teachers=max_teachers,
            max_students=max_students,
            features=features if features is not None else {},
            gateway=GATEWAY_RAZORPAY,
            gateway_plan_id=None,
            status=status,
            sort_order=0,
            created_at=now,
            updated_at=now,
        )

    return _make


@pytest.fixture
def make_payment(db):
    """A payment row in whatever state a test needs it in.

    Written directly rather than through checkout so that a capture-time test
    does not have to stand up a gateway to reach the thing it is testing.
    """

    def _make(
        *,
        plan,
        school=None,
        parent_user=None,
        purpose=None,
        status="created",
        tax_paise=0,
        gateway_payment_id=None,
    ):
        from apps.billing.subscriptions.models import GATEWAY_RAZORPAY, Payment

        now = timezone.now()
        purpose = purpose or ("credit_topup" if parent_user else "subscription")
        return Payment.objects.create(
            id=uuid.uuid4(),
            school=school,
            parent_user=parent_user,
            subscription=None,
            plan=plan,
            purpose=purpose,
            amount_paise=plan.amount_paise,
            tax_paise=tax_paise,
            total_paise=plan.amount_paise + tax_paise,
            currency=plan.currency,
            status=status,
            gateway=GATEWAY_RAZORPAY,
            gateway_order_id=f"order_{uuid.uuid4().hex[:14]}",
            gateway_payment_id=gateway_payment_id,
            idempotency_key=f"{purpose}:{uuid.uuid4()}",
            notes={},
            captured_at=now if status == "captured" else None,
            created_at=now,
            updated_at=now,
        )

    return _make


@pytest.fixture
def make_subscription(db):
    """A live subscription, positioned relative to now by `days_left`."""

    def _make(*, school, plan, status="active", days_left=200):
        from apps.billing.subscriptions.models import GATEWAY_RAZORPAY, Subscription

        now = timezone.now()
        end = now + timedelta(days=days_left)
        return Subscription.objects.create(
            id=uuid.uuid4(),
            school=school,
            plan=plan,
            status=status,
            current_period_start=now - timedelta(days=30),
            current_period_end=end,
            grace_until=None,
            cancel_at_period_end=False,
            gateway=GATEWAY_RAZORPAY,
            started_at=now - timedelta(days=30),
            created_at=now - timedelta(days=30),
            updated_at=now,
        )

    return _make
