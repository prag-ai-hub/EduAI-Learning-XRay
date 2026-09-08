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
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.billing.subscriptions.models import GATEWAY_RAZORPAY, Plan

#: Set to True only when the amounts below are the client's own confirmed
#: prices. Until then this command will not seed a non-DEBUG environment
#: without an explicit acknowledgement on the command line.
PRICING_CONFIRMED = False

CATALOGUE = [
    {
        "code": "school_starter_monthly",
        "name": "Starter",
        "description": "A single department trying the product for a term.",
        "audience": Plan.Audience.SCHOOL,
        "billing_period": Plan.BillingPeriod.MONTHLY,
        "amount_paise": 299_900,  # PLACEHOLDER - needs the owner's confirmation
        "credits_included": 500,
        "max_teachers": 10,
        "max_students": 300,
        "features": {"exports": False, "advanced_reports": False, "priority_support": False},
        "sort_order": 10,
    },
    {
        "code": "school_standard_annual",
        "name": "Standard",
        "description": "A whole school, billed yearly.",
        "audience": Plan.Audience.SCHOOL,
        "billing_period": Plan.BillingPeriod.ANNUAL,
        "amount_paise": 2_999_900,  # PLACEHOLDER - needs the owner's confirmation
        "credits_included": 6_000,
        "max_teachers": 30,
        "max_students": 1_200,
        "features": {"exports": True, "advanced_reports": False, "priority_support": False},
        "sort_order": 20,
    },
    {
        "code": "school_premium_annual",
        "name": "Premium",
        "description": "Unlimited teachers and students, priority support.",
        "audience": Plan.Audience.SCHOOL,
        "billing_period": Plan.BillingPeriod.ANNUAL,
        "amount_paise": 5_999_900,  # PLACEHOLDER - needs the owner's confirmation
        "credits_included": 15_000,
        # NULL means unlimited - see apps/billing/subscriptions/models.Plan.
        "max_teachers": None,
        "max_students": None,
        "features": {"exports": True, "advanced_reports": True, "priority_support": True},
        "sort_order": 30,
    },
    {
        "code": "parent_topup_small",
        "name": "20 report credits",
        "description": "For a parent generating their own child's reports.",
        "audience": Plan.Audience.PARENT,
        "billing_period": Plan.BillingPeriod.ONE_TIME,
        "amount_paise": 19_900,  # PLACEHOLDER - needs the owner's confirmation
        "credits_included": 20,
        # Limits and feature flags are school concepts. A parent buys credits.
        "max_teachers": None,
        "max_students": None,
        "features": {},
        "sort_order": 40,
    },
    {
        "code": "parent_topup_large",
        "name": "60 report credits",
        "description": "Better value for a full academic year.",
        "audience": Plan.Audience.PARENT,
        "billing_period": Plan.BillingPeriod.ONE_TIME,
        "amount_paise": 49_900,  # PLACEHOLDER - needs the owner's confirmation
        "credits_included": 60,
        "max_teachers": None,
        "max_students": None,
        "features": {},
        "sort_order": 50,
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
                **entry,
                "currency": "INR",
                "gateway": GATEWAY_RAZORPAY,
                "status": Plan.Status.ACTIVE,
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
