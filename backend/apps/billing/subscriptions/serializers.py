"""Request and response shapes for the billing surface.

Everything inherits the strict, sanitising bases from apps/common/serializers.py,
so an unrecognised key is a 400 rather than a silent no-op. That matters more at
checkout than almost anywhere else: a client that misspells `plan_code` and is
told nothing has just charged someone for the wrong plan.

Note what the request shapes deliberately do **not** accept: an amount. Prices
come from the plan row, and a caller that could name its own amount could buy a
Premium subscription for one paisa. The same rule as the AI proxy refusing to
let a caller name the model, for the same reason - the money is not theirs to
decide.
"""

from __future__ import annotations

import re

from rest_framework import serializers

from apps.common.serializers import BaseModelSerializer, BaseSerializer
from apps.common.validators import BoundedDictField

from .models import Payment, Plan, Subscription

#: `plans.code` is `^[a-z0-9_]{3,60}$` in the database. Validated here so a
#: malformed code is a 400 naming the field, not a lookup that finds nothing.
PLAN_CODE = re.compile(r"^[a-z0-9_]{3,60}$")

#: The GSTIN format the `invoices.gstin` check constraint enforces. Rejecting it
#: here rather than at invoice time matters: the invoice is written by a webhook
#: after the money has been taken, and a constraint violation there means a paid
#: customer with no invoice and nobody watching.
GSTIN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$")

#: GST state codes are two digits, and they are the first two characters of
#: every GSTIN. Which code applies to a given address is the buyer's own
#: declaration; this only checks the shape.
STATE_CODE = re.compile(r"^[0-9]{2}$")


class PlanSerializer(BaseModelSerializer):
    """A plan as shown on a pricing page. Read-only.

    Amounts stay in paise, undivided. Formatting money is a presentation
    decision and a float-shaped trap; the client divides by 100 once, where it
    renders.

    `gateway_plan_id` is absent deliberately - it is an identifier in someone
    else's dashboard and tells a browser nothing it can use.
    """

    class Meta:
        model = Plan
        fields = [
            "id",
            "code",
            "name",
            "description",
            "audience",
            "billing_period",
            "amount_paise",
            "currency",
            "credits_included",
            "max_teachers",
            "max_students",
            "features",
            "sort_order",
        ]
        read_only_fields = fields


class SubscriptionSerializer(BaseModelSerializer):
    """A school's subscription. Read-only: it moves by payment, never by PATCH."""

    plan = PlanSerializer(read_only=True)

    class Meta:
        model = Subscription
        fields = [
            "id",
            "plan",
            "status",
            "current_period_start",
            "current_period_end",
            "grace_until",
            "cancel_at_period_end",
            "started_at",
            "cancelled_at",
            "ended_at",
        ]
        read_only_fields = fields


class PaymentSerializer(BaseModelSerializer):
    """One row of payment history.

    `notes` is not exposed. It carries the billing snapshot taken at checkout -
    a name, a postal address, a GSTIN - which is the invoice's business and not
    something a payment list needs to hand out, least of all on the SuperAdmin's
    cross-tenant view of this endpoint.

    `idempotency_key` is also absent: it is a key a client presents to claim an
    existing payment, so publishing other people's is publishing a handle onto
    their checkout.
    """

    plan_code = serializers.CharField(source="plan.code", read_only=True, default=None)
    plan_name = serializers.CharField(source="plan.name", read_only=True, default=None)

    class Meta:
        model = Payment
        fields = [
            "id",
            "purpose",
            "status",
            "plan_code",
            "plan_name",
            "amount_paise",
            "tax_paise",
            "total_paise",
            "currency",
            "method",
            "gateway_order_id",
            "gateway_payment_id",
            "failure_reason",
            "captured_at",
            "refunded_at",
            "created_at",
        ]
        read_only_fields = fields


class BillingDetailsSerializer(BaseSerializer):
    """Who the invoice is made out to, captured at checkout.

    Taken now rather than read off the school row when the invoice is issued,
    because an invoice must show the details as they stood at the sale. A school
    that moves in March should not find last year's invoice reprinted with this
    year's address.

    `place_of_supply` is what decides CGST+SGST versus IGST. It is the buyer's
    declaration, which is why it is a field here and not something inferred from
    a city name.
    """

    #: The invoice is rendered onto a page, so line breaks and direction marks in
    #: a name are the base serializer's problem - and it already refuses them.
    billing_name = serializers.CharField(max_length=200)
    #: Free-form because Indian addresses are. Bounded by the base serializer's
    #: JSON shape check, and each value is sanitised like any other string.
    billing_address = BoundedDictField(
        child=serializers.CharField(allow_blank=True, max_length=300),
        max_keys=12,
        max_key_length=40,
        required=False,
        default=dict,
    )
    gstin = serializers.CharField(required=False, allow_blank=True, max_length=15)
    place_of_supply = serializers.CharField(max_length=2)

    def validate_place_of_supply(self, value: str) -> str:
        if not STATE_CODE.match(value):
            raise serializers.ValidationError("Use the two-digit GST state code, e.g. 27.")
        return value

    def validate_gstin(self, value: str) -> str:
        value = (value or "").upper()
        if value and not GSTIN.match(value):
            raise serializers.ValidationError("That is not a valid 15-character GSTIN.")
        return value

    def validate(self, attrs: dict) -> dict:
        # The first two digits of a GSTIN *are* the state code. A mismatch means
        # one of the two is wrong, and finding out which at invoice time - after
        # the charge - is finding out too late.
        gstin = attrs.get("gstin") or ""
        if gstin and gstin[:2] != attrs["place_of_supply"]:
            raise serializers.ValidationError(
                {"place_of_supply": "This does not match the state code in the GSTIN."}
            )
        return attrs


class _CheckoutSerializer(BaseSerializer):
    """Fields common to both checkouts."""

    plan_code = serializers.CharField(max_length=60)
    billing = BillingDetailsSerializer()
    #: Optional, and the strongest form of the idempotency guarantee when sent:
    #: re-sending it returns the first answer rather than a second order. A
    #: client that omits it is still protected, by the reuse window in
    #: services.py - see that module's docstring.
    idempotency_key = serializers.CharField(required=False, allow_blank=True, max_length=64)

    def validate_plan_code(self, value: str) -> str:
        if not PLAN_CODE.match(value):
            raise serializers.ValidationError("That is not a plan code.")
        return value


class SubscriptionCheckoutSerializer(_CheckoutSerializer):
    """B2B: subscribe, upgrade or downgrade. SchoolAdmin only."""


class TopupCheckoutSerializer(_CheckoutSerializer):
    """B2C: a parent buys report credits. Parent only."""


class EntitlementSerializer(BaseSerializer):
    """`entitlements.Entitlement`, flattened for the wire.

    A plain serializer over a frozen dataclass rather than a model serializer:
    the entitlement is computed by a SQL function and is not a row.
    """

    has_entitlement = serializers.BooleanField()
    status = serializers.CharField()
    plan_code = serializers.CharField(allow_null=True)
    plan_name = serializers.CharField(allow_null=True)
    features = serializers.DictField()
    credits_included = serializers.IntegerField()
    period_end = serializers.DateTimeField(allow_null=True)
    grace_until = serializers.DateTimeField(allow_null=True)


__all__ = [
    "GSTIN",
    "PLAN_CODE",
    "STATE_CODE",
    "BillingDetailsSerializer",
    "EntitlementSerializer",
    "PaymentSerializer",
    "PlanSerializer",
    "SubscriptionCheckoutSerializer",
    "SubscriptionSerializer",
    "TopupCheckoutSerializer",
]
