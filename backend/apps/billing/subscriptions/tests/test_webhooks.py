"""The gateway callback: the only door money comes through.

What this file is really about is that the door cannot be opened without the
key. Every state transition in the billing app is reachable only from here, so a
single missed check - a signature verified over a re-serialised body, a `!=`
comparison, a ledger row written before the signature was checked - is the whole
subscription system given away to anyone who can find the URL.

The tests are grouped as the module is: the signature, the ledger, ordering,
grace, and the seams.
"""

from __future__ import annotations

import hashlib
import hmac
import inspect
import json
import sys
import types
import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIRequestFactory

from apps.accounts.roles import PARENT
from apps.billing.subscriptions import entitlements, services, webhooks
from apps.billing.subscriptions.models import Invoice, Payment, PaymentEvent, Subscription
from apps.billing.subscriptions.webhooks import RazorpayWebhookView

from .conftest import BILLING_SETTINGS, billing

pytestmark = pytest.mark.django_db

#: A fake secret. Never a real one, and short enough not to look like one - the
#: same rule the gateway fixtures in conftest.py follow.
SECRET = "whsec_notarealsecret"


@pytest.fixture(autouse=True)
def webhook_settings(settings):
    """A secret to sign with, and a throttle counter nobody else has filled.

    The webhook scope is 300/min per address and every test here posts from
    127.0.0.1, so a long file would eventually throttle itself and fail on
    something that has nothing to do with what it was testing.
    """
    settings.PAYMENT_GATEWAY_WEBHOOK_SECRET = SECRET
    cache.clear()
    return settings


# ---------------------------------------------------------------------------
# Delivering
# ---------------------------------------------------------------------------


def sign(raw: bytes, secret: str = SECRET) -> str:
    return hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def deliver(body=None, *, raw=None, signature=..., event_id=None):
    """POST one webhook. Returns (response, event_id).

    The view is called directly rather than through a URL: `urls.py` belongs to
    another agent this week, and a test that waits for a route to exist tests
    nothing in the meantime.
    """
    if raw is None:
        raw = json.dumps(body).encode()
    if signature is ...:
        signature = sign(raw)
    event_id = event_id or f"evt_{uuid.uuid4().hex[:16]}"

    headers = {"HTTP_X_RAZORPAY_EVENT_ID": event_id}
    if signature is not None:
        headers["HTTP_X_RAZORPAY_SIGNATURE"] = signature

    request = APIRequestFactory().post(
        "/api/v1/billing/webhooks/razorpay",
        data=raw,
        content_type="application/json",
        **headers,
    )
    return RazorpayWebhookView.as_view()(request), event_id


def payment_body(payment, *, event="payment.captured", **over) -> dict:
    """A Razorpay event carrying a payment entity for one of our orders."""
    entity = {
        "id": f"pay_{uuid.uuid4().hex[:14]}",
        "order_id": payment.gateway_order_id,
        "amount": payment.total_paise,
        "currency": payment.currency,
        "method": "upi",
        "created_at": int(timezone.now().timestamp()),
        "notes": {"paymentId": str(payment.id)},
    }
    entity.update(over)
    return {
        "entity": "event",
        "account_id": "acc_test",
        "event": event,
        "contains": ["payment"],
        "payload": {"payment": {"entity": entity}},
        "created_at": int(timezone.now().timestamp()),
    }


def ledger(event_id) -> PaymentEvent:
    return PaymentEvent.objects.get(gateway_event_id=event_id)


# ---------------------------------------------------------------------------
# 16.1 - the signature is the authentication
# ---------------------------------------------------------------------------


def test_a_body_with_no_signature_moves_nothing(make_school, make_plan, make_payment):
    school = make_school()
    payment = make_payment(plan=make_plan(), school=school, purpose="subscription")

    response, event_id = deliver(payment_body(payment), signature=None)

    assert response.status_code == 400
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CREATED
    assert not Subscription.objects.filter(school=school).exists()
    assert not PaymentEvent.objects.filter(gateway_event_id=event_id).exists()


def test_a_valid_looking_body_with_a_wrong_signature_moves_nothing(
    make_school, make_plan, make_payment
):
    """The test the whole module exists to pass.

    The payload is exactly what a real capture looks like. Only the signature is
    wrong, and that alone must be the difference between a subscription and
    nothing at all.
    """
    school = make_school()
    payment = make_payment(plan=make_plan(), school=school, purpose="subscription")
    body = payment_body(payment)

    response, event_id = deliver(body, signature="0" * 64)

    assert response.status_code == 400
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CREATED
    assert payment.captured_at is None
    assert not Subscription.objects.filter(school=school).exists()
    # And no ledger row: an unverified caller must not be able to squat on the
    # event id of the genuine delivery that follows and have it dismissed as a
    # duplicate.
    assert not PaymentEvent.objects.filter(gateway_event_id=event_id).exists()


def test_a_signature_signed_with_another_secret_is_refused(make_school, make_plan, make_payment):
    payment = make_payment(plan=make_plan(), school=make_school(), purpose="subscription")
    raw = json.dumps(payment_body(payment)).encode()

    response, _ = deliver(raw=raw, signature=sign(raw, "some_other_secret"))

    assert response.status_code == 400
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CREATED


def test_verification_is_over_the_raw_bytes_that_were_signed(make_school, make_plan, make_payment):
    """Signed with odd spacing and key order; verified byte for byte.

    A handler that parsed first and re-serialised would compute the digest over
    `{"event": ...}` in Python's own ordering and spacing, and this delivery -
    which is genuine - would be refused.
    """
    school = make_school()
    payment = make_payment(plan=make_plan(), school=school, purpose="subscription")
    entity = payment_body(payment)["payload"]["payment"]["entity"]
    raw = (
        b'{  "payload" : {"payment": {"entity": '
        + json.dumps(entity).encode()
        + b'}},\n  "event"  :  "payment.captured"  }'
    )

    response, _ = deliver(raw=raw, signature=sign(raw))

    assert response.status_code == 200
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CAPTURED


def test_a_signature_for_a_differently_serialised_body_is_refused(
    make_school, make_plan, make_payment
):
    """Same JSON, different bytes. The signature covers the bytes."""
    payment = make_payment(plan=make_plan(), school=make_school(), purpose="subscription")
    body = payment_body(payment)
    signed = json.dumps(body, indent=2).encode()

    response, _ = deliver(raw=json.dumps(body).encode(), signature=sign(signed))

    assert response.status_code == 400
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CREATED


def test_the_comparison_is_constant_time():
    """Asserted by reading the source, because timing it would be flaky.

    A `==` here leaks the expected digest a byte at a time to anyone who can
    measure the response, and the leak is of the thing that authenticates every
    payment this service will ever take.
    """
    source = inspect.getsource(webhooks.signature_ok)
    assert "compare_digest" in source
    assert "==" not in source


def test_a_hostile_signature_header_is_refused_not_a_500():
    assert webhooks.signature_ok(b"{}", " " * 64, SECRET) is False
    assert webhooks.signature_ok(b"{}", "", SECRET) is False
    assert webhooks.signature_ok(b"{}", None, SECRET) is False


def test_an_unset_secret_refuses_every_delivery(
    webhook_settings, make_school, make_plan, make_payment
):
    """503, not 400. The gateway retries a 503, so nothing is lost while it is fixed."""
    webhook_settings.PAYMENT_GATEWAY_WEBHOOK_SECRET = ""
    payment = make_payment(plan=make_plan(), school=make_school(), purpose="subscription")

    response, event_id = deliver(payment_body(payment))

    assert response.status_code == 503
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CREATED
    assert not PaymentEvent.objects.filter(gateway_event_id=event_id).exists()


def test_a_signed_body_that_is_not_json_is_refused():
    response, event_id = deliver(raw=b"not json at all")

    assert response.status_code == 400
    assert not PaymentEvent.objects.filter(gateway_event_id=event_id).exists()


def test_a_signed_body_with_no_event_type_is_refused():
    response, event_id = deliver({"payload": {}})

    assert response.status_code == 400
    assert not PaymentEvent.objects.filter(gateway_event_id=event_id).exists()


# ---------------------------------------------------------------------------
# 16.2 - the ledger and idempotency
# ---------------------------------------------------------------------------


def test_a_capture_activates_the_subscription_and_is_recorded(make_school, make_plan, make_payment):
    school = make_school()
    plan = make_plan(billing_period="annual", credits_included=500)
    payment = make_payment(plan=plan, school=school, purpose="subscription")

    response, event_id = deliver(payment_body(payment))

    assert response.status_code == 200
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CAPTURED
    assert payment.gateway_payment_id
    assert payment.method == "upi"

    subscription = Subscription.objects.get(school=school)
    assert subscription.status == Subscription.Status.ACTIVE
    assert subscription.plan_id == plan.id

    row = ledger(event_id)
    assert row.status == PaymentEvent.Status.PROCESSED
    assert row.signature_verified is True
    assert row.payment_id == payment.id
    assert row.subscription_id == subscription.id
    assert row.payload["event"] == "payment.captured"


def test_a_redelivered_event_changes_nothing_and_still_answers_2xx(
    make_school, make_plan, make_payment
):
    school = make_school()
    payment = make_payment(plan=make_plan(billing_period="annual"), school=school)
    body = payment_body(payment)

    first, event_id = deliver(body, event_id="evt_same")
    second, _ = deliver(body, event_id="evt_same")

    assert (first.status_code, second.status_code) == (200, 200)
    assert second.data["status"] == "duplicate"
    assert PaymentEvent.objects.filter(gateway_event_id="evt_same").count() == 1

    subscription = Subscription.objects.get(school=school)
    # The period was not extended a second time by the redelivery.
    assert subscription.current_period_end == services.period_end(
        payment.plan, subscription.current_period_start
    )


def test_a_redelivered_topup_grants_the_credits_only_once(make_user, make_plan, make_payment):
    parent = make_user(PARENT)
    before = parent.total_credits
    plan = make_plan(audience="parent", billing_period="one_time", credits_included=40)
    payment = make_payment(plan=plan, parent_user=parent, purpose="credit_topup")
    body = payment_body(payment)

    deliver(body, event_id="evt_topup")
    second, _ = deliver(body, event_id="evt_topup")

    assert second.status_code == 200
    parent.refresh_from_db()
    assert parent.total_credits == before + 40


def test_a_second_delivery_under_a_new_event_id_grants_nothing_twice(
    make_user, make_plan, make_payment
):
    """The ledger is not the only guard, and must not be the only guard.

    A gateway that reissues an event id, or a replay assembled by hand, gets
    past the unique index. What stops it is that the capture-time seams are
    themselves idempotent - so the second delivery finds the payment already
    settled and grants nothing.
    """
    parent = make_user(PARENT)
    before = parent.total_credits
    plan = make_plan(audience="parent", billing_period="one_time", credits_included=40)
    payment = make_payment(plan=plan, parent_user=parent, purpose="credit_topup")
    body = payment_body(payment)

    deliver(body, event_id="evt_one")
    second, second_id = deliver(body, event_id="evt_two")

    assert second.status_code == 200
    assert ledger(second_id).status == PaymentEvent.Status.PROCESSED
    parent.refresh_from_db()
    assert parent.total_credits == before + 40


def test_an_event_naming_an_unknown_order_is_recorded_failed_and_acknowledged():
    """Permanent, so 2xx: a retry cannot conjure the payment row."""
    body = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_ghost",
                    "order_id": "order_that_is_not_ours",
                    "amount": 1000,
                    "currency": "INR",
                }
            }
        },
    }

    response, event_id = deliver(body)

    assert response.status_code == 200
    assert response.data["retryable"] is False
    row = ledger(event_id)
    assert row.status == PaymentEvent.Status.FAILED
    assert "no payment matches" in row.processing_error


def test_an_unrecognised_event_type_is_recorded_and_acknowledged():
    """Razorpay adds event types without asking. That is not an incident."""
    response, event_id = deliver({"event": "payment.dispute.created", "payload": {}})

    assert response.status_code == 200
    row = ledger(event_id)
    assert row.status == PaymentEvent.Status.IGNORED
    assert row.payload["event"] == "payment.dispute.created"


def test_a_transient_failure_answers_5xx_and_the_redelivery_replays_it(
    monkeypatch, make_school, make_plan, make_payment
):
    """A failed row is replayable. Without that, insert-first would swallow it.

    The gateway is told to retry (5xx) and the ledger keeps the payload at
    `failed`; the redelivery of the same event id must then pick it up rather
    than dismiss it as a duplicate.
    """
    school = make_school()
    payment = make_payment(plan=make_plan(billing_period="annual"), school=school)
    body = payment_body(payment)

    def boom(_payment):
        raise RuntimeError("the database went away")

    monkeypatch.setattr(services, "activate_subscription", boom)
    first, _ = deliver(body, event_id="evt_flaky")

    assert first.status_code == 500
    assert first.data["retryable"] is True
    row = ledger("evt_flaky")
    assert row.status == PaymentEvent.Status.FAILED
    assert "the database went away" in row.processing_error
    assert not Subscription.objects.filter(school=school).exists()

    monkeypatch.undo()
    second, _ = deliver(body, event_id="evt_flaky")

    assert second.status_code == 200
    assert ledger("evt_flaky").status == PaymentEvent.Status.PROCESSED
    assert Subscription.objects.get(school=school).status == Subscription.Status.ACTIVE


def test_a_payload_that_charges_a_different_amount_never_captures(
    make_school, make_plan, make_payment
):
    """A signature proves the sender, not that the sum is the one we invoiced."""
    school = make_school()
    payment = make_payment(plan=make_plan(amount_paise=500_000), school=school)

    response, event_id = deliver(payment_body(payment, amount=1))

    assert response.status_code == 200
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CREATED
    assert not Subscription.objects.filter(school=school).exists()
    assert ledger(event_id).status == PaymentEvent.Status.FAILED


def test_a_payload_naming_two_different_payments_is_refused(make_school, make_plan, make_payment):
    school = make_school()
    plan = make_plan()
    payment = make_payment(plan=plan, school=school)
    other = make_payment(plan=plan, school=school)

    body = payment_body(payment, notes={"paymentId": str(other.id)})
    response, event_id = deliver(body)

    assert response.status_code == 200
    payment.refresh_from_db()
    other.refresh_from_db()
    assert payment.status == other.status == Payment.Status.CREATED
    assert "different payments" in ledger(event_id).processing_error


# ---------------------------------------------------------------------------
# Ordering - deliveries arrive in the wrong order
# ---------------------------------------------------------------------------


def test_a_failure_arriving_after_a_capture_does_not_move_the_payment_back(
    make_school, make_plan, make_payment
):
    school = make_school()
    plan = make_plan(billing_period="annual")
    payment = make_payment(plan=plan, school=school)

    deliver(payment_body(payment))
    response, event_id = deliver(payment_body(payment, event="payment.failed"))

    assert response.status_code == 200
    assert "already captured" in response.data["outcome"]
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CAPTURED
    assert ledger(event_id).status == PaymentEvent.Status.PROCESSED
    # ...and the subscription the capture activated is untouched.
    subscription = Subscription.objects.get(school=school)
    assert subscription.status == Subscription.Status.ACTIVE
    assert subscription.grace_until is None


def test_a_capture_arriving_after_a_failure_is_honoured(make_school, make_plan, make_payment):
    """The second card worked. Refusing that capture would take money for nothing."""
    school = make_school()
    payment = make_payment(plan=make_plan(billing_period="annual"), school=school)

    deliver(payment_body(payment, event="payment.failed", error_code="BAD_REQUEST_ERROR"))
    response, _ = deliver(payment_body(payment))

    assert response.status_code == 200
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CAPTURED
    assert payment.failure_code is None
    assert Subscription.objects.get(school=school).status == Subscription.Status.ACTIVE


def test_an_authorisation_arriving_after_its_capture_does_not_uncapture(
    make_school, make_plan, make_payment
):
    school = make_school()
    payment = make_payment(plan=make_plan(billing_period="annual"), school=school)

    deliver(payment_body(payment))
    response, _ = deliver(payment_body(payment, event="payment.authorized"))

    assert response.status_code == 200
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CAPTURED


def test_an_authorisation_alone_grants_nothing(make_school, make_plan, make_payment):
    school = make_school()
    payment = make_payment(plan=make_plan(billing_period="annual"), school=school)

    response, _ = deliver(payment_body(payment, event="payment.authorized"))

    assert response.status_code == 200
    payment.refresh_from_db()
    assert payment.status == Payment.Status.AUTHORIZED
    assert not Subscription.objects.filter(school=school).exists()


def test_the_capture_is_dated_by_the_gateway_not_by_the_delivery(
    make_school, make_plan, make_payment
):
    """A redelivery days later must not redate the money, or the invoice."""
    school = make_school()
    payment = make_payment(plan=make_plan(billing_period="annual"), school=school)
    moved = timezone.now() - timedelta(days=3)

    deliver(payment_body(payment, created_at=int(moved.timestamp())))

    payment.refresh_from_db()
    assert abs((payment.captured_at - moved).total_seconds()) < 2


# ---------------------------------------------------------------------------
# 17.3 - failed renewal, grace, and the boundary
# ---------------------------------------------------------------------------


def test_a_failed_upgrade_leaves_a_live_subscription_alone(
    make_school, make_plan, make_payment, make_subscription
):
    """A school with 200 days paid tries to upgrade, and the card is declined.

    The attempt bought nothing; the subscription it was meant to replace is
    untouched. Opening a grace window here would set grace_until seven days out
    on a period running for another two hundred, so `resolve_entitlement` would
    cut them off in a week - for trying to give us more money.
    """
    school = make_school()
    plan = make_plan(billing_period="annual", features={"grading": True})
    subscription = make_subscription(school=school, plan=plan, days_left=200)
    payment = make_payment(plan=plan, school=school, purpose="subscription")

    response, _ = deliver(payment_body(payment, event="payment.failed"))

    assert response.status_code == 200
    subscription.refresh_from_db()
    assert subscription.status != Subscription.Status.PAST_DUE
    assert subscription.grace_until is None, "a paid-up period was put into grace"

    entitlement = entitlements.for_school(school.id)
    assert entitlement.has_entitlement is True
    assert entitlement.status == "active"


def test_a_stale_failure_for_a_superseded_attempt_changes_nothing(
    make_school, make_plan, make_payment, make_subscription
):
    """Attempt 1 declines, attempt 2 captures, then attempt 1's webhook arrives.

    A retry after a decline is a NEW payment row against a NEW order, so the
    terminal-status guard cannot see that the money already landed - it is
    looking at attempt 1, which is legitimately still `created`. The live period
    attempt 2 bought is what makes this a no-op.
    """
    school = make_school()
    plan = make_plan(billing_period="annual", features={"grading": True})
    subscription = make_subscription(school=school, plan=plan, days_left=365)
    declined = make_payment(plan=plan, school=school, purpose="subscription")

    response, _ = deliver(payment_body(declined, event="payment.failed"))

    assert response.status_code == 200
    declined.refresh_from_db()
    assert declined.status == Payment.Status.FAILED, "the attempt itself still records failure"

    subscription.refresh_from_db()
    assert subscription.grace_until is None
    assert entitlements.for_school(school.id).has_entitlement is True


def test_a_failed_renewal_opens_a_grace_window_and_does_not_cut_the_school_off(
    make_school, make_plan, make_payment, make_subscription
):
    school = make_school()
    plan = make_plan(billing_period="monthly", features={"grading": True})
    subscription = make_subscription(school=school, plan=plan, days_left=0)
    payment = make_payment(plan=plan, school=school, purpose="subscription_renewal")

    response, _ = deliver(
        payment_body(
            payment,
            event="payment.failed",
            error_code="BAD_REQUEST_ERROR",
            error_description="Card declined",
        )
    )

    assert response.status_code == 200
    payment.refresh_from_db()
    assert payment.status == Payment.Status.FAILED
    assert payment.failure_code == "BAD_REQUEST_ERROR"

    subscription.refresh_from_db()
    assert subscription.status == Subscription.Status.PAST_DUE
    expected = timezone.now() + webhooks.GRACE_PERIOD
    assert abs((subscription.grace_until - expected).total_seconds()) < 60

    # The whole point of a grace window: the school keeps working.
    entitlement = entitlements.for_school(school.id)
    assert entitlement.has_entitlement is True
    assert entitlement.status == "past_due"


def test_the_grace_boundary_holds_on_both_sides(
    make_school, make_plan, make_payment, make_subscription
):
    """One minute inside the window entitles; one minute outside does not.

    Read through `resolve_entitlement`, never through a second rule written
    here: the SQL function is what every service asks, and a Python copy of it
    would be a rule enforced in neither.
    """
    school = make_school()
    plan = make_plan(billing_period="monthly")
    subscription = make_subscription(school=school, plan=plan, days_left=0)
    payment = make_payment(plan=plan, school=school, purpose="subscription_renewal")

    deliver(payment_body(payment, event="payment.failed"))
    subscription.refresh_from_db()

    subscription.grace_until = timezone.now() + timedelta(minutes=1)
    subscription.save(update_fields=["grace_until"])
    assert entitlements.for_school(school.id).has_entitlement is True

    subscription.grace_until = timezone.now() - timedelta(minutes=1)
    subscription.save(update_fields=["grace_until"])
    assert entitlements.for_school(school.id).has_entitlement is False


def test_a_second_failure_does_not_extend_the_grace_window(
    make_school, make_plan, make_payment, make_subscription
):
    """Otherwise a card that fails nightly renews its own reprieve forever."""
    school = make_school()
    plan = make_plan(billing_period="monthly")
    subscription = make_subscription(school=school, plan=plan, days_left=0)
    first = make_payment(plan=plan, school=school, purpose="subscription_renewal")
    second = make_payment(plan=plan, school=school, purpose="subscription_renewal")

    deliver(payment_body(first, event="payment.failed"))
    subscription.refresh_from_db()
    opened = subscription.grace_until

    # Six days later the retry fails too. The clock does not restart.
    subscription.grace_until = opened - timedelta(days=6)
    subscription.save(update_fields=["grace_until"])
    deliver(payment_body(second, event="payment.failed"))

    subscription.refresh_from_db()
    assert subscription.grace_until == opened - timedelta(days=6)
    assert subscription.status == Subscription.Status.PAST_DUE


def test_a_successful_renewal_after_a_failure_closes_the_grace_window(
    make_school, make_plan, make_payment, make_subscription
):
    school = make_school()
    plan = make_plan(billing_period="monthly")
    subscription = make_subscription(school=school, plan=plan, days_left=0)
    failed = make_payment(plan=plan, school=school, purpose="subscription_renewal")
    paid = make_payment(plan=plan, school=school, purpose="subscription_renewal")

    deliver(payment_body(failed, event="payment.failed"))
    deliver(payment_body(paid))

    subscription.refresh_from_db()
    assert subscription.status == Subscription.Status.ACTIVE
    assert subscription.grace_until is None


def test_a_failed_topup_touches_no_subscription_and_no_balance(make_user, make_plan, make_payment):
    parent = make_user(PARENT)
    before = parent.total_credits
    plan = make_plan(audience="parent", billing_period="one_time", credits_included=40)
    payment = make_payment(plan=plan, parent_user=parent, purpose="credit_topup")

    response, event_id = deliver(payment_body(payment, event="payment.failed"))

    assert response.status_code == 200
    assert ledger(event_id).status == PaymentEvent.Status.PROCESSED
    parent.refresh_from_db()
    assert parent.total_credits == before


def test_a_failure_with_no_subscription_to_protect_is_still_recorded(
    make_school, make_plan, make_payment
):
    """A first subscription that never captured leaves the school where it was."""
    school = make_school()
    payment = make_payment(plan=make_plan(), school=school, purpose="subscription")

    response, event_id = deliver(payment_body(payment, event="payment.failed"))

    assert response.status_code == 200
    assert ledger(event_id).status == PaymentEvent.Status.PROCESSED
    assert not Subscription.objects.filter(school=school).exists()


# ---------------------------------------------------------------------------
# Renewal and cancellation from the gateway
# ---------------------------------------------------------------------------


def test_subscription_charged_appends_the_new_period(
    make_school, make_plan, make_payment, make_subscription
):
    """A renewal is appended, never restarted - the rule services.py owns."""
    school = make_school()
    plan = make_plan(billing_period="monthly")
    subscription = make_subscription(school=school, plan=plan, days_left=5)
    end_before = subscription.current_period_end
    payment = make_payment(plan=plan, school=school, purpose="subscription_renewal")

    body = payment_body(payment, event="subscription.charged")
    response, event_id = deliver(body)

    assert response.status_code == 200
    subscription.refresh_from_db()
    assert subscription.status == Subscription.Status.ACTIVE
    assert subscription.current_period_start == end_before
    assert subscription.current_period_end == services.add_months(end_before, 1)
    assert ledger(event_id).payment_id == payment.id


def test_subscription_cancelled_keeps_the_period_already_paid_for(
    make_school, make_plan, make_subscription
):
    school = make_school()
    subscription = make_subscription(school=school, plan=make_plan(), days_left=40)
    subscription.gateway_subscription_id = "sub_gateway_1"
    subscription.save(update_fields=["gateway_subscription_id"])

    response, event_id = deliver(
        {
            "event": "subscription.cancelled",
            "payload": {"subscription": {"entity": {"id": "sub_gateway_1"}}},
        }
    )

    assert response.status_code == 200
    subscription.refresh_from_db()
    assert subscription.cancel_at_period_end is True
    assert subscription.cancelled_at is not None
    # Still entitled: they paid for these forty days.
    assert subscription.status == Subscription.Status.ACTIVE
    assert entitlements.for_school(school.id).has_entitlement is True
    assert ledger(event_id).subscription_id == subscription.id


def test_subscription_cancelled_with_nothing_left_to_serve_ends_it(
    make_school, make_plan, make_subscription
):
    school = make_school()
    subscription = make_subscription(school=school, plan=make_plan(), days_left=-1)
    subscription.gateway_subscription_id = "sub_gateway_2"
    subscription.save(update_fields=["gateway_subscription_id"])

    response, _ = deliver(
        {
            "event": "subscription.cancelled",
            "payload": {"subscription": {"entity": {"id": "sub_gateway_2"}}},
        }
    )

    assert response.status_code == 200
    subscription.refresh_from_db()
    assert subscription.status == Subscription.Status.CANCELLED
    assert subscription.ended_at is not None
    assert entitlements.for_school(school.id).has_entitlement is False


def test_a_cancellation_for_a_mandate_we_do_not_hold_is_recorded_and_acknowledged():
    response, event_id = deliver(
        {
            "event": "subscription.cancelled",
            "payload": {"subscription": {"entity": {"id": "sub_someone_elses"}}},
        }
    )

    assert response.status_code == 200
    assert ledger(event_id).status == PaymentEvent.Status.FAILED


def test_an_event_missing_the_entity_it_promises_is_recorded_and_acknowledged():
    response, event_id = deliver({"event": "payment.captured", "payload": {}})

    assert response.status_code == 200
    row = ledger(event_id)
    assert row.status == PaymentEvent.Status.FAILED
    assert "payload.payment.entity" in row.processing_error


# ---------------------------------------------------------------------------
# The invoice seam
# ---------------------------------------------------------------------------


def _fake_invoices(calls, *, explode=False):
    module = types.ModuleType(webhooks.INVOICE_ENTRY_POINT[0])

    def issue_for_payment(payment):
        calls.append(payment.id)
        if explode:
            raise RuntimeError("the renderer fell over")

    module.issue_for_payment = issue_for_payment
    return module


@override_settings(**BILLING_SETTINGS)
def test_a_capture_issues_the_gst_invoice(make_school, make_plan, make_payment):
    """End to end: a signed capture leaves a numbered invoice behind.

    invoices.py was written in parallel with this module and landed while this
    file was being finished, so the seam is exercised against the real thing
    rather than only against the contract below.
    """
    school = make_school()
    plan = make_plan(billing_period="annual", amount_paise=100_000)
    payment = make_payment(plan=plan, school=school, tax_paise=services.tax_paise(100_000, 1800))
    # What checkout would have snapshotted. The invoice is made out from this,
    # never from the school row as it reads today.
    payment.notes = {"billing": billing(), "taxRateBps": 1800, "planCode": plan.code}
    payment.save(update_fields=["notes"])

    response, _ = deliver(payment_body(payment))

    assert response.status_code == 200
    invoice = Invoice.objects.get(payment=payment)
    assert invoice.total_paise == payment.total_paise
    assert invoice.tax_rate_bps == 1800
    assert invoice.billing_name == billing()["billing_name"]


def test_the_invoice_entry_point_is_the_one_the_seam_names(
    monkeypatch, make_school, make_plan, make_payment
):
    """Pins the contract itself, independently of what invoices.py does today."""
    calls: list = []
    monkeypatch.setitem(sys.modules, webhooks.INVOICE_ENTRY_POINT[0], _fake_invoices(calls))
    payment = make_payment(plan=make_plan(billing_period="annual"), school=make_school())

    deliver(payment_body(payment))

    assert calls == [payment.id]


def test_an_invoice_failure_never_unwinds_the_capture(
    monkeypatch, make_school, make_plan, make_payment
):
    """The money moved. A renderer that raises must not undo that."""
    calls: list = []
    monkeypatch.setitem(
        sys.modules, webhooks.INVOICE_ENTRY_POINT[0], _fake_invoices(calls, explode=True)
    )
    school = make_school()
    payment = make_payment(plan=make_plan(billing_period="annual"), school=school)

    response, event_id = deliver(payment_body(payment))

    assert response.status_code == 200
    assert calls == [payment.id]
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CAPTURED
    assert Subscription.objects.get(school=school).status == Subscription.Status.ACTIVE
    assert ledger(event_id).status == PaymentEvent.Status.PROCESSED


def test_a_redelivery_issues_an_invoice_the_first_capture_failed_to_make(
    monkeypatch, make_school, make_plan, make_payment
):
    """A capture whose invoice raised is captured, uninvoiced, and unhealable.

    `_issue_invoice` swallows its own failures on purpose - a renderer must
    never unwind money that has moved - so the payment settles either way. The
    problem was that every later delivery stopped at "already settled" before
    reaching the seam, and nothing else in the service calls it. One transient
    fault at capture meant no invoice, ever.
    """
    from apps.billing.subscriptions import invoices as inv

    school = make_school()
    plan = make_plan(billing_period="annual")
    payment = make_payment(plan=plan, school=school, purpose="subscription")

    calls = []
    real = inv.issue_for_payment

    def flaky(target, **kw):
        calls.append(target.id)
        if len(calls) == 1:
            raise RuntimeError("renderer fell over")
        return real(target, **kw)

    monkeypatch.setattr(inv, "issue_for_payment", flaky)

    first, _ = deliver(payment_body(payment, event="payment.captured"))
    assert first.status_code == 200
    payment.refresh_from_db()
    assert payment.status == Payment.Status.CAPTURED, "the capture must stand regardless"
    assert len(calls) == 1

    # The same event again, as a gateway would send it.
    second, _ = deliver(payment_body(payment, event="payment.captured"))

    assert second.status_code == 200
    assert len(calls) == 2, "the redelivery never reached the invoice seam"


def test_a_redelivery_for_an_already_invoiced_payment_changes_nothing(
    make_school, make_plan, make_payment
):
    """The other half: healing must not mean issuing a second invoice.

    `issue_for_payment` returns the existing row under a lock, so the retry
    above is safe to run on every redelivery for the life of the payment.
    """
    from apps.billing.subscriptions.models import Invoice

    school = make_school()
    plan = make_plan(billing_period="annual")
    payment = make_payment(plan=plan, school=school, purpose="subscription")

    deliver(payment_body(payment, event="payment.captured"))
    after_first = list(Invoice.objects.filter(payment=payment).values_list("id", flat=True))

    deliver(payment_body(payment, event="payment.captured"))
    after_second = list(Invoice.objects.filter(payment=payment).values_list("id", flat=True))

    assert after_first == after_second
