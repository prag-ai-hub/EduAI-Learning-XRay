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

import re

from django.http import HttpResponse
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.capabilities import Capability
from apps.accounts.permissions import requires
from apps.accounts.roles import PARENT, SCHOOL_ADMIN
from apps.common.pagination import DefaultPagination
from apps.common.viewsets import ReadOnlyPlatformViewSet, ReadOnlyTenantScopedViewSet
from apps.platform.audit.services import record
from apps.tenants.schools.tenancy import SuperAdminScope, require_school_scope

from . import entitlements, gateway, pdf, services
from .invoices import InvoiceAction
from .models import Invoice, Payment, Plan
from .serializers import (
    EntitlementSerializer,
    InvoiceSerializer,
    PaymentSerializer,
    PlanSerializer,
    ReceiptSerializer,
    SubscriptionCheckoutSerializer,
    SubscriptionSerializer,
    TopupCheckoutSerializer,
)

#: An invoice number contains slashes. A filename must not.
FILENAME_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


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


class _PayerScopedViewSet(ReadOnlyTenantScopedViewSet):
    """Billing rows the caller may see, for tables that carry their own payer.

    Three surfaces share this - payments, receipts and invoices - and the
    scoping is NOT uniform across roles, which is exactly why it is written
    once here rather than three times:

      * **A parent** is reached through the payer column on the row itself. The
        mixin would reach them through `parent_student_links`, because
        everything else a parent may see belongs to a child; a payment belongs
        to the parent directly and has no student on it. Left to the mixin,
        `parent_link_field` being unset would correctly return nothing -
        correct, and useless.
      * **A SuperAdmin** must NAME the school. `require_school_scope` is what
        checks the support grant and writes the audit row, so routing through
        it is what makes this read leave a trace at all - the tenancy mixin
        filters silently. An earlier version of the payments endpoint cited the
        matrix's "✔ all" row and read every tenant's billing data ungated and
        unaudited; that was the only cross-tenant read in this service that
        left nothing behind.
      * **Everyone else** is their own school, via the mixin.

    GRANTED, not ALL. The matrix has two rows that look like they answer this
    and only one of them does: "View own payment history" is ✔ all for a
    SuperAdmin (§Payments), but reading somebody else's school is "View school
    payment history & invoices", which is ◐.
    """

    tenant_field = "school_id"
    super_admin_scope = SuperAdminScope.GRANTED

    #: The payer column for a parent. Same name on `payments` and `invoices`.
    parent_field = "parent_user_id"
    ordering: tuple[str, ...] = ("-created_at",)
    #: What a SuperAdmin is told when they name no school.
    scope_prompt = "Name the school whose billing records you are reading."

    def get_queryset(self):
        principal = self.request.user
        if getattr(principal, "is_parent", False):
            return self._rows().filter(**{self.parent_field: principal.id})
        if getattr(principal, "is_super_admin", False):
            requested = (self.request.query_params.get("school") or "").strip()
            if not requested:
                raise ValidationError({"school": self.scope_prompt})
            require_school_scope(principal, requested)
            return self._rows().filter(school_id=requested)
        return super().get_queryset().order_by(*self.ordering)

    def _rows(self):
        return self.queryset.order_by(*self.ordering)


class PaymentHistoryViewSet(_PayerScopedViewSet):
    """GET /api/v1/billing/payments/ - what this payer has been charged.

    Read-only, and there is no write path at all. A payment's status is the
    gateway's to decide.
    """

    queryset = Payment.objects.select_related("plan").all()
    serializer_class = PaymentSerializer
    pagination_class = DefaultPagination
    required_capabilities = frozenset({Capability.PAYMENT_HISTORY_READ})
    throttle_scope = "user"
    scope_prompt = "Name the school whose payments you are reading."


class ReceiptViewSet(_PayerScopedViewSet):
    """GET /api/v1/billing/receipts/ - proof that money was taken (day 17.1).

    Payment history narrowed to what actually settled, with the invoice number
    joined on. Not a rename of `payments/`: that endpoint answers "what has been
    attempted on this account", including the orders that failed and the ones
    still open, and a customer looking for a receipt should not have to sift
    them. A `created` order is not a receipt of anything.
    """

    queryset = (
        Payment.objects.filter(status__in=Payment.SETTLED_STATUSES)
        .select_related("plan")
        .prefetch_related("invoices")
        .all()
    )
    serializer_class = ReceiptSerializer
    pagination_class = DefaultPagination
    required_capabilities = frozenset({Capability.PAYMENT_HISTORY_READ})
    throttle_scope = "user"
    ordering = ("-captured_at", "-created_at")
    scope_prompt = "Name the school whose receipts you are reading."


class InvoiceViewSet(_PayerScopedViewSet):
    """GET /api/v1/billing/invoices/ and .../<id>/pdf - GST invoices (day 17.2).

    Two capabilities, and they are genuinely different questions. Listing is
    `payment.history.read`; taking away the document is
    `payment.invoice.download`, which is the matrix's own separate cell. Every
    role that holds one currently holds the other, and declaring them
    separately anyway is what makes it possible to withdraw one later without
    finding out that the code never distinguished them.

    Ordered by invoice date rather than creation: a document is filed by the
    date printed on it.
    """

    queryset = Invoice.objects.select_related("payment", "payment__plan", "credit_note_for").all()
    serializer_class = InvoiceSerializer
    pagination_class = DefaultPagination
    required_capabilities = frozenset({Capability.PAYMENT_HISTORY_READ})
    capability_map = {"pdf": Capability.PAYMENT_INVOICE_DOWNLOAD}
    throttle_scope = "user"
    ordering = ("-invoice_date", "-created_at")
    scope_prompt = "Name the school whose invoices you are reading."

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        """The invoice as a PDF, rendered from the row on demand.

        Nothing is stored - see `pdf.py` for why - so this is the only way to
        obtain the document, and the download is audited. `get_object` runs the
        scoping above first, so a cross-tenant download has already had its
        support grant checked and its access recorded before a byte is drawn.
        """
        invoice = self.get_object()
        body = pdf.render_invoice(invoice)

        record(
            action=InvoiceAction.DOWNLOADED,
            school_id=invoice.school_id or services.PLATFORM_SCOPE,
            actor_id=request.user.id,
            entity_type="invoice",
            entity_id=str(invoice.id),
            detail={"invoiceNumber": invoice.invoice_number},
        )

        response = HttpResponse(body, content_type="application/pdf")
        filename = FILENAME_UNSAFE.sub("-", invoice.invoice_number)
        response["Content-Disposition"] = f'attachment; filename="{filename}.pdf"'
        return response


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
    "InvoiceViewSet",
    "PaymentHistoryViewSet",
    "PlanViewSet",
    "ReceiptViewSet",
    "SubscriptionCancelView",
    "SubscriptionCheckoutView",
    "SubscriptionView",
    "TopupCheckoutView",
]
