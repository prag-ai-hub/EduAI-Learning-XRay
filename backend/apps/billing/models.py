"""Plans, subscriptions, payments, invoices.

All unmanaged - see apps/accounts/models.py for the rule and the reasoning.
Built by M9 (plans, subscriptions) and M10 (payments, payment_events,
invoices, invoice_counters).

Money is stored in paise as integers, never as a float. Every enumerated
column below mirrors a CHECK constraint; the database rejects anything else,
so these choices are a contract, not a suggestion.
"""

from django.db import models

# The schema hardcodes the gateway: `check (gateway = 'razorpay')` on plans,
# subscriptions, payments and payment_events. Supporting a second gateway is a
# migration, not a config change.
GATEWAY_RAZORPAY = "razorpay"


class Plan(models.Model):
    """A purchasable plan. `code` is the stable identifier; `id` is internal."""

    class Audience(models.TextChoices):
        SCHOOL = "school", "School (B2B)"
        PARENT = "parent", "Parent (B2C)"

    class BillingPeriod(models.TextChoices):
        MONTHLY = "monthly", "Monthly"
        QUARTERLY = "quarterly", "Quarterly"
        ANNUAL = "annual", "Annual"
        ONE_TIME = "one_time", "One time"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True)
    code = models.TextField(unique=True)  # ^[a-z0-9_]{3,60}$
    name = models.TextField()
    description = models.TextField(blank=True, null=True)
    audience = models.TextField(choices=Audience.choices)
    billing_period = models.TextField(choices=BillingPeriod.choices)
    amount_paise = models.BigIntegerField()
    currency = models.TextField()  # ^[A-Z]{3}$
    credits_included = models.IntegerField()
    max_teachers = models.IntegerField(blank=True, null=True)  # NULL = unlimited
    max_students = models.IntegerField(blank=True, null=True)  # NULL = unlimited
    features = models.JSONField()
    gateway = models.TextField(blank=True, null=True)
    gateway_plan_id = models.TextField(blank=True, null=True)
    status = models.TextField(choices=Status.choices)
    sort_order = models.IntegerField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "plans"

    def __str__(self) -> str:
        return f"{self.code} ({self.amount_paise / 100:.2f} {self.currency})"


class Subscription(models.Model):
    """A school's current entitlement. One per school - the FK is unique.

    This, not `schools.School.plan`, decides what a school is entitled to.
    `grace` is a distinct status from `past_due`: a payment failed and the
    grace window (`grace_until`) has not closed yet.
    """

    class Status(models.TextChoices):
        TRIALING = "trialing", "Trialing"
        ACTIVE = "active", "Active"
        PAST_DUE = "past_due", "Past due"
        GRACE = "grace", "In grace period"
        CANCELLED = "cancelled", "Cancelled"
        EXPIRED = "expired", "Expired"

    # Statuses under which the product should still be served.
    ENTITLING_STATUSES = frozenset({Status.TRIALING, Status.ACTIVE, Status.GRACE})

    id = models.UUIDField(primary_key=True)
    school = models.OneToOneField("schools.School", models.DO_NOTHING, related_name="subscription")
    plan = models.ForeignKey(Plan, models.DO_NOTHING, related_name="subscriptions")
    status = models.TextField(choices=Status.choices)
    current_period_start = models.DateTimeField(blank=True, null=True)
    current_period_end = models.DateTimeField(blank=True, null=True)
    grace_until = models.DateTimeField(blank=True, null=True)
    cancel_at_period_end = models.BooleanField()
    gateway = models.TextField()
    gateway_subscription_id = models.TextField(blank=True, null=True)
    gateway_customer_id = models.TextField(blank=True, null=True)
    started_at = models.DateTimeField(blank=True, null=True)
    cancelled_at = models.DateTimeField(blank=True, null=True)
    ended_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "subscriptions"
        unique_together = (("gateway", "gateway_subscription_id"),)

    def __str__(self) -> str:
        return f"{self.school_id}: {self.plan_id} ({self.status})"

    @property
    def entitles(self) -> bool:
        return self.status in self.ENTITLING_STATUSES


class Payment(models.Model):
    """One payment attempt.

    Exactly one payer: `payments_single_payer` enforces that `school` and
    `parent_user` are mutually exclusive - a B2B payment has a school, a B2C
    top-up has a parent, never both and never neither.

    `idempotency_key` is unique. M15 made a refund reopen the operation key so
    a refunded operation can be charged again.
    """

    class Purpose(models.TextChoices):
        SUBSCRIPTION = "subscription", "New subscription"
        SUBSCRIPTION_RENEWAL = "subscription_renewal", "Renewal"
        CREDIT_TOPUP = "credit_topup", "Credit top-up"

    class Status(models.TextChoices):
        CREATED = "created", "Created"
        AUTHORIZED = "authorized", "Authorized"
        CAPTURED = "captured", "Captured"
        FAILED = "failed", "Failed"
        REFUNDED = "refunded", "Refunded"
        PARTIALLY_REFUNDED = "partially_refunded", "Partially refunded"

    # The only status that means money actually moved.
    SETTLED_STATUSES = frozenset({Status.CAPTURED})

    id = models.UUIDField(primary_key=True)
    school = models.ForeignKey(
        "schools.School",
        models.DO_NOTHING,
        blank=True,
        null=True,
        related_name="payments",
    )
    parent_user = models.ForeignKey(
        "accounts.User",
        models.DO_NOTHING,
        blank=True,
        null=True,
        related_name="payments",
    )
    subscription = models.ForeignKey(
        Subscription, models.DO_NOTHING, blank=True, null=True, related_name="payments"
    )
    plan = models.ForeignKey(
        Plan, models.DO_NOTHING, blank=True, null=True, related_name="payments"
    )
    purpose = models.TextField(choices=Purpose.choices)

    # total_paise = amount_paise + tax_paise, enforced by payments_total_adds_up.
    amount_paise = models.BigIntegerField()
    tax_paise = models.BigIntegerField()
    total_paise = models.BigIntegerField()
    currency = models.TextField()

    status = models.TextField(choices=Status.choices)
    gateway = models.TextField()
    gateway_order_id = models.TextField(blank=True, null=True)
    gateway_payment_id = models.TextField(blank=True, null=True)
    method = models.TextField(blank=True, null=True)
    failure_code = models.TextField(blank=True, null=True)
    failure_reason = models.TextField(blank=True, null=True)
    idempotency_key = models.TextField(unique=True)
    notes = models.JSONField()
    captured_at = models.DateTimeField(blank=True, null=True)
    refunded_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "payments"
        unique_together = (("gateway", "gateway_payment_id"),)

    def __str__(self) -> str:
        return f"{self.purpose} {self.total_paise / 100:.2f} ({self.status})"

    @property
    def payer_id(self) -> str | None:
        return self.school_id or self.parent_user_id


class PaymentEvent(models.Model):
    """Webhook idempotency ledger.

    Insert BEFORE processing: a redelivery collides with the unique index on
    (gateway, gateway_event_id) and is a no-op. `signature_verified` records
    whether the payload's signature checked out - a row with it False must
    never drive a state change.
    """

    class Status(models.TextChoices):
        RECEIVED = "received", "Received"
        PROCESSED = "processed", "Processed"
        IGNORED = "ignored", "Ignored"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True)
    gateway = models.TextField()
    gateway_event_id = models.TextField()
    event_type = models.TextField()
    signature_verified = models.BooleanField()
    payload = models.JSONField()
    payment = models.ForeignKey(
        Payment, models.DO_NOTHING, blank=True, null=True, related_name="events"
    )
    subscription = models.ForeignKey(
        Subscription, models.DO_NOTHING, blank=True, null=True, related_name="events"
    )
    status = models.TextField(choices=Status.choices)
    processing_error = models.TextField(blank=True, null=True)
    received_at = models.DateTimeField()
    processed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = "payment_events"
        unique_together = (("gateway", "gateway_event_id"),)

    def __str__(self) -> str:
        return f"{self.event_type} {self.gateway_event_id} ({self.status})"


class Invoice(models.Model):
    """A GST invoice. Immutable.

    A correction is a NEW row with `credit_note_for` pointing at the original,
    never an update. Two database constraints encode the GST rules:

      * `invoices_one_tax_shape` - either intra-state (igst = 0, cgst = sgst)
        or inter-state (igst > 0, cgst = sgst = 0). Never a mixture.
      * `invoices_total_adds_up` - total = taxable + cgst + sgst + igst.

    `gstin` must match the 15-character GSTIN format when present.
    """

    class Status(models.TextChoices):
        ISSUED = "issued", "Issued"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True)
    invoice_number = models.TextField(unique=True)
    payment = models.ForeignKey(Payment, models.DO_NOTHING, related_name="invoices")
    school = models.ForeignKey(
        "schools.School",
        models.DO_NOTHING,
        blank=True,
        null=True,
        related_name="invoices",
    )
    parent_user = models.ForeignKey(
        "accounts.User",
        models.DO_NOTHING,
        blank=True,
        null=True,
        related_name="invoices",
    )

    billing_name = models.TextField()
    billing_address = models.JSONField()
    gstin = models.TextField(blank=True, null=True)
    place_of_supply = models.TextField()
    sac_code = models.TextField()

    tax_rate_bps = models.IntegerField()  # basis points: 1800 = 18%
    taxable_paise = models.BigIntegerField()
    cgst_paise = models.BigIntegerField()
    sgst_paise = models.BigIntegerField()
    igst_paise = models.BigIntegerField()
    total_paise = models.BigIntegerField()

    invoice_date = models.DateField()
    pdf_path = models.TextField(blank=True, null=True)
    status = models.TextField(choices=Status.choices)
    credit_note_for = models.ForeignKey(
        "self",
        models.DO_NOTHING,
        db_column="credit_note_for",
        blank=True,
        null=True,
        related_name="credit_notes",
    )
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "invoices"

    def __str__(self) -> str:
        return self.invoice_number

    @property
    def is_inter_state(self) -> bool:
        return self.igst_paise > 0


class InvoiceCounter(models.Model):
    """Per-financial-year invoice sequence.

    GST numbering must be gapless and sequential within a financial year, so
    the next number comes from here under a row lock - never from
    `count(*) + 1`.
    """

    financial_year = models.TextField(primary_key=True)
    last_number = models.BigIntegerField()

    class Meta:
        managed = False
        db_table = "invoice_counters"

    def __str__(self) -> str:
        return f"{self.financial_year}: {self.last_number}"
