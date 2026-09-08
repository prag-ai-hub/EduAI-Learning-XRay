"""The plan-change rule, exercised at the moment a payment captures.

The rule is stated in full in services.py's module docstring. Three behaviours
follow from it and each has a test here: a different plan starts a fresh period
and forfeits the remainder, the same plan appends to what is already paid for,
and neither ever produces a second live subscription.
"""

from __future__ import annotations

import pytest
from django.utils import timezone

from apps.billing.subscriptions import services
from apps.billing.subscriptions.models import Payment, Subscription
from apps.platform.audit.models import AuditEvent

pytestmark = pytest.mark.django_db


def capture(payment):
    """Mark a payment captured, as only a verified webhook may."""
    payment.status = Payment.Status.CAPTURED
    payment.captured_at = timezone.now()
    payment.gateway_payment_id = f"pay_{payment.id.hex[:14]}"
    payment.save(update_fields=["status", "captured_at", "gateway_payment_id"])
    return payment


# --- a first subscription ----------------------------------------------------


def test_a_captured_payment_starts_a_period_of_the_plans_length(
    make_school, make_plan, make_payment
):
    school = make_school()
    plan = make_plan(audience="school", billing_period="annual")
    payment = capture(make_payment(plan=plan, school=school, purpose="subscription"))

    subscription = services.activate_subscription(payment)

    assert subscription.status == Subscription.Status.ACTIVE
    assert subscription.plan_id == plan.id
    # A whole year from capture, calendar-correct rather than 365 days.
    assert subscription.current_period_end == services.add_months(
        subscription.current_period_start, 12
    )


def test_activation_is_audited_and_updates_the_denormalised_column(
    make_school, make_plan, make_payment
):
    school = make_school()
    plan = make_plan(audience="school")
    payment = capture(make_payment(plan=plan, school=school, purpose="subscription"))

    subscription = services.activate_subscription(payment)

    school.refresh_from_db()
    assert school.plan_id == plan.id  # listings only - never read for entitlement
    event = AuditEvent.objects.get(
        action=services.BillingAction.SUBSCRIPTION_ACTIVATED, school_id=school.id
    )
    assert event.entity_id == str(subscription.id)
    assert event.actor_id is None, "a gateway confirmation has no human actor"


# --- nothing happens before capture -----------------------------------------


@pytest.mark.parametrize("status", ["created", "authorized", "failed"])
def test_an_uncaptured_payment_grants_nothing(make_school, make_plan, make_payment, status):
    # `authorized` is included deliberately: an authorised payment is money
    # reserved, not money taken, and treating it as capture is the mistake the
    # data model's "gateway is the source of truth" rule exists to prevent.
    school = make_school()
    payment = make_payment(plan=make_plan(audience="school"), school=school, status=status)

    with pytest.raises(services.PaymentNotSettled):
        services.activate_subscription(payment)

    assert not Subscription.objects.filter(school=school).exists()


# --- upgrade -----------------------------------------------------------------


def test_an_upgrade_replaces_the_plan_and_restarts_the_period(
    make_school, make_plan, make_payment, make_subscription
):
    school = make_school()
    starter = make_plan(audience="school", billing_period="annual", amount_paise=100_000)
    premium = make_plan(audience="school", billing_period="annual", amount_paise=500_000)
    existing = make_subscription(school=school, plan=starter, days_left=200)

    payment = capture(make_payment(plan=premium, school=school, purpose="subscription"))
    subscription = services.activate_subscription(payment)

    assert subscription.id == existing.id, "an upgrade supersedes; it does not duplicate"
    assert subscription.plan_id == premium.id
    # Starts now: the 200 days left on Starter are forfeit, which is what
    # `describe_plan_change` warned about before the payment was taken.
    assert (timezone.now() - subscription.current_period_start).total_seconds() < 60


def test_only_one_live_subscription_survives_an_upgrade(
    make_school, make_plan, make_payment, make_subscription
):
    # `subscriptions_one_live_per_school_idx` enforces this in the database;
    # assert it here so a change that starts creating a second row fails loudly
    # rather than as an opaque integrity error inside a webhook.
    school = make_school()
    starter = make_plan(audience="school", amount_paise=100_000)
    premium = make_plan(audience="school", amount_paise=500_000)
    make_subscription(school=school, plan=starter)

    services.activate_subscription(
        capture(make_payment(plan=premium, school=school, purpose="subscription"))
    )

    live = Subscription.objects.filter(school=school, status__in=services.LIVE_STATUSES)
    assert live.count() == 1


def test_an_upgrade_is_audited_as_a_plan_change_naming_both_plans(
    make_school, make_plan, make_payment, make_subscription
):
    school = make_school()
    starter = make_plan(audience="school", amount_paise=100_000, name="Starter")
    premium = make_plan(audience="school", amount_paise=500_000, name="Premium")
    make_subscription(school=school, plan=starter)

    services.activate_subscription(
        capture(make_payment(plan=premium, school=school, purpose="subscription"))
    )

    event = AuditEvent.objects.get(
        action=services.BillingAction.SUBSCRIPTION_PLAN_CHANGED, school_id=school.id
    )
    assert event.detail_json["previousPlanCode"] == starter.code
    assert event.detail_json["planCode"] == premium.code


# --- downgrade ---------------------------------------------------------------


def test_a_downgrade_is_treated_exactly_like_an_upgrade(
    make_school, make_plan, make_payment, make_subscription
):
    # One rule for every plan change. There is no "pending plan" column to
    # schedule a downgrade into, and inventing one to defer it would be a
    # commercial decision dressed as a schema change.
    school = make_school()
    premium = make_plan(audience="school", amount_paise=500_000)
    starter = make_plan(audience="school", amount_paise=100_000)
    make_subscription(school=school, plan=premium, days_left=300)

    subscription = services.activate_subscription(
        capture(make_payment(plan=starter, school=school, purpose="subscription"))
    )

    assert subscription.plan_id == starter.id
    assert (timezone.now() - subscription.current_period_start).total_seconds() < 60


def test_a_downgrade_is_described_as_one_before_anyone_pays(
    make_school, make_plan, make_subscription
):
    school = make_school()
    premium = make_plan(audience="school", billing_period="annual", amount_paise=1_200_000)
    # A cheaper plan per month, even though its sticker price is larger: the
    # comparison has to be per-month or a monthly plan would always look smaller
    # than an annual one.
    monthly = make_plan(audience="school", billing_period="monthly", amount_paise=50_000)
    existing = make_subscription(school=school, plan=premium, days_left=100)

    change = services.describe_plan_change(existing, monthly)

    assert change["kind"] == "downgrade"
    assert change["forfeits_days"] == 99  # whole days remaining
    assert "not refunded" in change["message"]


# --- the same plan again -----------------------------------------------------


def test_renewing_the_same_plan_extends_rather_than_restarts(
    make_school, make_plan, make_payment, make_subscription
):
    # The one asymmetry in the rule, and the reason for it: paying early must
    # never destroy days already bought.
    school = make_school()
    plan = make_plan(audience="school", billing_period="annual")
    existing = make_subscription(school=school, plan=plan, days_left=200)
    old_end = existing.current_period_end

    subscription = services.activate_subscription(
        capture(make_payment(plan=plan, school=school, purpose="subscription_renewal"))
    )

    assert subscription.current_period_start == old_end
    assert subscription.current_period_end == services.add_months(old_end, 12)


def test_a_renewal_is_described_as_keeping_the_days_already_paid_for(
    make_school, make_plan, make_subscription
):
    school = make_school()
    plan = make_plan(audience="school")
    existing = make_subscription(school=school, plan=plan, days_left=45)

    change = services.describe_plan_change(existing, plan)

    assert change["kind"] == "renewal"
    assert change["forfeits_days"] == 0


def test_renewing_an_expired_period_starts_from_now_not_from_the_past(
    make_school, make_plan, make_payment, make_subscription
):
    # Extending from a period end that has already passed would sell a period
    # that is partly historical.
    school = make_school()
    plan = make_plan(audience="school", billing_period="monthly")
    make_subscription(school=school, plan=plan, status="past_due", days_left=-5)

    subscription = services.activate_subscription(
        capture(make_payment(plan=plan, school=school, purpose="subscription_renewal"))
    )

    assert subscription.current_period_end > timezone.now()
    assert (timezone.now() - subscription.current_period_start).total_seconds() < 60


def test_payment_clears_the_grace_window_and_a_pending_cancellation(
    make_school, make_plan, make_payment, make_subscription
):
    school = make_school()
    plan = make_plan(audience="school")
    existing = make_subscription(school=school, plan=plan, status="past_due", days_left=3)
    Subscription.objects.filter(pk=existing.pk).update(
        grace_until=timezone.now(), cancel_at_period_end=True
    )

    subscription = services.activate_subscription(
        capture(make_payment(plan=plan, school=school, purpose="subscription_renewal"))
    )

    assert subscription.status == Subscription.Status.ACTIVE
    assert subscription.grace_until is None
    assert subscription.cancel_at_period_end is False


# --- redelivery --------------------------------------------------------------


def test_applying_the_same_capture_twice_does_not_extend_the_period_twice(
    make_school, make_plan, make_payment
):
    # A gateway redelivers. This is the guard that makes that harmless.
    school = make_school()
    plan = make_plan(audience="school", billing_period="annual")
    payment = capture(make_payment(plan=plan, school=school, purpose="subscription"))

    first = services.activate_subscription(payment)
    second = services.activate_subscription(payment)

    assert first.id == second.id
    second.refresh_from_db()
    assert second.current_period_end == first.current_period_end


# --- period arithmetic -------------------------------------------------------


def test_a_month_added_to_the_31st_lands_on_the_end_of_a_short_month():
    from datetime import datetime
    from datetime import timezone as tz

    # Not 3 March. A period that slides forward drifts off its anniversary.
    assert services.add_months(datetime(2026, 1, 31, tzinfo=tz.utc), 1) == datetime(
        2026, 2, 28, tzinfo=tz.utc
    )
    assert services.add_months(datetime(2026, 12, 15, tzinfo=tz.utc), 1) == datetime(
        2027, 1, 15, tzinfo=tz.utc
    )


def test_a_one_time_plan_has_no_period(make_plan):
    plan = make_plan(audience="parent", billing_period="one_time")
    assert services.period_end(plan, timezone.now()) is None
