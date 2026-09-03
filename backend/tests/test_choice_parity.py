"""Every Django TextChoices must match the database CHECK constraint.

A choice the database rejects is not caught by any build step: it fails on the
first write, in production, as an IntegrityError. A choice the database allows
but Python omits is worse - a row already in the table becomes unreadable
through the API, or a status check silently never matches.

Values come from ../../supabase/migrations, which is the authority.
"""

import pytest

from apps.accounts.models import Invitation, User
from apps.accounts.roles import ALL_ROLES
from apps.billing.models import Invoice, Payment, PaymentEvent, Plan, Subscription
from apps.parents.models import ParentStudentLink, Relationship
from apps.schools.models import School
from tests.sql_schema import allowed_values


def values(choices) -> set[str]:
    return {value for value, _label in choices}


# (table, column, the Python values that claim to mirror it)
CASES = [
    ("users", "role", set(ALL_ROLES)),
    ("users", "role", values(User._meta.get_field("role").choices)),
    ("invitations", "role", set(Invitation.INVITABLE_ROLES)),
    ("invitations", "status", values(Invitation.Status.choices)),
    ("schools", "status", values(School.Status.choices)),
    ("plans", "audience", values(Plan.Audience.choices)),
    ("plans", "billing_period", values(Plan.BillingPeriod.choices)),
    ("plans", "status", values(Plan.Status.choices)),
    ("subscriptions", "status", values(Subscription.Status.choices)),
    ("payments", "purpose", values(Payment.Purpose.choices)),
    ("payments", "status", values(Payment.Status.choices)),
    ("payment_events", "status", values(PaymentEvent.Status.choices)),
    ("invoices", "status", values(Invoice.Status.choices)),
    ("parent_student_links", "status", values(ParentStudentLink.Status.choices)),
    ("parent_student_links", "linked_via", values(ParentStudentLink.LinkedVia.choices)),
    ("parent_student_links", "relationship", values(Relationship.choices)),
    ("parent_invite_codes", "relationship", values(Relationship.choices)),
]


@pytest.mark.parametrize(
    ("table", "column", "python_values"),
    CASES,
    ids=[f"{t}.{c}" for t, c, _ in CASES],
)
def test_choices_match_the_database_constraint(table, column, python_values):
    assert python_values == set(allowed_values(table, column))


def test_invitations_cannot_carry_the_superadmin_role():
    # A SuperAdmin is promoted, never invited. The narrower constraint on
    # invitations.role is deliberate, not an oversight to be "fixed".
    assert "SuperAdmin" in allowed_values("users", "role")
    assert "SuperAdmin" not in allowed_values("invitations", "role")


def test_the_gateway_is_pinned_to_razorpay_in_the_schema():
    from apps.billing.models import GATEWAY_RAZORPAY

    for table in ("plans", "subscriptions", "payments", "payment_events"):
        assert allowed_values(table, "gateway") == {GATEWAY_RAZORPAY}, (
            f"public.{table}.gateway no longer pins to a single gateway - "
            "supporting a second one is a migration, not a config change"
        )


def test_entitling_subscription_statuses_are_real_statuses():
    assert Subscription.ENTITLING_STATUSES <= allowed_values("subscriptions", "status")
    # A cancelled or expired subscription must never entitle.
    assert not Subscription.ENTITLING_STATUSES & {"cancelled", "expired"}


def test_a_missing_constraint_is_an_error_not_a_pass():
    with pytest.raises(LookupError):
        allowed_values("users", "no_such_column")
