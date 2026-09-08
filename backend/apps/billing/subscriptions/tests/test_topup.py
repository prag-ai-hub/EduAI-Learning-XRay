"""B2C credits: they land on capture, once, and never before.

The abuse this file exists to rule out is the obvious one - an unpaid order that
grants credits - and its twin, a redelivered webhook that grants them twice.
"""

from __future__ import annotations

import pytest
from django.db import connection
from django.utils import timezone

from apps.accounts.roles import PARENT
from apps.billing.subscriptions import services
from apps.billing.subscriptions.models import Payment
from apps.platform.audit.models import AuditEvent

pytestmark = pytest.mark.django_db


def capture(payment):
    payment.status = Payment.Status.CAPTURED
    payment.captured_at = timezone.now()
    payment.gateway_payment_id = f"pay_{payment.id.hex[:14]}"
    payment.save(update_fields=["status", "captured_at", "gateway_payment_id"])
    return payment


def ledger(user_id) -> list[tuple]:
    with connection.cursor() as cursor:
        cursor.execute(
            "select amount, transaction_type, payment_id, operation_key "
            "from public.credit_transactions where user_id = %s order by created_at",
            [str(user_id)],
        )
        return cursor.fetchall()


# --- the ordering invariant --------------------------------------------------


@pytest.mark.parametrize("status", ["created", "authorized", "failed", "refunded"])
def test_credits_never_land_for_a_payment_that_has_not_captured(
    make_user, make_plan, make_payment, status
):
    parent = make_user(PARENT)
    before = parent.total_credits
    plan = make_plan(audience="parent", billing_period="one_time", credits_included=60)
    payment = make_payment(plan=plan, parent_user=parent, status=status)

    with pytest.raises(services.PaymentNotSettled):
        services.grant_topup_credits(payment)

    parent.refresh_from_db()
    assert parent.total_credits == before
    assert ledger(parent.id) == []


def test_a_captured_topup_adds_the_plans_credits(make_user, make_plan, make_payment):
    parent = make_user(PARENT)
    before = parent.total_credits
    plan = make_plan(audience="parent", billing_period="one_time", credits_included=60)
    payment = capture(make_payment(plan=plan, parent_user=parent))

    granted = services.grant_topup_credits(payment)

    parent.refresh_from_db()
    assert granted == 60
    assert parent.total_credits == before + 60
    # ...and the balance never moves without a ledger row to explain it.
    (row,) = ledger(parent.id)
    assert row[0] == 60
    assert row[1] == "purchase"
    assert str(row[2]) == str(payment.id)


def test_a_redelivered_webhook_grants_the_credits_only_once(make_user, make_plan, make_payment):
    parent = make_user(PARENT)
    before = parent.total_credits
    plan = make_plan(audience="parent", billing_period="one_time", credits_included=20)
    payment = capture(make_payment(plan=plan, parent_user=parent))

    first = services.grant_topup_credits(payment)
    second = services.grant_topup_credits(payment)

    parent.refresh_from_db()
    assert (first, second) == (20, 0)
    assert parent.total_credits == before + 20
    assert len(ledger(parent.id)) == 1


def test_a_second_purchase_is_a_second_grant(make_user, make_plan, make_payment):
    # The idempotency guard keys on the payment, not on the payer or the plan:
    # buying the same top-up twice is a normal thing to do.
    parent = make_user(PARENT)
    before = parent.total_credits
    plan = make_plan(audience="parent", billing_period="one_time", credits_included=20)

    services.grant_topup_credits(capture(make_payment(plan=plan, parent_user=parent)))
    services.grant_topup_credits(capture(make_payment(plan=plan, parent_user=parent)))

    parent.refresh_from_db()
    assert parent.total_credits == before + 40
    assert len(ledger(parent.id)) == 2


def test_the_grant_is_audited(make_user, make_plan, make_payment):
    parent = make_user(PARENT)
    plan = make_plan(audience="parent", billing_period="one_time", credits_included=20)
    payment = capture(make_payment(plan=plan, parent_user=parent))

    services.grant_topup_credits(payment)

    event = AuditEvent.objects.get(action=services.BillingAction.CREDITS_TOPPED_UP)
    # A parent has no school, and `audit_events.school_id` is NOT NULL.
    assert event.school_id == services.PLATFORM_SCOPE
    assert event.detail_json["credits"] == 20
    assert event.entity_id == str(payment.id)


# --- the two grant paths do not cross ---------------------------------------


def test_a_subscription_payment_does_not_grant_parent_credits(make_school, make_plan, make_payment):
    school = make_school()
    plan = make_plan(audience="school", credits_included=6_000)
    payment = capture(make_payment(plan=plan, school=school, purpose="subscription"))

    with pytest.raises(services.PaymentNotSettled):
        services.grant_topup_credits(payment)


def test_a_topup_does_not_create_a_subscription(make_user, make_plan, make_payment):
    from apps.billing.subscriptions.models import Subscription

    parent = make_user(PARENT)
    plan = make_plan(audience="parent", billing_period="one_time")
    payment = capture(make_payment(plan=plan, parent_user=parent))

    with pytest.raises(services.PaymentNotSettled):
        services.activate_subscription(payment)

    assert Subscription.objects.count() == 0
