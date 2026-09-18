"""Seed the plan catalogue.

Nothing can be sold until `public.plans` has rows: checkout, subscriptions and
invoices all key off a plan. This command is idempotent - it matches on `code`,
which is the stable identifier - so it is safe to re-run after an edit.

    python manage.py seed_plans            # create or update
    python manage.py seed_plans --dry-run  # show what would change

--------------------------------------------------------------------------
THE SHAPE IS SETTLED. THE AMOUNTS ARE NOT.
--------------------------------------------------------------------------
Day 15.3 fixes the *structure* of the catalogue, and this is it:

  * `audience` separates B2B from B2C. It is a hard boundary, not a label:
    `services._resolve_plan` filters on it, so a parent cannot buy a school
    subscription and a school cannot buy report credits.
  * `billing_period` is `monthly` | `quarterly` | `annual` for a school and
    `one_time` for a parent. A parent top-up has no period because it is not a
    subscription - it is a purchase of credits that do not expire.
  * `credits_included` is granted per period for a school and once for a
    top-up. It is a meter separate from entitlement: a school inside its plan
    with no credits still cannot grade.
  * `max_teachers` / `max_students` are NULL for unlimited. NULL, not a large
    number - "unlimited" and "one million" answer a limit check differently.
  * `features` holds **boolean flags only**. `entitlements.Entitlement.has_feature`
    treats any truthy value as granted, so a tier string like "standard" would
    silently grant a feature named `reports`. Tiers, if they are ever wanted,
    belong in differently-named keys with boolean values.
  * `currency` is INR throughout. Razorpay settles in the merchant's currency
    and every GST rule below assumes a domestic supply.

**Every `amount_paise` below is a placeholder and needs the owner's written
confirmation before it is used to charge anybody.** Pricing is a commercial
decision that cannot be inferred from a codebase. So that a placeholder cannot
reach production by being forgotten, this command refuses to run outside DEBUG
unless `--pricing-confirmed` is passed; flip `PRICING_CONFIRMED` to True once the
real numbers are in and the flag becomes unnecessary.

`gateway_plan_id` is deliberately empty. It is only needed for Razorpay's own
recurring mandates, which checkout does not use - see gateway.py.

--------------------------------------------------------------------------
A PLAN SOMEONE HAS BOUGHT IS NOT EDITABLE
--------------------------------------------------------------------------
This command matches on `code`, so editing an amount here would rewrite the row
a live subscription points at. That is not a safe update, because three things
read the plan row rather than a snapshot of it:

  * a **renewal** prices itself from `plan.amount_paise` at the moment it is
    charged, so an edit changes what an existing school pays, with nothing
    recording that they agreed to it;
  * **credits are granted** from `plan.credits_included` when a payment is
    captured, so an edit changes what a subscriber already inside their period
    receives;
  * an **invoice PDF** prints `plan.name` as the line description, and the
    `invoices` table has no description column of its own - so a rename edits
    the text of invoices that were already issued, which a GST invoice is not
    allowed to do.

So once any subscription or payment references a plan, this command refuses to
change its commercial terms or its name, and says what to do instead: add a new
entry with a new `code` and set the old one to `archived`. Archiving takes it
off the pricing page (`PlanViewSet` filters to active) and out of checkout
(`services._resolve_plan` resolves active plans only), while leaving it
resolvable for the history that points at it. `docs/PRICING.md` has the
procedure and the decisions the owner still has to make.

What stays editable on a plan people hold: `description`, `sort_order` and
`status`. None of them reaches an issued invoice or a charge.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.billing.subscriptions.models import GATEWAY_RAZORPAY, Payment, Plan, Subscription

#: Set to True only when the amounts below are the client's own confirmed
#: prices. Until then this command will not seed a non-DEBUG environment
#: without an explicit acknowledgement on the command line.
#: The prices below are the client's own, from the pricing table supplied on
#: 2026-09-18. They are no longer placeholders, so this is True and the command
#: will seed a production environment without an override.
PRICING_CONFIRMED = True

#: Fields that decide what somebody is charged, what they receive for it, or
#: what an already-issued invoice says. Frozen on a plan that anyone holds; see
#: the module docstring for why each one is on this list.
LOCKED_ONCE_SOLD = (
    "name",
    "amount_paise",
    "currency",
    "audience",
    "billing_period",
    "credits_included",
    "max_teachers",
    "max_students",
    "features",
)

#: How long a pack's capacity lasts. The packs are one-off purchases, not
#: subscriptions - nothing renews - but capacity bought two years ago should not
#: be redeemable at two-year-old prices, so it expires. Mirrored in
#: `services.PACK_VALIDITY_MONTHS`, which is what actually dates the row.
PACK_VALIDITY_MONTHS = 12


def _pack(*, code, name, students, assessments, price_rupees, done_for_you, sort_order, features):
    """One row of the pricing table.

    `credits_included` is students x assessments, because a credit is one
    student's answer sheet analysed - which is where the AI cost is actually
    incurred. `max_students` is the coverage cap from the same row.
    """
    service = "Done for you" if done_for_you else "Do it yourself"
    return {
        "code": code,
        "name": name,
        "description": (
            f"{service}. Up to {students} students, {assessments} "
            f"assessment{'s' if assessments != 1 else ''}. Capacity lasts "
            f"{PACK_VALIDITY_MONTHS} months."
        ),
        "audience": Plan.Audience.SCHOOL,
        # A pack, not a subscription: nothing renews. `services.period_end`
        # gives a school's one-off purchase a 12-month validity window.
        "billing_period": Plan.BillingPeriod.ONE_TIME,
        "amount_paise": price_rupees * 100,
        "credits_included": students * assessments,
        # The table caps students, not staff.
        "max_teachers": None,
        "max_students": students,
        "features": features,
        "sort_order": sort_order,
    }


#: Feature flags are the product's own switches, and the pricing table's
#: "Includes" column is prose rather than a list of them. Only what the table
#: states plainly is set here: the school-wide insight view on Bulk, and
#: priority support on the done-for-you tiers, where a person is doing the work.
#: Anything finer needs the owner's word - see docs/PRICING.md.
_NONE = {"exports": False, "advanced_reports": False, "priority_support": False}
_DFY = {**_NONE, "priority_support": True}
_BULK = {"exports": True, "advanced_reports": True, "priority_support": False}
_BULK_DFY = {**_BULK, "priority_support": True}

CATALOGUE = [
    {
        "code": "xray_free",
        "name": "X-Ray Free",
        "description": (
            "Experience Learning X-Ray. Up to 30 students, 1 assessment. "
            "Granted automatically when a school is approved."
        ),
        "audience": Plan.Audience.SCHOOL,
        "billing_period": Plan.BillingPeriod.ONE_TIME,
        # Free, and never charged for: `services.grant_free_plan` activates it
        # without a payment, so no order, no invoice and no GST are involved.
        "amount_paise": 0,
        "credits_included": 30,
        "max_teachers": None,
        "max_students": 30,
        "features": _NONE,
        "sort_order": 10,
    },
    _pack(
        code="xray_single_diy",
        name="X-Ray Single",
        students=50,
        assessments=1,
        price_rupees=3_500,
        done_for_you=False,
        sort_order=20,
        features=_NONE,
    ),
    _pack(
        code="xray_single_dfy",
        name="X-Ray Single (done for you)",
        students=50,
        assessments=1,
        price_rupees=4_500,
        done_for_you=True,
        sort_order=25,
        features=_DFY,
    ),
    _pack(
        code="xray_multi_diy",
        name="X-Ray Multi",
        students=50,
        assessments=5,
        price_rupees=17_500,
        done_for_you=False,
        sort_order=30,
        features=_NONE,
    ),
    _pack(
        code="xray_multi_dfy",
        name="X-Ray Multi (done for you)",
        students=50,
        assessments=5,
        price_rupees=22_500,
        done_for_you=True,
        sort_order=35,
        features=_DFY,
    ),
    _pack(
        code="xray_bulk_diy",
        name="X-Ray Bulk",
        students=500,
        assessments=1,
        price_rupees=30_000,
        done_for_you=False,
        sort_order=40,
        features=_BULK,
    ),
    _pack(
        code="xray_bulk_dfy",
        name="X-Ray Bulk (done for you)",
        students=500,
        assessments=1,
        price_rupees=40_000,
        done_for_you=True,
        sort_order=45,
        features=_BULK_DFY,
    ),
    # --- retired ---------------------------------------------------------------
    # The three round numbers that stood in for a price before the pricing table
    # existed. Listed here so the seeder actually retires them: it only touches
    # codes in this file, so deleting the entries would have left them on sale.
    {
        "code": "school_starter_monthly",
        "name": "Starter",
        "description": "Retired 2026-09-18, superseded by the X-Ray packs.",
        "audience": Plan.Audience.SCHOOL,
        "billing_period": Plan.BillingPeriod.MONTHLY,
        "amount_paise": 299_900,
        "credits_included": 500,
        "max_teachers": 10,
        "max_students": 300,
        "features": _NONE,
        "sort_order": 900,
        "status": Plan.Status.ARCHIVED,
    },
    {
        "code": "school_standard_annual",
        "name": "Standard",
        "description": "Retired 2026-09-18, superseded by the X-Ray packs.",
        "audience": Plan.Audience.SCHOOL,
        "billing_period": Plan.BillingPeriod.ANNUAL,
        "amount_paise": 2_999_900,
        "credits_included": 6_000,
        "max_teachers": 30,
        "max_students": 1_200,
        "features": {"exports": True, "advanced_reports": False, "priority_support": False},
        "sort_order": 910,
        "status": Plan.Status.ARCHIVED,
    },
    {
        "code": "school_premium_annual",
        "name": "Premium",
        "description": "Retired 2026-09-18, superseded by the X-Ray packs.",
        "audience": Plan.Audience.SCHOOL,
        "billing_period": Plan.BillingPeriod.ANNUAL,
        "amount_paise": 5_999_900,
        "credits_included": 15_000,
        "max_teachers": None,
        "max_students": None,
        "features": {"exports": True, "advanced_reports": True, "priority_support": True},
        "sort_order": 920,
        "status": Plan.Status.ARCHIVED,
    },
    # --- B2C -----------------------------------------------------------------
    # The pricing table covers schools only. These two were invented as
    # placeholders before it arrived, so they are archived rather than left on
    # sale: `_resolve_plan` refuses an archived plan, and an archived row still
    # resolves for any history that points at it. Price them and set
    # `Plan.Status.ACTIVE` when the B2C side is decided.
    {
        "code": "parent_topup_small",
        "name": "20 report credits",
        "description": "For a parent generating their own child's reports.",
        "audience": Plan.Audience.PARENT,
        "billing_period": Plan.BillingPeriod.ONE_TIME,
        "amount_paise": 19_900,
        "credits_included": 20,
        "max_teachers": None,
        "max_students": None,
        "features": {},
        "sort_order": 100,
        "status": Plan.Status.ARCHIVED,
    },
    {
        "code": "parent_topup_large",
        "name": "60 report credits",
        "description": "Better value for a full academic year.",
        "audience": Plan.Audience.PARENT,
        "billing_period": Plan.BillingPeriod.ONE_TIME,
        "amount_paise": 49_900,
        "credits_included": 60,
        "max_teachers": None,
        "max_students": None,
        "features": {},
        "sort_order": 110,
        "status": Plan.Status.ARCHIVED,
    },
]


class Command(BaseCommand):
    help = "Create or update the plan catalogue. Idempotent, keyed on plan code."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report without writing.")
        parser.add_argument(
            "--pricing-confirmed",
            action="store_true",
            help="Acknowledge that the amounts in this file are the client's confirmed prices.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        if not (PRICING_CONFIRMED or options["pricing_confirmed"] or settings.DEBUG or dry_run):
            raise CommandError(
                "The amounts in seed_plans.py are placeholders and have not been confirmed. "
                "Set PRICING_CONFIRMED once the real prices are in, or pass "
                "--pricing-confirmed to seed them deliberately."
            )
        created = updated = unchanged = 0

        for entry in CATALOGUE:
            now = timezone.now()
            defaults = {
                "currency": "INR",
                "gateway": GATEWAY_RAZORPAY,
                # Active unless the entry retires itself. Retiring a plan
                # through the catalogue is the supported half of a price
                # change: the new code is added, the old one archived.
                "status": Plan.Status.ACTIVE,
                **entry,
                "updated_at": now,
            }
            existing = Plan.objects.filter(code=entry["code"]).first()

            if existing is None:
                if not dry_run:
                    Plan.objects.create(id=uuid.uuid4(), created_at=now, **defaults)
                created += 1
                self.stdout.write(self.style.SUCCESS(f"  + {entry['code']}"))
                continue

            changes = {
                field: value
                for field, value in defaults.items()
                if field != "updated_at" and getattr(existing, field) != value
            }
            if not changes:
                unchanged += 1
                self.stdout.write(f"    {entry['code']} (unchanged)")
                continue

            held = self._holders(existing)
            frozen = sorted(set(changes) & set(LOCKED_ONCE_SOLD))
            if frozen and held:
                raise CommandError(
                    f"{entry['code']} is held by {held} and cannot be re-priced in place: "
                    f"{', '.join(frozen)} would change. A renewal prices itself from this row "
                    "and an issued invoice prints its name, so editing it would change what "
                    "someone already pays and what their invoice says.\n"
                    "Instead: add a new entry with a new code carrying the new terms, and set "
                    'this one to "status": Plan.Status.ARCHIVED. See docs/PRICING.md.'
                )

            if not dry_run:
                for field, value in defaults.items():
                    setattr(existing, field, value)
                existing.save()
            updated += 1
            self.stdout.write(
                self.style.WARNING(f"  ~ {entry['code']}: {', '.join(sorted(changes))}")
            )

        verb = "would be" if dry_run else ""
        self.stdout.write(
            f"\n{created} created {verb}, {updated} updated {verb}, {unchanged} unchanged."
        )
        if dry_run:
            transaction.set_rollback(True)

    @staticmethod
    def _holders(plan: Plan) -> str:
        """A short description of who holds this plan, or "" if nobody does.

        Payments as well as subscriptions: a payment that never captured still
        quoted this price to somebody, and an invoice issued against it prints
        the plan's name. A dry run checks the same way, so the refusal is
        visible before anyone tries the write.
        """
        subscriptions = Subscription.objects.filter(plan_id=plan.id).count()
        payments = Payment.objects.filter(plan_id=plan.id).count()
        parts = []
        if subscriptions:
            parts.append(f"{subscriptions} subscription{'s' if subscriptions != 1 else ''}")
        if payments:
            parts.append(f"{payments} payment{'s' if payments != 1 else ''}")
        return " and ".join(parts)
