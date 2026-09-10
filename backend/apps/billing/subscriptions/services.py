"""Checkout, plan changes, and what happens when money actually arrives.

Everything money-shaped that is not an HTTP concern lives here, so that the
views stay thin and the webhook package - which is not this package - can call
the same transitions without reimplementing them.

--------------------------------------------------------------------------
THE PLAN-CHANGE RULE (day 13.1). One paragraph, three behaviours.
--------------------------------------------------------------------------
A captured payment for a plan starts a period of that plan's billing length
running from the moment of capture, **except** where the plan is unchanged, in
which case it runs from the later of now and the current period end. Credits the
plan includes are *added* to the pool; they never replace what is already there.
Nothing is prorated, refunded or clawed back.

So:

  * **Upgrade mid-period** - the new plan's full list price is charged and its
    period starts now. Whatever was left of the old plan is forfeit, and the
    checkout response says so before anyone pays.
  * **Downgrade** - identical treatment, deliberately. There is no "pending plan"
    column to schedule one into, and a downgrade that took effect only at the
    period end would need one.
  * **Same plan again** - a renewal. The new period is *appended* to the current
    one rather than replacing it, so paying early never destroys days already
    bought. This is the one asymmetry, and it exists because the alternative
    punishes the careful payer.

**Why no proration.** Three reasons, in order of weight. (1) Proration means
issuing money back, and this service has no refund path - the matrix gives
`payment.refund.issue` to SuperAdmin alone and nothing implements it, so a
prorated upgrade would promise a credit note that nobody can produce. (2) Plans
differ in credits and in teacher/student limits as well as in price, so "value
already consumed" is not one number to prorate; a school that burned 6,000
credits in week one of an annual plan has not got eleven twelfths of it left.
(3) Whether to prorate at all, and at what rate, is a commercial decision
belonging to the owner of the pricing, exactly like the amounts in
`seed_plans.py`. Wiring in an invented rule would be the same mistake as
inventing a GST rate.

--------------------------------------------------------------------------
IDEMPOTENCY AT CHECKOUT (day 11.1)
--------------------------------------------------------------------------
A double-clicked Pay button must not create two orders. Two mechanisms, one
behind the other:

  1. A transaction-scoped Postgres advisory lock keyed on the payer, taken
     before anything is read. Concurrent clicks serialise instead of racing, so
     the second one sees the first one's row rather than a clean slate. It is
     held across the gateway call, which is why `gateway.TIMEOUT` is tight.
  2. Inside the lock, an open order for the same payer and plan from the last
     `CHECKOUT_REUSE_WINDOW` is returned verbatim - same order id, same amount -
     instead of a second one being created. A client that supplies its own
     `idempotency_key` gets the stricter, exact-match version of the same rule.

`payments.idempotency_key` is unique in the database underneath both, so the
worst case if the lock were ever lost is an integrity error rather than a
duplicate charge.
"""

from __future__ import annotations

import calendar
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from django.conf import settings
from django.db import connection, transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from apps.accounts.models import User
from apps.platform.audit.services import record
from apps.tenants.schools.models import School

from . import gateway
from .models import GATEWAY_RAZORPAY, Payment, Plan, Subscription

logger = logging.getLogger(__name__)

#: How long an unpaid order stays reusable. Long enough to cover a payer who
#: opened the gateway's page, went to find a card and came back; short enough
#: that a plan's price cannot have changed underneath the order in the meantime.
CHECKOUT_REUSE_WINDOW = timedelta(minutes=15)

#: Months per billing period. `one_time` is absent: it has no period, which is
#: what makes it a top-up rather than a subscription.
PERIOD_MONTHS = {
    Plan.BillingPeriod.MONTHLY: 1,
    Plan.BillingPeriod.QUARTERLY: 3,
    Plan.BillingPeriod.ANNUAL: 12,
}

#: `audit_events.school_id` is NOT NULL, and a parent has no school. Rows for
#: tenant-less actions carry this instead. It is not a school id and no school
#: can collide with it - school ids are all `school-{uuid}`.
PLATFORM_SCOPE = "platform"


class BillingAction:
    """Audit action names for this app.

    Stable strings: they are queried and reported on. They are declared here
    rather than in `apps.platform.audit.services.Action` only because that
    module is outside this package's ownership - they belong there.
    """

    CHECKOUT_STARTED = "payment.checkout_started"
    SUBSCRIPTION_ACTIVATED = "subscription.activated"
    SUBSCRIPTION_PLAN_CHANGED = "subscription.plan_changed"
    SUBSCRIPTION_CANCELLED = "subscription.cancelled"
    CREDITS_TOPPED_UP = "credits.topped_up"


class PaymentsNotConfigured(APIException):
    """Tax settings are missing, so no correct total can be computed.

    503 and not a 0% charge. An invoice issued at a rate nobody chose is a
    liability that surfaces months later at an accountant's desk.
    """

    status_code = 503
    default_detail = "Billing is not fully configured in this environment."
    default_code = "billing_not_configured"


class PaymentNotSettled(Exception):
    """A capture-time transition was asked to grant something it must not.

    Raised for a payment that has not captured - the abuse the ordering exists
    to stop - and equally for one whose purpose does not match the transition,
    such as a top-up handed to `activate_subscription`. Both are the same kind
    of mistake: granting on the strength of a row that does not say what the
    caller assumed.

    Not an APIException: nothing a caller of the API can do produces this. It
    means a webhook, or a console session, took a wrong turn, and it should
    surface as a failed event to retry rather than as a status code.
    """


# ---------------------------------------------------------------------------
# GST arithmetic
#
# Kept here rather than in a renderer because the *amount charged* needs it, and
# because the invoice package should use exactly these functions - a tax figure
# computed twice by two files is a tax figure that disagrees with itself.
# ---------------------------------------------------------------------------


def tax_paise(taxable_paise: int, rate_bps: int) -> int:
    """Tax on a taxable amount, in paise, rounded to the nearest whole paisa.

    Computed as twice the half-rate rather than directly, which guarantees an
    **even** result. That is not cosmetic. `invoices_one_tax_shape` requires
    `cgst_paise = sgst_paise` exactly, so an odd total tax cannot be split into
    an intra-state invoice at all: the row is rejected by the database at the
    moment the webhook tries to issue it, long after the money has been taken.
    Rounding at the half here costs at most one paisa and makes every amount
    this service charges renderable as either tax shape.
    """
    half = (taxable_paise * rate_bps + 10_000) // 20_000
    return half * 2


def gst_split(taxable_paise: int, rate_bps: int, *, place_of_supply: str) -> dict:
    """Split tax into CGST+SGST or IGST, per the place of supply.

    Intra-state when the buyer's state code matches the seller's registered one,
    inter-state otherwise. Which of those is correct for a given customer is a
    tax question; this only implements the split once the answer is known, and
    the caller supplies both codes.
    """
    total = tax_paise(taxable_paise, rate_bps)
    if place_of_supply == settings.GST_SELLER_STATE_CODE:
        half = total // 2  # exact: tax_paise always returns an even number
        return {"cgst_paise": half, "sgst_paise": half, "igst_paise": 0}
    return {"cgst_paise": 0, "sgst_paise": 0, "igst_paise": total}


def require_tax_settings() -> int:
    """The configured GST rate in basis points, or 503.

    Zero is a legitimate answer - an exempt supply - but it has to be *stated*.
    `None` means nobody has said, and charging as though the answer were zero
    would put that assumption on an invoice.
    """
    rate = settings.GST_RATE_BPS
    missing = [
        name
        for name, value in (
            ("GST_RATE_BPS", rate),
            ("GST_SELLER_STATE_CODE", settings.GST_SELLER_STATE_CODE),
            ("GST_SAC_CODE", settings.GST_SAC_CODE),
        )
        if value is None or value == ""
    ]
    if missing:
        logger.error("checkout refused: unset tax settings %s", ", ".join(missing))
        raise PaymentsNotConfigured()
    return int(rate)


# ---------------------------------------------------------------------------
# Period arithmetic
# ---------------------------------------------------------------------------


def add_months(moment: datetime, months: int) -> datetime:
    """`moment` shifted by whole months, clamping to the end of a short month.

    31 January plus one month is 28 February, not 3 March: a billing period that
    silently slides forward drifts a subscription off its anniversary. Safe on
    the aware datetimes this service handles because they are UTC, which has no
    DST for `replace` to fall foul of.
    """
    index = moment.month - 1 + months
    year = moment.year + index // 12
    month = index % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def period_end(plan: Plan, start: datetime) -> datetime | None:
    """When a period beginning at `start` ends. None for a one-off purchase."""
    months = PERIOD_MONTHS.get(plan.billing_period)
    return add_months(start, months) if months else None


def monthly_equivalent_paise(plan: Plan) -> int:
    """A plan's price reduced to a per-month figure, for comparing two plans.

    Integer division: the comparison only needs an ordering, and carrying a
    fractional paisa around to decide the word "upgrade" would be worse than
    losing one.
    """
    months = PERIOD_MONTHS.get(plan.billing_period) or 1
    return plan.amount_paise // months


# ---------------------------------------------------------------------------
# Reading the current state
# ---------------------------------------------------------------------------


#: The statuses the "one live subscription per school" partial index covers.
#: Wider than `ENTITLING_STATUSES`, and it has to be: a past_due subscription no
#: longer entitles anything but still occupies the school's one live slot, so a
#: renewal must find and update it rather than create a second row beside it.
LIVE_STATUSES = frozenset(Subscription.ENTITLING_STATUSES | {Subscription.Status.PAST_DUE})


def live_subscription(school_id: str, *, for_update: bool = False) -> Subscription | None:
    """The school's one non-terminal subscription, if it has one.

    `subscriptions_one_live_per_school_idx` guarantees there is at most one, so
    this is a lookup rather than a choice between candidates.
    """
    queryset = Subscription.objects.filter(school_id=school_id, status__in=LIVE_STATUSES)
    if for_update:
        queryset = queryset.select_for_update()
    return queryset.order_by("-created_at").first()


def describe_plan_change(current: Subscription | None, plan: Plan, *, now=None) -> dict:
    """What buying `plan` would do to `current`. Shown before anyone pays.

    Returned to the client so a UI can confirm a forfeit rather than discover
    it; the `kind` is also what decides `payments.purpose`.
    """
    now = now or timezone.now()

    if current is None:
        return {"kind": "new", "forfeits_days": 0, "message": "Starts a new subscription."}

    if current.plan_id == plan.id:
        remaining = _days_between(now, current.current_period_end)
        return {
            "kind": "renewal",
            "forfeits_days": 0,
            "message": (
                f"Extends the current plan. The {remaining} day(s) already paid for are kept."
                if remaining
                else "Renews the current plan."
            ),
        }

    forfeited = _days_between(now, current.current_period_end)
    current_rate = monthly_equivalent_paise(current.plan)
    new_rate = monthly_equivalent_paise(plan)
    if new_rate > current_rate:
        kind = "upgrade"
    elif new_rate < current_rate:
        kind = "downgrade"
    else:
        # Same money, different plan: the limits or credits differ. Neither word
        # fits, and calling it an upgrade would be a claim we cannot support.
        kind = "lateral"
    message = f"Replaces the {current.plan.name} plan immediately."
    if forfeited:
        # Said plainly, because the money is real and the decision is theirs.
        message += (
            f" {forfeited} day(s) remaining on it are not refunded or credited - "
            "this service does not prorate."
        )
    return {"kind": kind, "forfeits_days": forfeited, "message": message}


def _days_between(now: datetime, end: datetime | None) -> int:
    if end is None or end <= now:
        return 0
    return (end - now).days


# ---------------------------------------------------------------------------
# Checkout
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Checkout:
    """What a checkout call produced. `reused` distinguishes the second click."""

    payment: Payment
    plan: Plan
    reused: bool
    change: dict


class CheckoutInProgress(APIException):
    """A concurrent checkout for this payer holds the order that is not ready yet.

    409 rather than a second order. This is the losing side of a race that the
    advisory lock has already resolved correctly; retrying gets the winner's
    order id a moment later.
    """

    status_code = 409
    default_detail = "A checkout for this payer is already in progress. Try again in a moment."
    default_code = "checkout_in_progress"


def start_school_checkout(*, principal, plan_code: str, billing: dict, idempotency_key=None):
    """B2B: a SchoolAdmin subscribes, upgrades or downgrades.

    Deliberately **not** gated on `require_active_school`. Matrix §5 stops new
    billable work for a Pending or Suspended school and leaves reads and
    payment open, for the reason it gives: a school must always be able to see
    and settle what it owes. Blocking checkout here would make suspension
    irreversible by the only party who can reverse it.
    """
    school_id = getattr(principal, "school_id", None)
    if not school_id:
        raise ValidationError({"detail": "Your account is not attached to a school."})

    plan = _resolve_plan(plan_code, Plan.Audience.SCHOOL)
    current = live_subscription(school_id)
    change = describe_plan_change(current, plan)
    purpose = (
        Payment.Purpose.SUBSCRIPTION_RENEWAL
        if change["kind"] == "renewal"
        else Payment.Purpose.SUBSCRIPTION
    )
    return _checkout(
        principal=principal,
        plan=plan,
        purpose=purpose,
        billing=billing,
        change=change,
        payer={"school_id": school_id},
        audit_school_id=school_id,
        idempotency_key=idempotency_key,
    )


def start_parent_topup(*, principal, plan_code: str, billing: dict, idempotency_key=None):
    """B2C: a parent buys report credits.

    Nothing here grants a credit. The order is created, the payment row is
    `created`, and the balance is untouched until `grant_topup_credits` runs
    against a captured payment - see its docstring for why that ordering is the
    only safe one.
    """
    plan = _resolve_plan(plan_code, Plan.Audience.PARENT)
    return _checkout(
        principal=principal,
        plan=plan,
        purpose=Payment.Purpose.CREDIT_TOPUP,
        billing=billing,
        change={"kind": "topup", "forfeits_days": 0, "message": "Adds credits to your balance."},
        payer={"parent_user_id": principal.id},
        audit_school_id=PLATFORM_SCOPE,
        idempotency_key=idempotency_key,
    )


def _resolve_plan(code: str, audience: str) -> Plan:
    """The active plan with this code, for this audience, or a 400.

    The audience filter is the guard, not a convenience: without it a parent
    could name a school plan and buy a school's entitlement for themselves, and
    `payments_single_payer` would happily store it.
    """
    plan = Plan.objects.filter(code=code, audience=audience, status=Plan.Status.ACTIVE).first()
    if plan is None:
        raise ValidationError({"plan_code": "No such plan is on sale."})
    return plan


def _checkout(
    *,
    principal,
    plan: Plan,
    purpose: str,
    billing: dict,
    change: dict,
    payer: dict,
    audit_school_id: str,
    idempotency_key: str | None,
) -> Checkout:
    rate_bps = require_tax_settings()
    payer_scope = f"checkout:{payer.get('school_id') or payer.get('parent_user_id')}"

    with transaction.atomic():
        _lock_payer(payer_scope)

        reuse = _existing_checkout(payer, plan, purpose, idempotency_key)
        if reuse is not None:
            if not reuse.gateway_order_id:
                # The other side of the race has claimed the key but has not
                # come back from the gateway. Never a second order.
                raise CheckoutInProgress()
            return Checkout(payment=reuse, plan=plan, reused=True, change=change)

        now = timezone.now()
        tax = tax_paise(plan.amount_paise, rate_bps)
        key = _stored_key(purpose, payer, plan, idempotency_key)

        payment = Payment.objects.create(
            id=uuid.uuid4(),
            school_id=payer.get("school_id"),
            parent_user_id=payer.get("parent_user_id"),
            # Left null on purpose. Setting it here would make the payment look
            # already applied to `activate_subscription`, which uses exactly
            # that field to make a webhook redelivery a no-op.
            subscription=None,
            plan=plan,
            purpose=purpose,
            amount_paise=plan.amount_paise,
            tax_paise=tax,
            total_paise=plan.amount_paise + tax,
            currency=plan.currency,
            status=Payment.Status.CREATED,
            gateway=GATEWAY_RAZORPAY,
            idempotency_key=key,
            notes={
                # The invoice package reads `billing` from here: it is the
                # buyer's own snapshot as given at checkout, which is what a GST
                # invoice must show, and re-reading the school row months later
                # would print today's address on last year's invoice.
                "billing": billing,
                "planCode": plan.code,
                "taxRateBps": rate_bps,
                "change": change,
            },
            created_at=now,
            updated_at=now,
        )

        order = gateway.create_order(
            amount_paise=payment.total_paise,
            currency=payment.currency,
            receipt=str(payment.id),
            # Only what the webhook needs to correlate. The billing address
            # stays here; handing a customer's address to the gateway as free
            # text puts it somewhere we cannot later purge.
            notes={
                "paymentId": str(payment.id),
                "purpose": purpose,
                "planCode": plan.code,
                **{k: str(v) for k, v in payer.items()},
            },
        )
        payment.gateway_order_id = order["id"]
        payment.updated_at = timezone.now()
        payment.save(update_fields=["gateway_order_id", "updated_at"])

    record(
        action=BillingAction.CHECKOUT_STARTED,
        school_id=audit_school_id,
        actor_id=principal.id,
        entity_type="payment",
        entity_id=str(payment.id),
        detail={
            "purpose": purpose,
            "planCode": plan.code,
            "totalPaise": payment.total_paise,
            "orderId": payment.gateway_order_id,
            "change": change["kind"],
        },
    )
    return Checkout(payment=payment, plan=plan, reused=False, change=change)


def _lock_payer(scope: str) -> None:
    """Serialise concurrent checkouts for one payer, for this transaction only.

    An advisory lock rather than a row lock because the row being protected does
    not exist yet - the thing being made mutually exclusive is the decision to
    create it. Transaction-scoped, so it is released by commit or rollback and
    cannot be leaked by an exception path.
    """
    with connection.cursor() as cursor:
        cursor.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", [scope])


def _existing_checkout(payer: dict, plan: Plan, purpose: str, client_key: str | None):
    """An order this call should return instead of creating another.

    Two rules. A client-supplied key is exact and unbounded in time: that is what
    an idempotency key means, and a client that re-sends one is asking for its
    first answer back. Without one, an unpaid order for the same payer and plan
    from the reuse window is returned, which is what actually catches a
    double-clicked button - browsers do not send idempotency keys by themselves.
    """
    if client_key:
        # The newest attempt under this logical key, and only if it is still
        # worth returning. A FAILED payment took no money and produced nothing,
        # so handing it back forever would leave the payer unable to buy this
        # plan again with the key their client generated - a wedge that only
        # ends when they clear their storage. M15 set the precedent: a terminal
        # outcome releases the key rather than sealing it.
        latest = _attempts(purpose, payer, plan, client_key).order_by("-created_at").first()
        if latest is not None and latest.status == Payment.Status.FAILED:
            return None
        return latest

    return (
        Payment.objects.filter(
            status=Payment.Status.CREATED,
            purpose=purpose,
            plan=plan,
            created_at__gte=timezone.now() - CHECKOUT_REUSE_WINDOW,
            **_payer_lookup(payer),
        )
        .order_by("-created_at")
        .first()
    )


def _stored_key(purpose: str, payer: dict, plan: Plan, client_key: str | None) -> str:
    """The value actually written to `payments.idempotency_key`, which is unique.

    Without a client key the nonce is random and collides with nothing. With
    one, a retry after a failed attempt has to differ from the row that failed,
    so it takes the next `#n`. The logical key stays the caller's, which is what
    `_attempts` matches on.
    """
    logical = _idempotency_key(purpose, payer, plan, client_key)
    if not client_key:
        return logical
    taken = _attempts(purpose, payer, plan, client_key).count()
    return logical if taken == 0 else f"{logical}#{taken + 1}"


def _attempts(purpose: str, payer: dict, plan: Plan, client_key: str):
    """Every payment written under one client-supplied key.

    A retry after a failure cannot reuse the stored key - `idempotency_key` is
    unique - so attempts after the first carry a `#n` suffix. Matching is the
    exact key or the key plus that separator, never a bare prefix: `...:abc`
    must not match a different caller's `...:abcd`.
    """
    logical = _idempotency_key(purpose, payer, plan, client_key)
    return Payment.objects.filter(
        Q(idempotency_key=logical) | Q(idempotency_key__startswith=f"{logical}#")
    )


def _payer_lookup(payer: dict) -> dict:
    """Match on the payer, and on the *absence* of the other one.

    Both columns are nullable and `payments_single_payer` only says exactly one
    is set, so filtering on school alone would be satisfied by nothing unusual
    today but would stop being a complete predicate the moment a payment carried
    both. Stating both halves keeps the query honest against the constraint.
    """
    if payer.get("school_id"):
        return {"school_id": payer["school_id"], "parent_user_id__isnull": True}
    return {"parent_user_id": payer["parent_user_id"], "school_id__isnull": True}


def _idempotency_key(purpose: str, payer: dict, plan: Plan, client_key: str | None) -> str:
    """`{purpose}:{payer}:{plan}:{nonce}` - the shape the data model specifies.

    Namespaced by payer so one tenant cannot collide with, or squat on, another
    tenant's key; a caller supplies only the nonce.
    """
    payer_id = payer.get("school_id") or payer.get("parent_user_id")
    nonce = client_key or uuid.uuid4().hex
    return f"{purpose}:{payer_id}:{plan.code}:{nonce}"


# ---------------------------------------------------------------------------
# Capture-time transitions
#
# These are the seams the webhook package calls. Both refuse to run for a
# payment that has not captured, and both are safe to call twice, because a
# gateway redelivers.
# ---------------------------------------------------------------------------


def activate_subscription(payment: Payment) -> Subscription:
    """Apply a captured subscription payment. Idempotent.

    The plan-change rule in the module docstring is implemented in the five
    lines that compute `start`. Everything else is bookkeeping.

    Idempotency is `payment.subscription_id`: a payment that has already been
    applied carries the subscription it produced, and a redelivery returns that
    rather than extending the period a second time. The check runs under a row
    lock on the payment, so two simultaneous deliveries cannot both find it
    unset.
    """
    with transaction.atomic():
        # `of=("self",)`: `plan` is a nullable FK, so `select_related` makes it a
        # LEFT OUTER JOIN and Postgres refuses FOR UPDATE on the nullable side.
        # Only the payment row needs locking in any case.
        payment = (
            Payment.objects.select_for_update(of=("self",))
            .select_related("plan")
            .get(pk=payment.pk)
        )
        _require_captured(payment)
        # Two captures for one school arriving together would both find no live
        # subscription and both try to create one, and only one would survive
        # `subscriptions_one_live_per_school_idx`. Serialise them here instead of
        # letting the loser surface as an integrity error in a webhook.
        if payment.school_id:
            _lock_payer(f"subscription:{payment.school_id}")

        if payment.purpose == Payment.Purpose.CREDIT_TOPUP:
            raise PaymentNotSettled("A credit top-up does not create a subscription.")
        if payment.subscription_id:
            return payment.subscription

        plan = payment.plan
        school_id = payment.school_id
        if plan is None or not school_id:
            raise PaymentNotSettled("A subscription payment needs both a school and a plan.")

        now = timezone.now()
        current = live_subscription(school_id, for_update=True)

        # THE RULE. A renewal of the same plan appends to what is already paid
        # for; any other change starts now and forfeits the remainder.
        renewing = (
            current is not None
            and current.plan_id == plan.id
            and current.current_period_end is not None
            and current.current_period_end > now
        )
        start = current.current_period_end if renewing else now

        if current is None:
            subscription = Subscription.objects.create(
                id=uuid.uuid4(),
                school_id=school_id,
                plan=plan,
                status=Subscription.Status.ACTIVE,
                current_period_start=start,
                current_period_end=period_end(plan, start),
                grace_until=None,
                cancel_at_period_end=False,
                gateway=GATEWAY_RAZORPAY,
                started_at=now,
                created_at=now,
                updated_at=now,
            )
            action = BillingAction.SUBSCRIPTION_ACTIVATED
            previous_plan = None
        else:
            previous_plan = current.plan.code if current.plan_id != plan.id else None
            current.plan = plan
            current.status = Subscription.Status.ACTIVE
            current.current_period_start = start
            current.current_period_end = period_end(plan, start)
            # Payment settles the reasons a subscription was in trouble.
            current.grace_until = None
            current.cancel_at_period_end = False
            current.ended_at = None
            current.cancelled_at = None
            current.updated_at = now
            current.save(
                update_fields=[
                    "plan",
                    "status",
                    "current_period_start",
                    "current_period_end",
                    "grace_until",
                    "cancel_at_period_end",
                    "ended_at",
                    "cancelled_at",
                    "updated_at",
                ]
            )
            subscription = current
            action = (
                BillingAction.SUBSCRIPTION_PLAN_CHANGED
                if previous_plan
                else BillingAction.SUBSCRIPTION_ACTIVATED
            )

        payment.subscription = subscription
        payment.updated_at = now
        payment.save(update_fields=["subscription", "updated_at"])

        # Denormalised for admin listings only, and maintained here because M9
        # says the webhook maintains it. Nothing reads it for an entitlement.
        School.objects.filter(pk=school_id).update(plan_id=plan.id, updated_at=now)

    record(
        action=action,
        school_id=school_id,
        actor_id=None,  # a gateway confirmation has no human actor
        entity_type="subscription",
        entity_id=str(subscription.id),
        detail={
            "planCode": plan.code,
            "previousPlanCode": previous_plan,
            "periodStart": start.isoformat(),
            "periodEnd": subscription.current_period_end.isoformat()
            if subscription.current_period_end
            else None,
            "paymentId": str(payment.id),
        },
    )
    return subscription


def grant_topup_credits(payment: Payment) -> int:
    """Add the plan's credits to a parent's balance. Idempotent. Returns the amount.

    **Credits land only here.** Checkout creates an order and moves no balance;
    an unpaid order that granted credits is the obvious abuse of a top-up, and
    the only defence is that the grant has one caller and that caller demands a
    captured payment.

    This is the mirror of the ordering the grading path already uses - deduct
    before the work, refund on failure, and never let an early return skip the
    refund. Here the same principle points the other way: never let an early
    return, or a redelivered webhook, add credits twice.

    The idempotency guard is a ledger lookup under a row lock on the payment,
    *not* a unique index. It used to be one: `credit_transactions` had a unique
    `(user_id, operation_key)` index, but M15 narrowed it to live consumption
    rows so that a refunded operation could be charged again, and it therefore
    no longer constrains a `purchase` row at all. The lock is what serialises
    two simultaneous deliveries; the `operation_key` is left on the row for
    humans reading the ledger.
    """
    with transaction.atomic():
        # `of=("self",)`: `plan` is a nullable FK, so `select_related` makes it a
        # LEFT OUTER JOIN and Postgres refuses FOR UPDATE on the nullable side.
        # Only the payment row needs locking in any case.
        payment = (
            Payment.objects.select_for_update(of=("self",))
            .select_related("plan")
            .get(pk=payment.pk)
        )
        _require_captured(payment)

        if payment.purpose != Payment.Purpose.CREDIT_TOPUP:
            raise PaymentNotSettled("Only a credit top-up grants credits.")
        if not payment.parent_user_id or payment.plan is None:
            raise PaymentNotSettled("A top-up needs both a parent and a plan.")

        operation_key = f"topup:{payment.id}"
        with connection.cursor() as cursor:
            cursor.execute(
                "select 1 from public.credit_transactions "
                "where payment_id = %s and transaction_type = 'purchase' limit 1",
                [str(payment.id)],
            )
            if cursor.fetchone() is not None:
                return 0

            credits = payment.plan.credits_included
            if credits <= 0:
                return 0

            cursor.execute(
                "insert into public.credit_transactions "
                "(id, user_id, amount, transaction_type, operation_key, reference, "
                " reason, payment_id) "
                "values (%s, %s, %s, 'purchase', %s, %s, %s, %s)",
                [
                    str(uuid.uuid4()),
                    str(payment.parent_user_id),
                    credits,
                    operation_key,
                    payment.gateway_payment_id or payment.gateway_order_id,
                    f"Credit top-up: {payment.plan.name}",
                    str(payment.id),
                ],
            )

        # The ledger row is written first and the balance second, both inside
        # this transaction: the ledger is the record, the balance is a cache of
        # it, and a balance without its ledger row is unexplainable.
        # `F` rather than a read-then-write: a school admin allocating credits
        # between the read and the write would otherwise be silently overwritten.
        updated = User.objects.filter(pk=payment.parent_user_id).update(
            total_credits=F("total_credits") + credits, updated_at=timezone.now()
        )
        if updated != 1:
            raise PaymentNotSettled("The paying account no longer exists.")

    record(
        action=BillingAction.CREDITS_TOPPED_UP,
        school_id=PLATFORM_SCOPE,
        actor_id=str(payment.parent_user_id),
        entity_type="payment",
        entity_id=str(payment.id),
        detail={"credits": credits, "planCode": payment.plan.code},
    )
    return credits


def _require_captured(payment: Payment) -> None:
    if payment.status not in Payment.SETTLED_STATUSES:
        raise PaymentNotSettled(
            f"Payment {payment.id} is {payment.status}; nothing is granted before capture."
        )


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


def cancel_at_period_end(*, principal) -> Subscription:
    """Stop a subscription renewing, without ending the period already paid for.

    Only this shape is offered. An immediate cancellation would end an
    entitlement the school has already paid for and would owe them money back,
    and there is no refund path - `payment.refund.issue` belongs to SuperAdmin
    and nothing implements it yet.
    """
    school_id = getattr(principal, "school_id", None)
    if not school_id:
        raise ValidationError({"detail": "Your account is not attached to a school."})

    with transaction.atomic():
        subscription = live_subscription(school_id, for_update=True)
        if subscription is None:
            raise ValidationError({"detail": "There is no active subscription to cancel."})
        if subscription.cancel_at_period_end:
            return subscription

        if subscription.gateway_subscription_id:
            # Only reached for a mandate created out-of-band; checkout creates
            # orders, not gateway subscriptions. Inside the transaction so a
            # gateway refusal leaves our row unchanged rather than showing a
            # cancellation that never reached them.
            gateway.cancel_subscription(
                gateway_subscription_id=subscription.gateway_subscription_id,
                at_cycle_end=True,
            )

        subscription.cancel_at_period_end = True
        subscription.cancelled_at = timezone.now()
        subscription.updated_at = subscription.cancelled_at
        subscription.save(update_fields=["cancel_at_period_end", "cancelled_at", "updated_at"])

    record(
        action=BillingAction.SUBSCRIPTION_CANCELLED,
        school_id=school_id,
        actor_id=principal.id,
        entity_type="subscription",
        entity_id=str(subscription.id),
        detail={
            "planCode": subscription.plan.code,
            "endsAt": subscription.current_period_end.isoformat()
            if subscription.current_period_end
            else None,
        },
    )
    return subscription


__all__ = [
    "CHECKOUT_REUSE_WINDOW",
    "PLATFORM_SCOPE",
    "BillingAction",
    "Checkout",
    "CheckoutInProgress",
    "PaymentNotSettled",
    "PaymentsNotConfigured",
    "activate_subscription",
    "add_months",
    "cancel_at_period_end",
    "describe_plan_change",
    "grant_topup_credits",
    "gst_split",
    "LIVE_STATUSES",
    "live_subscription",
    "monthly_equivalent_paise",
    "period_end",
    "require_tax_settings",
    "start_parent_topup",
    "start_school_checkout",
    "tax_paise",
]
