"""Seeding the catalogue, and the edit it refuses to make.

`seed_plans` matches on `code`, so re-running it after an edit rewrites the row
a live subscription points at. Three things read that row rather than a snapshot
of it - a renewal's price, the credits granted at capture, and the line
description printed on an invoice - so re-pricing in place changes what someone
already pays, what they receive, and what a document issued last quarter says.

These tests are the rule: an unsold plan is freely editable, a held one is
frozen in its commercial terms, and the way to change a price is a new code
beside an archived old one.
"""

from __future__ import annotations

from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.billing.subscriptions.management.commands import seed_plans as seeder
from apps.billing.subscriptions.models import Plan

pytestmark = pytest.mark.django_db


def run(catalogue, **options):
    """Run the command against a catalogue of our own, not the shipped one.

    `pricing_confirmed` defaults to True here because the test settings are not
    DEBUG, so every run would otherwise stop at the placeholder guard - which is
    the guard working. The two tests at the bottom drop this to exercise it.
    """
    options.setdefault("pricing_confirmed", True)
    out = StringIO()
    original = seeder.CATALOGUE
    seeder.CATALOGUE = catalogue
    try:
        call_command("seed_plans", stdout=out, stderr=out, **options)
    finally:
        seeder.CATALOGUE = original
    return out.getvalue()


def entry(**overrides):
    base = {
        "code": "test_plan_monthly",
        "name": "Test plan",
        "description": "A plan used by the seeding tests.",
        "audience": Plan.Audience.SCHOOL,
        "billing_period": Plan.BillingPeriod.MONTHLY,
        "amount_paise": 100_000,
        "credits_included": 100,
        "max_teachers": 10,
        "max_students": 300,
        "features": {"exports": False},
        "sort_order": 900,
    }
    return {**base, **overrides}


# --- creating and re-running -------------------------------------------------


def test_seeding_creates_the_catalogue():
    run([entry()])

    plan = Plan.objects.get(code="test_plan_monthly")
    assert plan.amount_paise == 100_000
    assert plan.currency == "INR"
    assert plan.status == Plan.Status.ACTIVE


def test_re_running_an_unchanged_catalogue_changes_nothing():
    run([entry()])
    before = Plan.objects.get(code="test_plan_monthly").updated_at

    output = run([entry()])

    assert "unchanged" in output
    assert Plan.objects.get(code="test_plan_monthly").updated_at == before


def test_a_dry_run_reports_without_writing():
    output = run([entry()], dry_run=True)

    assert "test_plan_monthly" in output
    assert not Plan.objects.filter(code="test_plan_monthly").exists()


# --- a plan nobody holds is still a draft ------------------------------------


def test_an_unsold_plan_can_be_re_priced():
    """Before anyone buys it, the catalogue is just a file the owner edits."""
    run([entry()])

    run([entry(amount_paise=250_000, credits_included=250)])

    plan = Plan.objects.get(code="test_plan_monthly")
    assert (plan.amount_paise, plan.credits_included) == (250_000, 250)


# --- a plan somebody holds is frozen -----------------------------------------


@pytest.mark.parametrize(
    "change",
    [
        {"amount_paise": 250_000},
        {"credits_included": 250},
        {"name": "Renamed plan"},
        {"max_students": 9_000},
        {"features": {"exports": True}},
        {"billing_period": Plan.BillingPeriod.ANNUAL},
    ],
)
def test_a_subscribed_plan_cannot_be_re_priced_in_place(change, make_school, make_subscription):
    run([entry()])
    plan = Plan.objects.get(code="test_plan_monthly")
    make_subscription(school=make_school(), plan=plan)

    with pytest.raises(CommandError) as refused:
        run([entry(**change)])

    assert "cannot be re-priced in place" in str(refused.value)
    assert "docs/PRICING.md" in str(refused.value)
    # The row is untouched: a refusal that had already written half the fields
    # would be worse than the edit it refused.
    plan.refresh_from_db()
    for field, value in change.items():
        assert getattr(plan, field) != value


def test_a_plan_with_only_a_payment_against_it_is_also_frozen(make_school, make_payment):
    """A payment that never captured still quoted this price to somebody, and an
    invoice issued against it prints this plan's name."""
    run([entry()])
    plan = Plan.objects.get(code="test_plan_monthly")
    make_payment(plan=plan, school=make_school(), status="created")

    with pytest.raises(CommandError) as refused:
        run([entry(amount_paise=250_000)])

    assert "1 payment" in str(refused.value)


def test_the_refusal_names_every_frozen_field_that_would_change(make_school, make_subscription):
    run([entry()])
    make_subscription(school=make_school(), plan=Plan.objects.get(code="test_plan_monthly"))

    with pytest.raises(CommandError) as refused:
        run([entry(amount_paise=250_000, credits_included=250, name="Renamed")])

    message = str(refused.value)
    for field in ("amount_paise", "credits_included", "name"):
        assert field in message


def test_a_dry_run_refuses_the_same_edit(make_school, make_subscription):
    """The refusal has to be visible before the write is attempted, or a dry run
    would report a change that the real run will not make."""
    run([entry()])
    make_subscription(school=make_school(), plan=Plan.objects.get(code="test_plan_monthly"))

    with pytest.raises(CommandError):
        run([entry(amount_paise=250_000)], dry_run=True)


# --- what a held plan may still change ---------------------------------------


@pytest.mark.parametrize("change", [{"description": "Clearer wording."}, {"sort_order": 5}])
def test_wording_and_ordering_stay_editable(change, make_school, make_subscription):
    """Neither reaches a charge or an issued invoice."""
    run([entry()])
    plan = Plan.objects.get(code="test_plan_monthly")
    make_subscription(school=make_school(), plan=plan)

    run([entry(**change)])

    plan.refresh_from_db()
    for field, value in change.items():
        assert getattr(plan, field) == value


def test_a_held_plan_can_be_archived(make_school, make_subscription):
    """Retiring is the supported half of a price change, so it must work on
    exactly the plans that are frozen against edits."""
    run([entry()])
    plan = Plan.objects.get(code="test_plan_monthly")
    make_subscription(school=make_school(), plan=plan)

    run([entry(status=Plan.Status.ARCHIVED)])

    plan.refresh_from_db()
    assert plan.status == Plan.Status.ARCHIVED


def test_the_supported_price_change_is_a_new_code_beside_an_archived_one(
    make_school, make_subscription, api_client_for, make_user
):
    """End to end: the old plan leaves the pricing page and stays resolvable for
    the subscription that holds it; the new one is what is on sale."""
    from apps.accounts.roles import SCHOOL_ADMIN

    run([entry()])
    old = Plan.objects.get(code="test_plan_monthly")
    school = make_school()
    subscription = make_subscription(school=school, plan=old)

    run(
        [
            entry(status=Plan.Status.ARCHIVED),
            entry(code="test_plan_monthly_v2", amount_paise=250_000, sort_order=901),
        ]
    )

    old.refresh_from_db()
    subscription.refresh_from_db()
    assert old.status == Plan.Status.ARCHIVED
    # The history still resolves: the subscription points at the plan it was
    # sold, at the price it was sold at.
    assert subscription.plan_id == old.id
    assert old.amount_paise == 100_000

    admin = make_user(SCHOOL_ADMIN, school=school)
    catalogue = api_client_for(admin).get("/api/v1/billing/plans/").json()["results"]
    codes = [plan["code"] for plan in catalogue]
    assert "test_plan_monthly_v2" in codes
    assert "test_plan_monthly" not in codes


# --- the production guard ----------------------------------------------------


def test_the_prices_are_confirmed():
    """The record that a human approved the amounts.

    Set to True on 2026-09-18, when the owner supplied the pricing table the
    catalogue now carries. Before that it was False and this test asserted so,
    which is what made flipping it a deliberate act rather than a drive-by edit.
    """
    assert seeder.PRICING_CONFIRMED is True


def test_unconfirmed_prices_cannot_be_seeded_outside_debug(settings, monkeypatch):
    """The guard itself, which has to keep working for the next price change.

    `PRICING_CONFIRMED` is patched back to False rather than read: the guard is
    the thing under test, not today's value of the flag.
    """
    settings.DEBUG = False
    monkeypatch.setattr(seeder, "PRICING_CONFIRMED", False)

    with pytest.raises(CommandError) as refused:
        run([entry()], pricing_confirmed=False)

    assert "placeholders" in str(refused.value)


def test_an_explicit_acknowledgement_seeds_anyway(settings):
    settings.DEBUG = False

    run([entry()], pricing_confirmed=True)

    assert Plan.objects.filter(code="test_plan_monthly").exists()
