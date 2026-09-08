"""Checkout: who may start one, what it charges, and why there is only ever one order."""

from __future__ import annotations

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.billing.subscriptions.models import Payment

from .conftest import BILLING_SETTINGS, billing

pytestmark = pytest.mark.django_db

B2B = "/api/v1/billing/checkout/subscription"
B2C = "/api/v1/billing/checkout/topup"


def body(plan, **over):
    return {"plan_code": plan.code, "billing": billing(), **over}


# --- who may start one (matrix §2, "Payments") ------------------------------


@override_settings(**BILLING_SETTINGS)
def test_a_school_admin_starts_a_b2b_checkout(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    fake_gateway(order_id="order_b2b")
    school = make_school()
    plan = make_plan(audience="school", amount_paise=100_000)

    response = api_client_for(make_user(SCHOOL_ADMIN, school=school)).post(
        B2B, body(plan), format="json"
    )

    assert response.status_code == 200, response.json()
    assert response.json()["order_id"] == "order_b2b"


@override_settings(**BILLING_SETTINGS)
def test_a_parent_starts_a_b2c_topup(make_user, api_client_for, make_plan, fake_gateway):
    fake_gateway(order_id="order_b2c")
    plan = make_plan(audience="parent", billing_period="one_time", amount_paise=19_900)

    response = api_client_for(make_user(PARENT)).post(B2C, body(plan), format="json")

    assert response.status_code == 200, response.json()
    assert response.json()["order_id"] == "order_b2c"


@pytest.mark.parametrize("role", [TEACHER, SUPER_ADMIN, PARENT])
@override_settings(**BILLING_SETTINGS)
def test_only_a_school_admin_may_spend_a_school_budget(
    make_school, make_user, api_client_for, make_plan, role
):
    # A Teacher is refused, and so is a SuperAdmin: administering a school does
    # not include buying for it, and authority does not flow downward.
    school = make_school()
    plan = make_plan(audience="school")
    user = make_user(role, school=school if role == TEACHER else None)
    assert api_client_for(user).post(B2B, body(plan), format="json").status_code == 403


@pytest.mark.parametrize("role", [TEACHER, SUPER_ADMIN, SCHOOL_ADMIN])
@override_settings(**BILLING_SETTINGS)
def test_only_a_parent_may_buy_parent_credits(
    make_school, make_user, api_client_for, make_plan, role
):
    school = make_school()
    plan = make_plan(audience="parent", billing_period="one_time")
    user = make_user(role, school=school if role in (TEACHER, SCHOOL_ADMIN) else None)
    assert api_client_for(user).post(B2C, body(plan), format="json").status_code == 403


def test_an_anonymous_caller_cannot_start_a_checkout(make_plan):
    plan = make_plan()
    assert APIClient().post(B2B, {"plan_code": plan.code}, format="json").status_code in (401, 403)


# --- the audience boundary ---------------------------------------------------


@override_settings(**BILLING_SETTINGS)
def test_a_parent_cannot_buy_a_school_plan(make_user, api_client_for, make_plan, fake_gateway):
    calls = fake_gateway()
    school_plan = make_plan(audience="school")

    response = api_client_for(make_user(PARENT)).post(B2C, body(school_plan), format="json")

    assert response.status_code == 400
    assert "plan_code" in str(response.json())
    assert calls == [], "a refused plan must not reach the gateway"


@override_settings(**BILLING_SETTINGS)
def test_a_school_cannot_buy_a_parent_plan(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    fake_gateway()
    parent_plan = make_plan(audience="parent", billing_period="one_time")
    admin = make_user(SCHOOL_ADMIN, school=make_school())
    assert api_client_for(admin).post(B2B, body(parent_plan), format="json").status_code == 400


@override_settings(**BILLING_SETTINGS)
def test_an_archived_plan_is_not_on_sale(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    # Archived plans are kept so old invoices resolve, never so they can be bought.
    fake_gateway()
    plan = make_plan(audience="school", status="archived")
    admin = make_user(SCHOOL_ADMIN, school=make_school())
    assert api_client_for(admin).post(B2B, body(plan), format="json").status_code == 400


# --- what it charges ---------------------------------------------------------


@override_settings(**BILLING_SETTINGS)
def test_the_total_is_the_plan_price_plus_tax_and_the_payment_records_all_three(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    fake_gateway()
    school = make_school()
    plan = make_plan(audience="school", amount_paise=299_900)

    data = (
        api_client_for(make_user(SCHOOL_ADMIN, school=school))
        .post(B2B, body(plan), format="json")
        .json()
    )

    # 18% of 299900 is 53982 exactly.
    assert (data["amount_paise"], data["tax_paise"], data["total_paise"]) == (
        299_900,
        53_982,
        353_882,
    )
    payment = Payment.objects.get(pk=data["payment_id"])
    # payments_total_adds_up would have rejected the row otherwise, but assert it
    # here too: the constraint is the backstop, not the specification.
    assert payment.total_paise == payment.amount_paise + payment.tax_paise
    assert payment.status == Payment.Status.CREATED


@override_settings(**BILLING_SETTINGS)
def test_the_caller_cannot_name_the_amount(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    # The price comes from the plan row. A caller that could name one would buy
    # a Premium subscription for a paisa.
    fake_gateway()
    plan = make_plan(audience="school", amount_paise=299_900)
    admin = make_user(SCHOOL_ADMIN, school=make_school())

    response = api_client_for(admin).post(B2B, body(plan, amount_paise=1), format="json")

    assert response.status_code == 400
    assert "amount_paise" in str(response.json())


@override_settings(**BILLING_SETTINGS)
def test_the_billing_snapshot_is_kept_for_the_invoice(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    fake_gateway()
    plan = make_plan(audience="school")
    admin = make_user(SCHOOL_ADMIN, school=make_school())

    data = api_client_for(admin).post(B2B, body(plan), format="json").json()

    notes = Payment.objects.get(pk=data["payment_id"]).notes
    assert notes["billing"]["gstin"] == "27AAACN0000A1Z5"
    assert notes["taxRateBps"] == 1800, "the rate charged must be recorded, not re-derived later"


@override_settings(**BILLING_SETTINGS)
def test_the_customers_address_is_not_handed_to_the_gateway(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    calls = fake_gateway()
    plan = make_plan(audience="school")
    admin = make_user(SCHOOL_ADMIN, school=make_school())

    api_client_for(admin).post(B2B, body(plan), format="json")

    sent = str(calls[0]["json"])
    assert "MG Road" not in sent and "27AAACN0000A1Z5" not in sent
    assert "paymentId" in sent, "the webhook still needs to correlate the order"


@override_settings(**BILLING_SETTINGS)
def test_a_gstin_must_agree_with_the_place_of_supply(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    # Caught now, not when the webhook tries to write the invoice after the
    # money has been taken.
    fake_gateway()
    plan = make_plan(audience="school")
    admin = make_user(SCHOOL_ADMIN, school=make_school())

    response = api_client_for(admin).post(
        B2B, body(plan, billing=billing(place_of_supply="29")), format="json"
    )
    assert response.status_code == 400
    assert "place_of_supply" in str(response.json())


# --- configuration refusals --------------------------------------------------


@override_settings(**{**BILLING_SETTINGS, "GST_RATE_BPS": None})
def test_an_unset_tax_rate_refuses_the_sale_rather_than_charging_zero(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    calls = fake_gateway()
    plan = make_plan(audience="school")
    admin = make_user(SCHOOL_ADMIN, school=make_school())

    response = api_client_for(admin).post(B2B, body(plan), format="json")

    assert response.status_code == 503
    assert Payment.objects.count() == 0
    assert calls == []


@override_settings(**BILLING_SETTINGS)
def test_a_gateway_failure_leaves_no_half_made_payment(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    fake_gateway(status=500, body={"error": {"code": "SERVER_ERROR"}})
    plan = make_plan(audience="school")
    admin = make_user(SCHOOL_ADMIN, school=make_school())

    response = api_client_for(admin).post(B2B, body(plan), format="json")

    assert response.status_code == 502
    # The row is created before the gateway call and must roll back with it,
    # or the payer's next attempt would find a phantom order to "reuse".
    assert Payment.objects.count() == 0


# --- idempotency (day 11.1) --------------------------------------------------


@override_settings(**BILLING_SETTINGS)
def test_a_double_clicked_pay_button_creates_one_order(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    calls = fake_gateway()
    plan = make_plan(audience="school")
    client = api_client_for(make_user(SCHOOL_ADMIN, school=make_school()))

    first = client.post(B2B, body(plan), format="json").json()
    second = client.post(B2B, body(plan), format="json").json()

    assert len(calls) == 1, "the gateway was asked for a second order"
    assert Payment.objects.count() == 1
    assert second["order_id"] == first["order_id"]
    assert second["payment_id"] == first["payment_id"]
    assert second["reused"] is True and first["reused"] is False


@override_settings(**BILLING_SETTINGS)
def test_a_client_supplied_idempotency_key_returns_the_first_answer(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    calls = fake_gateway()
    plan = make_plan(audience="school")
    client = api_client_for(make_user(SCHOOL_ADMIN, school=make_school()))
    sent = body(plan, idempotency_key="checkout-attempt-1")

    first = client.post(B2B, sent, format="json").json()
    second = client.post(B2B, sent, format="json").json()

    assert len(calls) == 1
    assert second["payment_id"] == first["payment_id"]


@override_settings(**BILLING_SETTINGS)
def test_two_different_payers_do_not_share_an_idempotency_key(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    # The key is namespaced by payer, so one tenant cannot squat on another's.
    calls = fake_gateway()
    plan = make_plan(audience="school")
    one = api_client_for(make_user(SCHOOL_ADMIN, school=make_school("One")))
    two = api_client_for(make_user(SCHOOL_ADMIN, school=make_school("Two")))
    sent = body(plan, idempotency_key="same-nonce")

    first = one.post(B2B, sent, format="json").json()
    second = two.post(B2B, sent, format="json").json()

    assert len(calls) == 2
    assert first["payment_id"] != second["payment_id"]


@override_settings(**BILLING_SETTINGS)
def test_a_stale_order_outside_the_reuse_window_is_not_reused(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    from apps.billing.subscriptions.services import CHECKOUT_REUSE_WINDOW

    calls = fake_gateway()
    plan = make_plan(audience="school")
    client = api_client_for(make_user(SCHOOL_ADMIN, school=make_school()))
    first = client.post(B2B, body(plan), format="json").json()

    # Age the first order past the window: a price could have changed by then,
    # so the payer gets a fresh order rather than yesterday's.
    stale = Payment.objects.get(pk=first["payment_id"])
    Payment.objects.filter(pk=stale.pk).update(
        created_at=stale.created_at - CHECKOUT_REUSE_WINDOW * 2
    )

    second = client.post(B2B, body(plan), format="json").json()

    assert len(calls) == 2
    assert second["payment_id"] != first["payment_id"]


# --- nothing is granted at order time ---------------------------------------


@override_settings(**BILLING_SETTINGS)
def test_starting_a_topup_grants_no_credits(make_user, api_client_for, make_plan, fake_gateway):
    # The obvious abuse of a top-up: an unpaid order that adds credits.
    fake_gateway()
    parent = make_user(PARENT)
    before = parent.total_credits
    plan = make_plan(audience="parent", billing_period="one_time", credits_included=60)

    api_client_for(parent).post(B2C, body(plan), format="json")

    parent.refresh_from_db()
    assert parent.total_credits == before
    assert not _ledger_rows(parent.id)


@override_settings(**BILLING_SETTINGS)
def test_starting_a_subscription_checkout_grants_no_entitlement(
    make_school, make_user, api_client_for, make_plan, fake_gateway
):
    from apps.billing.subscriptions import entitlements
    from apps.billing.subscriptions.models import Subscription

    fake_gateway()
    school = make_school()
    plan = make_plan(audience="school")

    api_client_for(make_user(SCHOOL_ADMIN, school=school)).post(B2B, body(plan), format="json")

    assert not Subscription.objects.filter(school=school).exists()
    assert entitlements.for_school(school.id).has_entitlement is False


def _ledger_rows(user_id):
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute(
            "select amount, transaction_type from public.credit_transactions where user_id = %s",
            [str(user_id)],
        )
        return cursor.fetchall()
