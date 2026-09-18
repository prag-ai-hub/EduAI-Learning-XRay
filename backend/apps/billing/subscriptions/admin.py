"""Billing in the back office.

The split here is the important part. A **plan** is a price list and is editable
- carefully, and `seed_plans` remains the reviewed way to change one. A
**payment** or an **invoice** is a record of something that already happened at
the gateway or was issued to a customer; editing one does not change what
happened, it only makes the two disagree, with the gateway right and the invoice
legally fixed.
"""

from __future__ import annotations

from django.contrib import admin

from apps.common.admin import AuditedAdmin, ReadOnlyAdmin

from .models import Invoice, Payment, Plan, Subscription


@admin.register(Plan)
class PlanAdmin(AuditedAdmin):
    list_display = (
        "code",
        "name",
        "audience",
        "billing_period",
        "amount_paise",
        "credits_included",
        "max_students",
        "status",
        "sort_order",
    )
    list_filter = ("audience", "status", "billing_period")
    search_fields = ("code", "name")
    ordering = ("sort_order", "code")
    readonly_fields = ("id", "created_at", "updated_at")

    #: Re-pricing a plan anyone holds changes what they are charged at renewal,
    #: what they receive, and the text of invoices already issued. `seed_plans`
    #: refuses that and names the fields; this cannot, so the warning is here.
    def get_form(self, request, obj=None, change=False, **kwargs):
        form = super().get_form(request, obj, change, **kwargs)
        if "amount_paise" in form.base_fields:
            form.base_fields["amount_paise"].help_text = (
                "Re-pricing a plan somebody already holds changes their renewal and the "
                "line text on invoices already issued. Add a new plan code and archive "
                "this one instead - see docs/PRICING.md."
            )
        return form


@admin.register(Subscription)
class SubscriptionAdmin(AuditedAdmin):
    list_display = (
        "school",
        "plan",
        "status",
        "current_period_end",
        "cancel_at_period_end",
        "grace_until",
    )
    list_filter = ("status", "cancel_at_period_end")
    search_fields = ("school__name", "plan__code")
    ordering = ("-created_at",)
    raw_id_fields = ("school", "plan")
    readonly_fields = ("id", "created_at", "updated_at", "started_at")


@admin.register(Payment)
class PaymentAdmin(ReadOnlyAdmin):
    list_display = (
        "created_at",
        "purpose",
        "status",
        "total_paise",
        "school",
        "plan",
        "gateway_order_id",
    )
    list_filter = ("status", "purpose")
    search_fields = ("id", "gateway_order_id", "gateway_payment_id", "school__name")
    ordering = ("-created_at",)


@admin.register(Invoice)
class InvoiceAdmin(ReadOnlyAdmin):
    """An issued GST invoice. Its numbering is gapless by law and by index."""

    list_display = ("invoice_number", "invoice_date", "billing_name", "total_paise", "status")
    list_filter = ("status",)
    search_fields = ("invoice_number", "billing_name", "gstin")
    ordering = ("-invoice_date", "-invoice_number")
