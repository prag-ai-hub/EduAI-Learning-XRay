"""The catalogue, the payment history, and the subscription view.

Read surfaces, and the scoping on them is the whole test. A payment history that
answers the wrong tenant is a data breach dressed as a feature.
"""

from __future__ import annotations

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.billing.subscriptions.models import Subscription

from .conftest import BILLING_SETTINGS

pytestmark = pytest.mark.django_db

PLANS = "/api/v1/billing/plans/"
PAYMENTS = "/api/v1/billing/payments/"
SUBSCRIPTION = "/api/v1/billing/subscription"
CANCEL = "/api/v1/billing/subscription/cancel"


def codes(response) -> set[str]:
    return {row["code"] for row in response.json()["results"]}


# --- the catalogue -----------------------------------------------------------


def test_a_school_admin_sees_only_school_plans(make_school, make_user, api_client_for, make_plan):
    school_plan = make_plan(audience="school")
    parent_plan = make_plan(audience="parent", billing_period="one_time")

    response = api_client_for(make_user(SCHOOL_ADMIN, school=make_school())).get(PLANS)

    assert response.status_code == 200
    assert school_plan.code in codes(response)
    assert parent_plan.code not in codes(response)


def test_a_parent_sees_only_parent_plans(make_user, api_client_for, make_plan):
    school_plan = make_plan(audience="school")
    parent_plan = make_plan(audience="parent", billing_period="one_time")

    response = api_client_for(make_user(PARENT)).get(PLANS)

    assert parent_plan.code in codes(response)
    assert school_plan.code not in codes(response)


def test_an_archived_plan_is_off_the_pricing_page(
    make_school, make_user, api_client_for, make_plan
):
    archived = make_plan(audience="school", status="archived")
    response = api_client_for(make_user(SCHOOL_ADMIN, school=make_school())).get(PLANS)
    assert archived.code not in codes(response)


def test_a_teacher_has_no_business_at_a_checkout(make_school, make_user, api_client_for):
    # Teacher holds no payment capability at all in the matrix.
    assert api_client_for(make_user(TEACHER, school=make_school())).get(PLANS).status_code == 403


def test_the_gateway_plan_id_is_not_published(make_school, make_user, api_client_for, make_plan):
    make_plan(audience="school")
    response = api_client_for(make_user(SCHOOL_ADMIN, school=make_school())).get(PLANS)
    assert "gateway_plan_id" not in response.json()["results"][0]


# --- payment history ---------------------------------------------------------


def test_a_school_admin_sees_only_their_own_schools_payments(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    mine, theirs = make_school("Mine"), make_school("Theirs")
    plan = make_plan(audience="school")
    make_payment(plan=plan, school=mine)
    other = make_payment(plan=plan, school=theirs)

    response = api_client_for(make_user(SCHOOL_ADMIN, school=mine)).get(PAYMENTS)

    ids = {row["id"] for row in response.json()["results"]}
    assert str(other.id) not in ids
    assert len(ids) == 1


def test_a_parent_sees_only_their_own_payments(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    # A parent has no school, so the tenant filter alone would show them nothing
    # and, if it were relaxed, would show them everything. Their reach is the
    # payer column on the row itself.
    parent, other_parent = make_user(PARENT), make_user(PARENT)
    plan = make_plan(audience="parent", billing_period="one_time")
    mine = make_payment(plan=plan, parent_user=parent)
    make_payment(plan=plan, parent_user=other_parent)
    make_payment(plan=make_plan(audience="school"), school=make_school())

    response = api_client_for(parent).get(PAYMENTS)

    assert [row["id"] for row in response.json()["results"]] == [str(mine.id)]


def test_a_teacher_cannot_read_payment_history(make_school, make_user, api_client_for):
    assert api_client_for(make_user(TEACHER, school=make_school())).get(PAYMENTS).status_code == 403


def test_a_super_admin_sees_across_tenants(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    plan = make_plan(audience="school")
    make_payment(plan=plan, school=make_school("One"))
    make_payment(plan=plan, school=make_school("Two"))

    response = api_client_for(make_user(SUPER_ADMIN)).get(PAYMENTS)

    assert response.json()["count"] >= 2


def test_the_history_never_returns_the_billing_snapshot(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    # `notes` carries a name, an address and a GSTIN. That is the invoice's
    # business, and this endpoint is read cross-tenant by a SuperAdmin.
    school = make_school()
    payment = make_payment(plan=make_plan(audience="school"), school=school)
    payment.notes = {"billing": {"billing_name": "Nehru Vidyalaya", "gstin": "27AAACN0000A1Z5"}}
    payment.save(update_fields=["notes"])

    body = api_client_for(make_user(SCHOOL_ADMIN, school=school)).get(PAYMENTS).content.decode()

    assert "27AAACN0000A1Z5" not in body
    assert "idempotency_key" not in body


def test_payment_history_is_read_only(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    school = make_school()
    payment = make_payment(plan=make_plan(audience="school"), school=school)
    client = api_client_for(make_user(SCHOOL_ADMIN, school=school))

    # A payment's status is the gateway's to decide, not a PATCH's.
    assert client.patch(f"{PAYMENTS}{payment.id}/", {"status": "captured"}).status_code == 405
    assert client.delete(f"{PAYMENTS}{payment.id}/").status_code == 405


def test_an_anonymous_caller_reads_nothing():
    assert APIClient().get(PAYMENTS).status_code in (401, 403)
    assert APIClient().get(PLANS).status_code in (401, 403)


# --- the subscription view ---------------------------------------------------


def test_a_school_admin_sees_their_subscription_and_entitlement(
    make_school, make_user, api_client_for, make_plan, make_subscription
):
    school = make_school()
    plan = make_plan(audience="school", features={"exports": True})
    make_subscription(school=school, plan=plan)

    body = api_client_for(make_user(SCHOOL_ADMIN, school=school)).get(SUBSCRIPTION).json()

    assert body["subscription"]["plan"]["code"] == plan.code
    # Both, because they answer different questions: the contract, and whether
    # it currently permits anything.
    assert body["entitlement"]["has_entitlement"] is True


def test_a_school_with_no_subscription_says_so_rather_than_404ing(
    make_school, make_user, api_client_for
):
    body = api_client_for(make_user(SCHOOL_ADMIN, school=make_school())).get(SUBSCRIPTION).json()
    assert body["subscription"] is None
    assert body["entitlement"]["status"] == "none"


def test_a_school_admin_cannot_look_at_another_school(make_school, make_user, api_client_for):
    mine, theirs = make_school("Mine"), make_school("Theirs")
    response = api_client_for(make_user(SCHOOL_ADMIN, school=mine)).get(
        f"{SUBSCRIPTION}?school={theirs.id}"
    )
    assert response.status_code == 403


def test_a_super_admin_needs_a_support_grant_to_look(
    make_school, make_user, api_client_for, make_grant
):
    school = make_school()
    admin = make_user(SUPER_ADMIN)
    url = f"{SUBSCRIPTION}?school={school.id}"

    # No grant: refused, exactly as matrix §4 requires. SuperAdmin is not an
    # implicit key to every tenant.
    assert api_client_for(admin).get(url).status_code == 403

    make_grant(granted_to=admin, school=school)
    assert api_client_for(admin).get(url).status_code == 200


def test_a_teacher_cannot_read_the_subscription(make_school, make_user, api_client_for):
    assert (
        api_client_for(make_user(TEACHER, school=make_school())).get(SUBSCRIPTION).status_code
        == 403
    )


# --- cancellation ------------------------------------------------------------


@override_settings(**BILLING_SETTINGS)
def test_cancelling_stops_the_renewal_without_ending_the_paid_period(
    make_school, make_user, api_client_for, make_plan, make_subscription
):
    school = make_school()
    subscription = make_subscription(school=school, plan=make_plan(audience="school"))

    response = api_client_for(make_user(SCHOOL_ADMIN, school=school)).post(CANCEL)

    assert response.status_code == 200
    subscription.refresh_from_db()
    assert subscription.cancel_at_period_end is True
    # Still active, and still entitling: they paid for this period.
    assert subscription.status == Subscription.Status.ACTIVE


@override_settings(**BILLING_SETTINGS)
def test_cancelling_twice_is_not_an_error(
    make_school, make_user, api_client_for, make_plan, make_subscription
):
    school = make_school()
    make_subscription(school=school, plan=make_plan(audience="school"))
    client = api_client_for(make_user(SCHOOL_ADMIN, school=school))

    assert client.post(CANCEL).status_code == 200
    assert client.post(CANCEL).status_code == 200


def test_cancelling_nothing_is_a_400_not_a_500(make_school, make_user, api_client_for):
    response = api_client_for(make_user(SCHOOL_ADMIN, school=make_school())).post(CANCEL)
    assert response.status_code == 400


@pytest.mark.parametrize("role", [TEACHER, PARENT])
def test_no_other_role_may_cancel_a_subscription(make_school, make_user, api_client_for, role):
    user = make_user(role, school=make_school() if role == TEACHER else None)
    assert api_client_for(user).post(CANCEL).status_code == 403
