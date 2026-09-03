"""Seed the plan catalogue.

Nothing can be sold until `public.plans` has rows: checkout, subscriptions and
invoices all key off a plan. This command is idempotent - it matches on `code`,
which is the stable identifier - so it is safe to re-run after an edit.

    python manage.py seed_plans            # create or update
    python manage.py seed_plans --dry-run  # show what would change

**The amounts here are placeholders.** Pricing is finalised on Day 15.3 and is
the client's decision; these exist so the payment work has something to point
at. `gateway_plan_id` is deliberately left empty - it is filled in once the
plans exist in the Razorpay dashboard.
"""

from __future__ import annotations

import uuid

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.billing.models import GATEWAY_RAZORPAY, Plan

CATALOGUE = [
    {
        "code": "school_starter_monthly",
        "name": "Starter",
        "description": "A single department trying the product for a term.",
        "audience": Plan.Audience.SCHOOL,
        "billing_period": Plan.BillingPeriod.MONTHLY,
        "amount_paise": 299_900,
        "credits_included": 500,
        "max_teachers": 10,
        "max_students": 300,
        "features": {"support": "email", "reports": "standard"},
        "sort_order": 10,
    },
    {
        "code": "school_standard_annual",
        "name": "Standard",
        "description": "A whole school, billed yearly.",
        "audience": Plan.Audience.SCHOOL,
        "billing_period": Plan.BillingPeriod.ANNUAL,
        "amount_paise": 2_999_900,
        "credits_included": 6_000,
        "max_teachers": 30,
        "max_students": 1_200,
        "features": {"support": "email", "reports": "standard", "exports": True},
        "sort_order": 20,
    },
    {
        "code": "school_premium_annual",
        "name": "Premium",
        "description": "Unlimited teachers and students, priority support.",
        "audience": Plan.Audience.SCHOOL,
        "billing_period": Plan.BillingPeriod.ANNUAL,
        "amount_paise": 5_999_900,
        "credits_included": 15_000,
        # NULL means unlimited - see apps/billing/models.Plan.
        "max_teachers": None,
        "max_students": None,
        "features": {"support": "priority", "reports": "advanced", "exports": True},
        "sort_order": 30,
    },
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
        "sort_order": 40,
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
        "sort_order": 50,
    },
]


class Command(BaseCommand):
    help = "Create or update the plan catalogue. Idempotent, keyed on plan code."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report without writing.")

    @transaction.atomic
    def handle(self, *args, **options):
        dry_run = options["dry_run"]
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
