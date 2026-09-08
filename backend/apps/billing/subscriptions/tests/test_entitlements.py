"""Entitlement resolution, and the 402 that is not a 403."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.test import override_settings
from django.utils import timezone

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, TEACHER
from apps.billing.subscriptions import entitlements
from apps.billing.subscriptions.models import Subscription

pytestmark = pytest.mark.django_db


def principal_for(user):
    """The principal shape the authentication layer builds, without a request."""
    from apps.accounts.authentication import SupabasePrincipal

    return SupabasePrincipal(
        id=str(user.id),
        email=user.email,
        role=user.role,
        school_id=user.school_id,
        status=user.status,
    )


# --- resolution --------------------------------------------------------------


def test_a_school_with_no_subscription_is_not_entitled(make_school):
    result = entitlements.for_school(make_school().id)
    assert result.has_entitlement is False
    assert result.status == "none"


def test_an_active_subscription_carries_the_plans_features(
    make_school, make_plan, make_subscription
):
    school = make_school()
    plan = make_plan(audience="school", features={"exports": True}, credits_included=6_000)
    make_subscription(school=school, plan=plan)

    result = entitlements.for_school(school.id)

    assert result.has_entitlement is True
    assert result.plan_code == plan.code
    assert result.credits_included == 6_000
    assert result.has_feature("exports") is True
    # Absent means off: shipping a feature must not widen every old plan.
    assert result.has_feature("advanced_reports") is False


def test_past_due_entitles_only_inside_its_grace_window(make_school, make_plan, make_subscription):
    # The subtle half of the rule, and exactly why this resolves through the SQL
    # function rather than being written a second time in Python.
    school = make_school()
    plan = make_plan(audience="school")
    subscription = make_subscription(school=school, plan=plan, status="past_due", days_left=-1)

    Subscription.objects.filter(pk=subscription.pk).update(
        grace_until=timezone.now() + timedelta(days=3)
    )
    assert entitlements.for_school(school.id).has_entitlement is True

    Subscription.objects.filter(pk=subscription.pk).update(
        grace_until=timezone.now() - timedelta(minutes=1)
    )
    assert entitlements.for_school(school.id).has_entitlement is False


def test_a_cancelled_subscription_stops_entitling(make_school, make_plan, make_subscription):
    school = make_school()
    subscription = make_subscription(school=school, plan=make_plan(audience="school"))
    Subscription.objects.filter(pk=subscription.pk).update(status=Subscription.Status.CANCELLED)

    assert entitlements.for_school(school.id).has_entitlement is False


def test_the_denormalised_school_plan_column_is_never_the_answer(make_school, make_plan):
    # M9's column comment says so, and this proves the code agrees: a school
    # carrying plan_id with no subscription is not entitled to anything.
    from apps.tenants.schools.models import School

    school = make_school()
    plan = make_plan(audience="school")
    School.objects.filter(pk=school.pk).update(plan_id=plan.id)

    assert entitlements.for_school(school.id).has_entitlement is False


# --- the gate ----------------------------------------------------------------


@override_settings(FRONTEND_URL="https://app.eduaihub.test")
def test_an_unsubscribed_school_gets_402_with_somewhere_to_go(make_school, make_user):
    teacher = make_user(TEACHER, school=make_school())

    with pytest.raises(entitlements.PaymentRequired) as caught:
        entitlements.require_entitlement(principal_for(teacher))

    # 402, not 403: "you may, once this is paid" is a different instruction from
    # "you may not", and a client cannot tell them apart from the message alone.
    assert caught.value.status_code == 402
    assert caught.value.detail["checkout_url"] == "https://app.eduaihub.test/billing"


def test_a_covered_school_passes_the_gate(make_school, make_user, make_plan, make_subscription):
    school = make_school()
    make_subscription(school=school, plan=make_plan(audience="school", features={"exports": True}))
    teacher = make_user(TEACHER, school=school)

    result = entitlements.require_entitlement(principal_for(teacher), feature="exports")

    assert result.has_entitlement is True


def test_a_feature_the_plan_lacks_is_402_not_403(
    make_school, make_user, make_plan, make_subscription
):
    school = make_school()
    make_subscription(school=school, plan=make_plan(audience="school", features={"exports": False}))
    admin = make_user(SCHOOL_ADMIN, school=school)

    with pytest.raises(entitlements.PaymentRequired) as caught:
        entitlements.require_entitlement(principal_for(admin), feature="exports")

    assert caught.value.detail["feature"] == "exports"


def test_a_parent_is_not_asked_about_a_subscription(make_user):
    # Parents hold credits, not entitlement. Sending one through this gate is a
    # programming error, and saying so beats resolving an empty school id.
    parent = make_user(PARENT)
    with pytest.raises(ValueError):
        entitlements.require_entitlement(principal_for(parent))


# --- the credit meter --------------------------------------------------------


def test_credits_remaining_is_total_less_used(make_user):
    from apps.accounts.models import User

    parent = make_user(PARENT)
    User.objects.filter(pk=parent.pk).update(total_credits=50, used_credits=12)
    assert entitlements.credits_remaining(parent.id) == 38


def test_an_overspent_balance_never_reports_negative(make_user):
    from apps.accounts.models import User

    parent = make_user(PARENT)
    User.objects.filter(pk=parent.pk).update(total_credits=5, used_credits=9)
    assert entitlements.credits_remaining(parent.id) == 0
