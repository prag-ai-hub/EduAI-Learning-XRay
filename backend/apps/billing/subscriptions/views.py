"""The billing surface: the catalogue, the two checkouts, and the history.

The capability on each view is read straight off the matrix
(docs/plan/01-ROLE-PERMISSION-MATRIX.md §2, "Payments"), and the shape it gives
is deliberately not a ladder:

  * `payment.b2b.checkout` - **SchoolAdmin alone.** Not SuperAdmin, who may
    manage a school but may not spend its money, and emphatically not Teacher.
  * `payment.b2c.checkout` - **Parent alone.** A SchoolAdmin cannot buy a
    parent's credits, and a parent cannot subscribe a school.
  * `payment.history.read` - SuperAdmin (all), SchoolAdmin (own school), Parent
    (own). Teacher holds none of these and is refused before any question of
    rows arises.

What is **not** here, on purpose: the webhook. Nothing on this surface marks a
payment captured, because a client callback is not evidence that money moved -
only a signature-verified webhook is (payment data model §1.2). Every endpoint
below leaves a payment in `created` and stops.
"""

from __future__ import annotations

from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.capabilities import Capability
from apps.accounts.permissions import requires
from apps.accounts.roles import PARENT, SCHOOL_ADMIN
from apps.common.pagination import DefaultPagination
from apps.common.viewsets import ReadOnlyPlatformViewSet, ReadOnlyTenantScopedViewSet
from apps.tenants.schools.tenancy import SuperAdminScope, require_school_scope

from . import entitlements, gateway, services
from .models import Payment, Plan
from .serializers import (
    EntitlementSerializer,
    PaymentSerializer,
    PlanSerializer,
    SubscriptionCheckoutSerializer,
    SubscriptionSerializer,
    TopupCheckoutSerializer,
)


class PlanViewSet(ReadOnlyPlatformViewSet):
    """GET /api/v1/billing/plans/ - the catalogue, narrowed to the caller.

    Gated on `payment.history.read` rather than a capability of its own, and
    that is a compromise worth naming. The matrix has no "read the catalogue"
    cell: `platform.plans.manage` is SuperAdmin-only and describes editing, while
    the two checkout capabilities cannot both gate one view because
    `HasCapability` requires *every* declared capability, not any of them. The
    billing-read capability is held by exactly the three roles that have business
    at a checkout and by no Teacher, which is the line the matrix actually draws.
    A dedicated `payment.plans.read` belongs in capabilities.py; see the handover
    note in the result of this work.

    Archived plans are excluded. They are kept so that an old subscription can
    still resolve its plan for invoice history years later - never so that they
    can still be bought.
    """

    queryset = Plan.objects.filter(status=Plan.Status.ACTIVE).order_by("sort_order", "code")
    serializer_class = PlanSerializer
    pagination_class = DefaultPagination
    required_capabilities = frozenset({Capability.PAYMENT_HISTORY_READ})
    throttle_scope = "user"

    def get_queryset(self):
        queryset = super().get_queryset()
        role = getattr(self.request.user, "role", None)
        # A parent must never be shown a school plan and vice versa. The audience
        # is enforced again in services._resolve_plan, because hiding a row is
        # not the same as refusing to sell it.
        if role == SCHOOL_ADMIN:
            return queryset.filter(audience=Plan.Audience.SCHOOL)
        if role == PARENT:
            return queryset.filter(audience=Plan.Audience.PARENT)
        return queryset  # SuperAdmin: the whole catalogue, to support both sides


class PaymentHistoryViewSet(ReadOnlyTenantScopedViewSet):
    """GET /api/v1/billing/payments/ - what this payer has been charged.

    Read-only, and there is no write path at all. A payment's status is the
    gateway's to decide.

    The parent branch is written out rather than left to `TenantScopedQuerySetMixin`.
    The mixin reaches a parent's rows through `parent_student_links`, because
    everything else a parent may see belongs to a child; a payment belongs to the
    parent directly and has no student on it. Left to the mixin, `parent_link_field`
    being unset would correctly return nothing - correct, and useless.
    """

    queryset = Payment.objects.select_related("plan").all()
    serializer_class = PaymentSerializer
    pagination_class = DefaultPagination
    required_capabilities = frozenset({Capability.PAYMENT_HISTORY_READ})
    throttle_scope = "user"

    tenant_field = "school_id"
    # Matrix: SuperAdmin is "✔ all" for payment history, unlike the school
    # administration rows beside it. Defensible only because `PaymentSerializer`
    # returns no billing name, address or GSTIN - the identifiable part of a
    # payment stays in `notes`, which the serializer does not expose.
    super_admin_scope = SuperAdminScope.ALL

    def get_queryset(self):
        principal = self.request.user
        if getattr(principal, "is_parent", False):
            return (
                Payment.objects.select_related("plan")
                .filter(parent_user_id=principal.id)
                .order_by("-created_at")
            )
        return super().get_queryset().order_by("-created_at")


class SubscriptionView(APIView):
    """GET /api/v1/billing/subscription - the school's subscription and entitlement.

    Both, in one response, because they answer different questions and a client
    needs both to decide what to show: the subscription is the contract, the
    entitlement is whether it currently permits anything. A `past_due`
    subscription past its grace window is still a subscription and no longer an
    entitlement.

    A SuperAdmin has no school of their own and may name one with `?school=`,
    which goes through `require_school_scope` - so it needs a live support grant
    and the read is audited, exactly as §4 requires.
    """

    permission_classes = [requires(Capability.SCHOOL_SUBSCRIPTION_MANAGE)]
    throttle_scope = "user"

    def get(self, request):
        school_id = self._school_id(request)
        subscription = services.live_subscription(school_id)
        entitlement = entitlements.for_school(school_id)
        return Response(
            {
                "school_id": school_id,
                "subscription": SubscriptionSerializer(subscription).data if subscription else None,
                "entitlement": EntitlementSerializer(entitlement).data,
            }
        )

    def _school_id(self, request) -> str:
        requested = (request.query_params.get("school") or "").strip()
        school_id = requested or getattr(request.user, "school_id", None)
        if not school_id:
            raise ValidationError({"school": "Name the school to look at."})
        # Also covers a SchoolAdmin naming somebody else's school: the same call
        # refuses it, rather than a second rule that could drift from this one.
        require_school_scope(request.user, school_id)
        return school_id


class SubscriptionCancelView(APIView):
    """POST /api/v1/billing/subscription/cancel - stop renewing at the period end.

    Only at the period end. See `services.cancel_at_period_end` for why an
    immediate cancellation is not on offer.
    """

    permission_classes = [requires(Capability.SCHOOL_SUBSCRIPTION_MANAGE)]
    throttle_scope = "user"

    def post(self, request):
        subscription = services.cancel_at_period_end(principal=request.user)
        return Response(SubscriptionSerializer(subscription).data)


class _CheckoutView(APIView):
    """Shared response shape for both checkouts.

    Subclasses supply the capability, the serializer and the service call.
    """

    throttle_scope = "checkout"
    serializer_class: type
    start = staticmethod(lambda **kwargs: None)

    def post(self, request):
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        checkout = self.start(
            principal=request.user,
            plan_code=data["plan_code"],
            billing=data["billing"],
            idempotency_key=data.get("idempotency_key") or None,
        )
        payment = checkout.payment
        return Response(
            {
                "payment_id": str(payment.id),
                "gateway": payment.gateway,
                # The publishable key id, which the browser's checkout script
                # needs to identify the merchant. The secret half stays in this
                # process - see gateway.public_key_id.
                "gateway_key_id": gateway.public_key_id(),
                "order_id": payment.gateway_order_id,
                "amount_paise": payment.amount_paise,
                "tax_paise": payment.tax_paise,
                "total_paise": payment.total_paise,
                "currency": payment.currency,
                "purpose": payment.purpose,
                "plan": PlanSerializer(checkout.plan).data,
                "change": checkout.change,
                # True when this is the second click on one button: the same
                # order, not a new one. Worth returning rather than hiding, so a
                # client can tell "already open" from "just created".
                "reused": checkout.reused,
            }
        )


class SubscriptionCheckoutView(_CheckoutView):
    """POST /api/v1/billing/checkout/subscription - B2B. SchoolAdmin only."""

    permission_classes = [requires(Capability.PAYMENT_B2B_CHECKOUT)]
    serializer_class = SubscriptionCheckoutSerializer
    start = staticmethod(services.start_school_checkout)


class TopupCheckoutView(_CheckoutView):
    """POST /api/v1/billing/checkout/topup - B2C. Parent only.

    Creates an order and nothing else. No credit is added here; that happens
    only against a captured payment, in `services.grant_topup_credits`.
    """

    permission_classes = [requires(Capability.PAYMENT_B2C_CHECKOUT)]
    serializer_class = TopupCheckoutSerializer
    start = staticmethod(services.start_parent_topup)


__all__ = [
    "PaymentHistoryViewSet",
    "PlanViewSet",
    "SubscriptionCancelView",
    "SubscriptionCheckoutView",
    "SubscriptionView",
    "TopupCheckoutView",
]
