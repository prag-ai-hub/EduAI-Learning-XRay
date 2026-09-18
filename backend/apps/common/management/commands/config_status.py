"""What this environment can actually do, and what is stopping the rest.

    python manage.py config_status
    python manage.py config_status --strict   # exit 1 if anything is blocked

`check --deploy` answers "is this safe to ship" and stops at the first class of
problem. This answers a different question, the one asked while setting an
environment up: *which product capabilities work right now, which do not, and
what exactly does each one need?*

It exists because the missing pieces are scattered across three consoles and a
dotfile, and the failure they cause is always some distance from the cause - an
unset tax rate surfaces as a 503 on a checkout screen, an unset provider key as
a grading job that refuses. Every entry below names the capability a person
would notice, not the setting.

Nothing here is a secret: it reports whether a value is present, never what it
is. Safe to paste into a ticket.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from django.conf import settings
from django.core.management.base import BaseCommand

READY, BLOCKED, DEGRADED = "READY", "BLOCKED", "DEGRADED"


def _value(name: str):
    """A setting if Django has one, otherwise the raw environment.

    Some of these are not Django settings at all - the Google pair is read by
    the Supabase CLI from the same `.env`, and `SUPABASE_DB_URL` only by
    `make db-push` - but they are part of the same set-up, and a person
    configuring the product does not care which process reads what.
    """
    if hasattr(settings, name):
        return getattr(settings, name)
    return os.environ.get(name)


def _missing(names: tuple[str, ...]) -> list[str]:
    return [n for n in names if _value(n) in (None, "", [])]


@dataclass
class Capability:
    """One thing the product either does or does not do here."""

    name: str
    needs: tuple[str, ...]
    blocks: str
    fix: str
    #: Reported as DEGRADED rather than BLOCKED: the product works, less well.
    optional: bool = False
    #: Only meaningful with DEBUG off.
    production_only: bool = False
    extra: list[str] = field(default_factory=list)


CAPABILITIES = (
    Capability(
        name="Database",
        needs=("DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST"),
        blocks="Everything. No request that touches a row can be served.",
        fix="Set the DB_* block in backend/.env. Local stack: DB_HOST=127.0.0.1, "
        "DB_PORT=54322, DB_PASSWORD=postgres, DB_SSLMODE= (empty).",
    ),
    Capability(
        name="Sign-in (Supabase JWT)",
        needs=("SUPABASE_URL", "SUPABASE_JWT_SECRET"),
        blocks="Every authenticated endpoint. Tokens cannot be verified.",
        fix="SUPABASE_URL and SUPABASE_JWT_SECRET in backend/.env, from the Supabase "
        "project whose tokens this service must accept. They must name the SAME project "
        "the app signs in against.",
    ),
    Capability(
        name="Google sign-in",
        needs=("SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID", "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET"),
        blocks="The 'Continue with Google' button, on the local stack only. Email "
        "sign-in is unaffected.",
        fix="Google Cloud console -> Credentials -> the OAuth client. In production this "
        "pair lives in the Supabase dashboard, not in a file. See docs/SECRETS-AND-ROTATION.md.",
        optional=True,
    ),
    Capability(
        name="AI grading",
        needs=("OPENAI_API_KEY", "OPENAI_MODEL"),
        blocks="Grading an answer sheet, generating worksheets and study guides. The "
        "proxy refuses rather than guessing a model.",
        fix="OPENAI_API_KEY and OPENAI_MODEL in backend/.env. The key never reaches the client.",
    ),
    Capability(
        name="Handwriting OCR",
        needs=("MISTRAL_API_KEY", "MISTRAL_OCR_MODEL"),
        blocks="Reading an uploaded answer sheet, so grading cannot start.",
        fix="MISTRAL_API_KEY and MISTRAL_OCR_MODEL in backend/.env.",
    ),
    Capability(
        name="Taking payments",
        needs=(
            "PAYMENT_GATEWAY_KEY_ID",
            "PAYMENT_GATEWAY_KEY_SECRET",
            "PAYMENT_GATEWAY_WEBHOOK_SECRET",
        ),
        blocks="Checkout, subscriptions and top-ups. The gateway is never dialled, so "
        "nothing is charged - the screen says payments are not configured.",
        fix="Razorpay dashboard -> Settings -> API keys, and the webhook secret from the "
        "webhook you register against /api/v1/billing/webhooks/razorpay. Needs the account "
        "and KYC first (plan row 5.3).",
    ),
    Capability(
        name="GST invoicing",
        needs=("GST_RATE_BPS", "GST_SELLER_STATE_CODE", "GST_SAC_CODE", "GST_SELLER_GSTIN"),
        blocks="Checkout, before the gateway is even reached: an unset tax rate cannot be "
        "read as zero and charged. This is why a checkout 503s even with gateway keys set.",
        fix="The four GST_* values in backend/.env, confirmed by whoever files the returns. "
        "See docs/PRICING.md decision 9.",
    ),
    Capability(
        name="Outbound email",
        needs=("EMAIL_HOST", "EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD"),
        blocks="School approval and rejection emails. The workflow still runs; nobody is told.",
        fix="MAIL_SERVER, MAIL_USERNAME and MAIL_PASSWORD in backend/.env. Development "
        "prints mail to the console instead, so this is production-only.",
        production_only=True,
    ),
    Capability(
        name="Shared rate limits",
        needs=("REDIS_URL",),
        blocks="Nothing outright. Without it every limit is per worker process, so N "
        "workers means N times the allowance, and counters reset on restart.",
        fix="REDIS_URL pointing at a shared instance. The invite-code limit is the one "
        "that matters: it is the brute-force control on linking a child.",
        optional=True,
    ),
    Capability(
        name="Pushing migrations to the hosted project",
        needs=("SUPABASE_DB_URL",),
        blocks="`make db-push`. Nothing in the running service.",
        fix="Set it only when pushing, with the hosted password percent-encoded, or pass it "
        "inline for one command. Deliberately empty the rest of the time.",
        optional=True,
    ),
)


class Command(BaseCommand):
    help = "Report which product capabilities this environment can serve, and what blocks the rest."

    def add_arguments(self, parser):
        parser.add_argument(
            "--strict",
            action="store_true",
            help="Exit 1 if any non-optional capability is blocked.",
        )

    def handle(self, *args, **options):
        rows = [self._assess(capability) for capability in CAPABILITIES]
        rows.extend(self._extras())

        width = max(len(name) for name, _, _ in rows) + 2
        self.stdout.write("")
        for name, status, detail in rows:
            style = {
                READY: self.style.SUCCESS,
                DEGRADED: self.style.WARNING,
                BLOCKED: self.style.ERROR,
            }[status]
            self.stdout.write(f"  {name:{width}} {style(status)}  {detail}")

        blocked = [name for name, status, _ in rows if status == BLOCKED]
        self.stdout.write("")
        for capability in CAPABILITIES:
            if capability.name in blocked:
                self.stdout.write(self.style.MIGRATE_HEADING(f"{capability.name} is blocked"))
                self.stdout.write(f"    what it stops : {capability.blocks}")
                self.stdout.write(f"    how to fix it : {capability.fix}\n\n")

        summary = f"{len(rows) - len(blocked)} of {len(rows)} ready"
        self.stdout.write(self.style.SUCCESS(summary) if not blocked else self.style.ERROR(summary))

        if blocked and options["strict"]:
            raise SystemExit(1)

    def _assess(self, capability: Capability) -> tuple[str, str, str]:
        if capability.production_only and settings.DEBUG:
            return (capability.name, READY, "not required in development")
        missing = _missing(capability.needs)
        if not missing:
            return (capability.name, READY, "")
        status = DEGRADED if capability.optional else BLOCKED
        return (capability.name, status, "unset: " + ", ".join(missing))

    def _extras(self) -> list[tuple[str, str, str]]:
        """Two things that are not a matter of a setting being present."""
        rows = []

        # A catalogue with no rows is a working payment stack with nothing to sell.
        try:
            from apps.billing.subscriptions.management.commands import seed_plans
            from apps.billing.subscriptions.models import Plan

            active = Plan.objects.filter(status=Plan.Status.ACTIVE).count()
            if not active:
                rows.append(("Plans on sale", BLOCKED, "no active plan - run seed_plans"))
            elif not seed_plans.PRICING_CONFIRMED:
                rows.append(
                    (
                        "Plans on sale",
                        DEGRADED,
                        f"{active} active, but the amounts are unconfirmed placeholders "
                        "(PRICING_CONFIRMED is False) - see docs/PRICING.md",
                    )
                )
            else:
                rows.append(("Plans on sale", READY, f"{active} active"))
        except Exception as exc:  # noqa: BLE001 - a database that will not answer is the report
            rows.append(("Plans on sale", BLOCKED, f"could not be read ({type(exc).__name__})"))

        # The database being configured is not the same as it being reachable.
        try:
            from django.db import connection

            connection.ensure_connection()
            rows.append(("Database reachable", READY, connection.settings_dict.get("HOST", "")))
        except Exception as exc:  # noqa: BLE001
            rows.append(("Database reachable", BLOCKED, f"{type(exc).__name__}: could not connect"))

        return rows
