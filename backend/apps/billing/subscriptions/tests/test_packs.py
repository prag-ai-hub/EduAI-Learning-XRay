"""The X-Ray packs: capacity that expires, and a free tier that is granted.

The pricing table supplied on 2026-09-18 is not a subscription product. A school
buys "up to 50 students, 1 assessment" once; nothing renews. The owner's answers
that shape these tests:

  * a pack's capacity lasts 12 months and then lapses;
  * a credit is one student's answer sheet, so a pack's `credits_included` IS
    its coverage - 50 students x 1 assessment is 50;
  * X-Ray Free is granted when a school is approved, with no checkout.

The machinery underneath is still the subscription machinery, deliberately: a
pack is a 12-month period that does not renew, which is what
`cancel_at_period_end` already means.
"""

from __future__ import annotations

import uuid

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.roles import SCHOOL_ADMIN, SUPER_ADMIN
from apps.billing.subscriptions import services
from apps.billing.subscriptions.models import Payment, Plan, Subscription
from apps.tenants.schools.models import School

pytestmark = pytest.mark.django_db


@pytest.fixture
def pack(make_plan):
    """A school pack, as the catalogue defines one."""
    return make_plan(
        audience="school",
        billing_period="one_time",
        amount_paise=350_000,
        credits_included=50,
        code=f"xray_single_diy_{uuid.uuid4().hex[:6]}",
    )


@pytest.fixture
def free_plan(db):
    """The granted tier, under the code the service looks for."""
    now = timezone.now()
    plan, _ = Plan.objects.get_or_create(
        code=services.FREE_PLAN_CODE,
        defaults={
            "id": uuid.uuid4(),
            "name": "X-Ray Free",
            "description": "",
            "audience": Plan.Audience.SCHOOL,
            "billing_period": Plan.BillingPeriod.ONE_TIME,
            "amount_paise": 0,
            "currency": "INR",
            "credits_included": 30,
            "features": {},
            "sort_order": 10,
            "gateway": "razorpay",
            "status": Plan.Status.ACTIVE,
            "created_at": now,
            "updated_at": now,
        },
    )
    return plan


# --- what a pack is ---------------------------------------------------------


def test_a_pack_is_a_school_buying_one_time(pack, make_plan):
    assert services.is_pack(pack) is True
    # A parent's top-up is also one_time and is not a pack: it buys credits and
    # grants no period, so it never appears in a school's entitlement.
    assert services.is_pack(make_plan(audience="parent", billing_period="one_time")) is False
    assert services.is_pack(make_plan(audience="school", billing_period="annual")) is False


def test_a_packs_capacity_lasts_twelve_months(pack):
    start = timezone.now()

    end = services.period_end(pack, start)

    assert end is not None
    assert services.PACK_VALIDITY_MONTHS == 12
    assert end == services.add_months(start, 12)


def test_a_parent_topup_still_has_no_period(make_plan):
    assert (
        services.period_end(make_plan(audience="parent", billing_period="one_time"), timezone.now())
        is None
    )


# --- buying one ------------------------------------------------------------


def test_a_captured_pack_activates_a_subscription_that_never_renews(
    pack, make_school, make_payment
):
    school = make_school()
    payment = make_payment(plan=pack, school=school, status="captured")

    subscription = services.activate_subscription(payment)

    assert subscription.status == Subscription.Status.ACTIVE
    # The period end is an expiry date, and the row says it will not renew.
    assert subscription.cancel_at_period_end is True
    assert subscription.current_period_end is not None


def test_a_captured_pack_grants_its_coverage_as_credits(pack, make_school, make_user, make_payment):
    """Without this the number on the pricing page buys nothing: a school
    payment granted no credits at all before the packs existed."""
    school = make_school()
    admin = make_user(SCHOOL_ADMIN, school=school)
    payment = make_payment(plan=pack, school=school, status="captured")

    granted = services.grant_pack_credits(payment)

    assert granted == 50
    admin.refresh_from_db()
    assert admin.total_credits == 10 + 50  # the fixture starts them at 10


def test_granting_a_packs_credits_twice_does_not_double_the_capacity(
    pack, make_school, make_user, make_payment
):
    """A webhook redelivery is ordinary, not exceptional."""
    school = make_school()
    admin = make_user(SCHOOL_ADMIN, school=school)
    payment = make_payment(plan=pack, school=school, status="captured")

    first = services.grant_pack_credits(payment)
    second = services.grant_pack_credits(payment)

    assert (first, second) == (50, 0)
    admin.refresh_from_db()
    assert admin.total_credits == 60


def test_capacity_lands_on_the_schools_first_administrator(
    pack, make_school, make_user, make_payment
):
    """Credits are metered per user - `schools` has no balance column - so the
    pack lands on the account that registered the school, which is the one
    holding "Assign credits"."""
    school = make_school()
    first = make_user(SCHOOL_ADMIN, school=school)
    second = make_user(SCHOOL_ADMIN, school=school)
    User.objects.filter(pk=second.id).update(created_at=timezone.now())

    services.grant_pack_credits(make_payment(plan=pack, school=school, status="captured"))

    first.refresh_from_db()
    second.refresh_from_db()
    assert first.total_credits == 60
    assert second.total_credits == 10


# --- the free tier ----------------------------------------------------------


def test_approving_a_school_puts_it_on_the_free_tier(
    free_plan, make_school, make_user, api_client_for
):
    school = make_school(status=School.Status.PENDING)
    admin = make_user(SCHOOL_ADMIN, school=school)
    superadmin = make_user(SUPER_ADMIN)

    response = api_client_for(superadmin).post(f"/api/v1/schools/{school.id}/approve/")

    assert response.status_code == 200
    subscription = services.live_subscription(school.id)
    assert subscription is not None
    assert subscription.plan.code == services.FREE_PLAN_CODE
    assert subscription.cancel_at_period_end is True
    admin.refresh_from_db()
    assert admin.total_credits == 10 + 30


def test_a_school_with_a_paid_pack_is_not_moved_onto_free(
    free_plan, pack, make_school, make_user, make_subscription, api_client_for
):
    """Re-approving after a suspension must not replace something bought."""
    school = make_school(status=School.Status.SUSPENDED)
    make_user(SCHOOL_ADMIN, school=school)
    paid = make_subscription(school=school, plan=pack)
    superadmin = make_user(SUPER_ADMIN)

    api_client_for(superadmin).post(f"/api/v1/schools/{school.id}/reactivate/")

    live = services.live_subscription(school.id)
    assert live is not None
    assert live.id == paid.id
    assert live.plan_id == pack.id


def test_granting_the_free_tier_twice_grants_one_allowance(free_plan, make_school, make_user):
    school = make_school()
    admin = make_user(SCHOOL_ADMIN, school=school)

    first = services.grant_free_plan(school)
    second = services.grant_free_plan(school)

    assert first is not None
    assert second is None  # already on a live plan
    admin.refresh_from_db()
    assert admin.total_credits == 40


def test_the_free_tier_cannot_be_bought(free_plan, make_school, make_user, api_client_for):
    """An order for zero at the gateway is an error, not a free trial."""
    school = make_school()
    client = api_client_for(make_user(SCHOOL_ADMIN, school=school))

    response = client.post(
        "/api/v1/billing/checkout/subscription",
        {
            "plan_code": services.FREE_PLAN_CODE,
            "billing": {"billing_name": "A School", "place_of_supply": "27"},
        },
        format="json",
    )

    assert response.status_code == 400
    assert "granted, not sold" in str(response.json()).lower()
    assert not Payment.objects.filter(school_id=school.id).exists()
