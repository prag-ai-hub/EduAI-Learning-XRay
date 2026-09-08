"""What a school or a parent is currently entitled to.

One question, one answer, one place. The role matrix (§5) makes entitlement a
gate independent of the account and school gates, and gives it its own status
code: **402, never 403**. The distinction is the whole point - 403 says "you may
not", 402 says "you may, once this is paid" - and a reader stuck on the wrong
one cannot tell whether to call support or reach for a card.

Two meters, kept apart on purpose (payment data model §6):

  * **Entitlement** is the subscription: may this school use the product at all,
    and which features does its plan carry.
  * **Credits** are consumption: has this account got a unit left to spend.

Both must pass before billable work runs. A school inside its plan with no
credits is not entitled to grade, and a school with credits but a lapsed
subscription is not either.

`for_school` calls `public.resolve_entitlement`, the SQL function M9 installed,
rather than reimplementing the rule in Python. Two services read this database
and a rule enforced on one side is not enforced; the subtle part - that
`past_due` entitles only while inside its grace window - is exactly the sort of
thing that drifts when it is written twice.

**Never read `schools.plan_id` for this.** It is a denormalised convenience
column for listings, and both the migration and the model say so.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime

from django.conf import settings
from django.db import connection
from rest_framework.exceptions import APIException

from apps.accounts.models import User


class PaymentRequired(APIException):
    """402. The caller may do this; the subscription does not currently cover it."""

    status_code = 402
    default_detail = "This school's subscription does not cover that."
    default_code = "payment_required"


@dataclass(frozen=True)
class Entitlement:
    """A school's entitlement as of now. Read-only, and never cached.

    Not cached deliberately: the window between a webhook capturing a payment
    and a teacher retrying the work they were just refused is measured in
    seconds, and a stale "no" there is a support ticket.
    """

    has_entitlement: bool
    status: str
    plan_code: str | None = None
    plan_name: str | None = None
    features: dict = field(default_factory=dict)
    credits_included: int = 0
    period_end: datetime | None = None
    grace_until: datetime | None = None

    def has_feature(self, feature: str) -> bool:
        """Is this feature flag on in the plan?

        Absent means off. A plan that has never heard of a feature must not
        grant it, or shipping a feature would silently widen every old plan.
        """
        return self.has_entitlement and bool(self.features.get(feature))


#: What a school with no subscription at all resolves to. `status` mirrors the
#: SQL function's own 'none' rather than inventing a second vocabulary.
UNSUBSCRIBED = Entitlement(has_entitlement=False, status="none")


def for_school(school_id: str | None) -> Entitlement:
    """Resolve a school's entitlement through the one SQL function that decides it."""
    if not school_id:
        return UNSUBSCRIBED

    with connection.cursor() as cursor:
        cursor.execute("select * from public.resolve_entitlement(%s)", [school_id])
        row = cursor.fetchone()

    if row is None:
        return UNSUBSCRIBED

    has, status, plan_code, plan_name, features, credits, period_end, grace_until = row
    return Entitlement(
        has_entitlement=bool(has),
        status=status,
        plan_code=plan_code,
        plan_name=plan_name,
        features=_as_dict(features),
        credits_included=credits or 0,
        period_end=period_end,
        grace_until=grace_until,
    )


def _as_dict(features) -> dict:
    """jsonb off a raw cursor arrives as text, not as a dict.

    Django's psycopg3 backend hands JSON decoding to `JSONField` rather than
    letting the driver do it, so a column read through `connection.cursor()` -
    which is the only way to call a set-returning function - comes back as the
    raw string. Decoding here rather than letting `has_feature` meet a string
    and raise `AttributeError` on a live grading request.
    """
    if isinstance(features, str):
        try:
            features = json.loads(features)
        except ValueError:
            return {}
    return features if isinstance(features, dict) else {}


def credits_remaining(user_id) -> int:
    """A single account's spendable credits.

    This is the B2C meter. A parent has no subscription - they buy credits
    outright - so `for_school` has nothing to say about them, and the balance on
    their own profile row is the whole answer.
    """
    row = User.objects.filter(pk=user_id).values_list("total_credits", "used_credits").first()
    if row is None:
        return 0
    total, used = row
    return max(0, (total or 0) - (used or 0))


def checkout_url() -> str | None:
    """Where a 402 sends someone. None when the frontend URL is unconfigured."""
    base = (settings.FRONTEND_URL or "").rstrip("/")
    return f"{base}/billing" if base else None


def require_entitlement(principal, feature: str | None = None) -> Entitlement:
    """Raise 402 unless the caller's school is covered. Returns the entitlement.

    Call this on billable *work*, not on reads and not on payment surfaces. The
    matrix is explicit that reads and invoice downloads stay open when a
    subscription lapses: hiding the invoice someone needs in order to pay is the
    one behaviour that makes a lapse permanent.

    A parent has no school and so never resolves an entitlement here - their
    meter is `credits_remaining`. Passing one is a programming error rather than
    a refusal, so it says so.
    """
    if getattr(principal, "is_parent", False):
        raise ValueError("Parents hold credits, not a subscription. Use credits_remaining().")

    entitlement = for_school(getattr(principal, "school_id", None))

    if not entitlement.has_entitlement:
        raise PaymentRequired(
            detail={
                "message": "This school has no active subscription.",
                "subscription_status": entitlement.status,
                "checkout_url": checkout_url(),
            }
        )
    if feature and not entitlement.has_feature(feature):
        raise PaymentRequired(
            detail={
                "message": f"The {entitlement.plan_name or entitlement.plan_code} plan "
                "does not include this.",
                "feature": feature,
                "subscription_status": entitlement.status,
                "checkout_url": checkout_url(),
            }
        )
    return entitlement


__all__ = [
    "UNSUBSCRIBED",
    "Entitlement",
    "PaymentRequired",
    "checkout_url",
    "credits_remaining",
    "for_school",
    "require_entitlement",
]
