"""Issuing GST invoices: the number series, the tax split, and corrections.

This is the other half of `services.py`. Services decides what to *charge*;
this decides what to *say we charged*, on a document a tax authority may read
back years later. The two share one arithmetic implementation - `tax_paise`
lives there and is imported here - because a tax figure computed twice by two
files is a tax figure that eventually disagrees with itself.

--------------------------------------------------------------------------
THE NUMBER SERIES
--------------------------------------------------------------------------
GST numbering must be sequential, gapless, scoped to a financial year and at
most 16 characters. `EDU/25-26/000001` is exactly 16, which is why the serial
is capped at six digits rather than allowed to widen.

The allocator is `public.next_invoice_number`, written by M10, not a second one
in Python. That is deliberate: two allocators over one counter is precisely how
a duplicate number is produced, and the SQL one is already the schema's own -
its `insert … on conflict do update` takes the counter row's lock and holds it
until the caller's transaction commits, so a concurrent issue blocks rather
than races, and a rollback takes the number back with it. `financial_year()`
below re-derives the year independently and `_allocate` refuses a number that
disagrees with it, so a future migration that changed the SQL would fail here,
loudly, before the number reached a document.

--------------------------------------------------------------------------
WHERE THE NUMBERS COME FROM
--------------------------------------------------------------------------
The rate is read from `payment.notes["taxRateBps"]` - the rate *actually
charged at checkout* - and never from settings, because settings hold today's
rate and an invoice states a historical fact. It is then checked against the
tax the payment recorded; a disagreement means the snapshot is lying about the
sale and issuing stops rather than papering over it.

Everything a renderer needs afterwards is on the invoice row, so a rate change
cannot rewrite history. See `pdf.py`, which reads settings for exactly one
thing: the seller's own identity, which has no column.

--------------------------------------------------------------------------
IMMUTABILITY
--------------------------------------------------------------------------
Nothing in this module updates an invoice. A correction is `issue_credit_note`,
which writes a NEW row carrying `credit_note_for` and its own number from the
same series. The original is left exactly as issued, including its status: a
document that has been sent to a customer cannot be un-sent by an UPDATE.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import date

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

from apps.platform.audit.services import record

from .models import Invoice, Payment
from .services import (
    PLATFORM_SCOPE,
    PaymentNotSettled,
    PaymentsNotConfigured,
    require_tax_settings,
    tax_paise,
)

logger = logging.getLogger(__name__)

#: India's financial year runs 1 April to 31 March. A March invoice belongs to
#: the year that started the previous April, which is the whole reason
#: `financial_year` exists rather than `invoice_date.year`.
FINANCIAL_YEAR_START_MONTH = 4

#: `EDU/25-26/000001`. Sixteen characters exactly - the GST maximum - which is
#: why `SERIAL_CEILING` is what it is.
NUMBER_FORMAT = re.compile(r"^EDU/(\d{2}-\d{2})/(\d{6})$")
SERIAL_CEILING = 999_999


class InvoiceAction:
    """Audit action names for the invoice surface.

    Declared here rather than in `apps.platform.audit.services.Action` for the
    same reason as `services.BillingAction`: that module is outside this
    package's ownership. They belong there.
    """

    ISSUED = "invoice.issued"
    CREDIT_NOTE_ISSUED = "invoice.credit_note_issued"
    DOWNLOADED = "invoice.downloaded"


class InvoiceNumberExhausted(Exception):
    """A financial year ran past six digits.

    Widening the serial would push the number past the 16-character GST limit,
    so this is a decision for whoever owns the numbering scheme, not something
    to solve by silently printing a 17-character number.
    """


# ---------------------------------------------------------------------------
# The number series
# ---------------------------------------------------------------------------


def financial_year(on: date) -> str:
    """The Indian financial year containing `on`, as `25-26`.

    Derived here as well as in SQL on purpose - see the module docstring. The
    two are compared on every allocation.
    """
    start = on.year if on.month >= FINANCIAL_YEAR_START_MONTH else on.year - 1
    return f"{start % 100:02d}-{(start + 1) % 100:02d}"


def allocate_invoice_number(on: date) -> str:
    """Take the next number in `on`'s financial year. Call inside a transaction.

    The caller's transaction is what makes the series gapless: the number is
    consumed and the invoice row is written together, so there is no window in
    which a number exists without the document it belongs to.
    """
    with connection.cursor() as cursor:
        cursor.execute("select public.next_invoice_number(%s)", [on])
        number = cursor.fetchone()[0]

    match = NUMBER_FORMAT.match(number or "")
    if match is None:
        # The allocator changed shape underneath us. Refusing rolls the number
        # back with the transaction; printing it would put a malformed series
        # on a tax document.
        raise InvoiceNumberExhausted(f"Allocator returned an unusable number: {number!r}")
    year, serial = match.groups()
    if year != financial_year(on):
        raise InvoiceNumberExhausted(
            f"Allocator put {on.isoformat()} in financial year {year}, not {financial_year(on)}."
        )
    if int(serial) > SERIAL_CEILING:
        raise InvoiceNumberExhausted(f"Financial year {year} has run out of six-digit serials.")
    return number


# ---------------------------------------------------------------------------
# What the seller must have said before anything can be issued
# ---------------------------------------------------------------------------


def require_seller_identity() -> str:
    """The seller's own GSTIN, or a 503.

    Checked at *issue* time and not only at render time, so a missing GSTIN
    fails at the seam a webhook can retry rather than leaving a row on the
    books that nobody can turn into a document.
    """
    gstin = (settings.GST_SELLER_GSTIN or "").strip()
    if not gstin:
        logger.error("invoice refused: GST_SELLER_GSTIN is unset")
        raise PaymentsNotConfigured()
    return gstin


def _charged_rate_bps(payment: Payment) -> int:
    """The rate this payment was actually charged at.

    From the payment's own snapshot, never from settings. An invoice states
    what happened; settings state what would happen today, and printing today's
    rate on last year's sale is the failure this whole module is arranged to
    avoid.
    """
    raw = (payment.notes or {}).get("taxRateBps")
    if raw is None:
        raise PaymentNotSettled(
            f"Payment {payment.id} has no taxRateBps snapshot; the rate it was "
            "charged at is unknown and must not be guessed from settings."
        )
    rate_bps = int(raw)
    if tax_paise(payment.amount_paise, rate_bps) != payment.tax_paise:
        # The snapshot and the money disagree. One of them is wrong and this is
        # not the place to decide which.
        raise PaymentNotSettled(
            f"Payment {payment.id} recorded {payment.tax_paise} paise of tax, "
            f"which is not {rate_bps} bps of {payment.amount_paise}."
        )
    return rate_bps


def _billing_snapshot(payment: Payment) -> dict:
    """Who the invoice is made out to, as given at checkout.

    Not re-read from the school row: a school that moves in March must not find
    last year's invoice reprinted with this year's address.
    """
    billing = (payment.notes or {}).get("billing") or {}
    name = (billing.get("billing_name") or "").strip()
    place = (billing.get("place_of_supply") or "").strip()
    if not name or not place:
        raise PaymentNotSettled(
            f"Payment {payment.id} carries no billing snapshot; there is nobody "
            "to make the invoice out to and no place of supply to tax it in."
        )
    return billing


# ---------------------------------------------------------------------------
# The tax split
# ---------------------------------------------------------------------------


def split_for(taxable_paise: int, rate_bps: int, *, place_of_supply: str) -> dict:
    """CGST+SGST or IGST, decided by the place of supply. Thin wrapper, on purpose.

    `services.gst_split` is the implementation; this exists so that the invoice
    package has one import for it and so the shape is documented where an
    invoice is written. Intra-state halves are equal because `tax_paise` always
    returns an even figure - `invoices_one_tax_shape` requires exactly that.
    """
    from .services import gst_split

    return gst_split(taxable_paise, rate_bps, place_of_supply=place_of_supply)


def split_like(invoice: Invoice, taxable_paise: int) -> dict:
    """The same tax shape as an existing invoice, at that invoice's own rate.

    Used for credit notes. Reading the shape off the *row* rather than
    recomputing it from settings is the point: if the seller's registered state
    changes, a credit note against an old intra-state invoice must still be
    intra-state, or the correction will not net off against the thing it
    corrects.
    """
    total = tax_paise(taxable_paise, invoice.tax_rate_bps)
    if invoice.is_inter_state:
        return {"cgst_paise": 0, "sgst_paise": 0, "igst_paise": total}
    half = total // 2  # exact: tax_paise always returns an even number
    return {"cgst_paise": half, "sgst_paise": half, "igst_paise": 0}


# ---------------------------------------------------------------------------
# Issuing
# ---------------------------------------------------------------------------


def issue_for_payment(payment: Payment, *, on: date | None = None) -> Invoice:
    """The tax invoice for a captured payment. Idempotent.

    Idempotency is the existing invoice for this payment: a webhook redelivery
    returns it rather than burning a second number on the same sale, and gaps
    in a GST series are a compliance failure rather than a cosmetic one. The
    check runs under a row lock on the payment, the same lock
    `services.activate_subscription` takes, so two simultaneous deliveries
    cannot both find nothing.
    """
    with transaction.atomic():
        # `of=("self",)`: `plan` is a nullable FK, so `select_related` makes it
        # a LEFT OUTER JOIN and Postgres refuses FOR UPDATE on the nullable
        # side. Only the payment row needs locking in any case.
        payment = (
            Payment.objects.select_for_update(of=("self",))
            .select_related("plan")
            .get(pk=payment.pk)
        )
        # Idempotency first, then the gate. An invoice that already exists is
        # returned whatever the payment has become since: a webhook redelivered
        # after a refund would otherwise raise PaymentNotSettled for a payment
        # that is genuinely, correctly invoiced.
        existing = (
            Invoice.objects.filter(payment=payment, credit_note_for__isnull=True)
            .order_by("created_at")
            .first()
        )
        if existing is not None:
            return existing

        if payment.status not in Payment.SETTLED_STATUSES:
            raise PaymentNotSettled(
                f"Payment {payment.id} is {payment.status}; nothing is invoiced before capture."
            )

        # Refuses when the rate, the seller's state or the SAC code is unset.
        # The returned rate is discarded: what this payment was charged is a
        # fact on the payment, not a setting.
        require_tax_settings()
        require_seller_identity()

        rate_bps = _charged_rate_bps(payment)
        billing = _billing_snapshot(payment)
        place_of_supply = billing["place_of_supply"]
        taxable = payment.amount_paise
        split = split_for(taxable, rate_bps, place_of_supply=place_of_supply)
        total = taxable + sum(split.values())
        if total != payment.total_paise:
            raise PaymentNotSettled(
                f"Payment {payment.id} took {payment.total_paise} paise but the "
                f"invoice would total {total}."
            )

        invoice = _write(
            payment=payment,
            number_on=on or timezone.localdate(),
            billing=billing,
            place_of_supply=place_of_supply,
            rate_bps=rate_bps,
            taxable=taxable,
            split=split,
            credit_note_for=None,
        )

    record(
        action=InvoiceAction.ISSUED,
        school_id=payment.school_id or PLATFORM_SCOPE,
        actor_id=None,  # issued against a gateway capture; no human actor
        entity_type="invoice",
        entity_id=str(invoice.id),
        detail={
            "invoiceNumber": invoice.invoice_number,
            "paymentId": str(payment.id),
            "totalPaise": invoice.total_paise,
            "taxRateBps": invoice.tax_rate_bps,
            "placeOfSupply": invoice.place_of_supply,
            "interState": invoice.is_inter_state,
        },
    )
    return invoice


def issue_credit_note(invoice: Invoice, *, on: date | None = None, actor_id=None) -> Invoice:
    """Reverse an invoice with a new row. Idempotent. The original is untouched.

    A full reversal only. Partial credit notes are not built, because how much
    of a sale to credit is a commercial decision and there is no refund path in
    this service to pay one out with - the same reasoning that keeps proration
    out of `services.py`.

    The amounts are positive because `invoices` checks every money column is
    `>= 0`. What makes this a credit rather than a second charge is
    `credit_note_for`, and every reader must treat it that way.
    """
    if invoice.credit_note_for_id is not None:
        raise PaymentNotSettled(
            f"Invoice {invoice.invoice_number} is itself a credit note; there is "
            "nothing to correct."
        )

    with transaction.atomic():
        # Lock the payment, not the invoice: it is the payment that both this
        # and `issue_for_payment` serialise on, so a capture and a correction
        # arriving together cannot interleave.
        payment = Payment.objects.select_for_update(of=("self",)).get(pk=invoice.payment_id)

        existing = Invoice.objects.filter(credit_note_for=invoice).order_by("created_at").first()
        if existing is not None:
            return existing

        note = _write(
            payment=payment,
            number_on=on or timezone.localdate(),
            billing={
                "billing_name": invoice.billing_name,
                "billing_address": invoice.billing_address,
                "gstin": invoice.gstin,
            },
            # Every figure below comes off the ROW being corrected, never from
            # settings: a credit note has to net off against the document it
            # names, whatever the current rate or seller state happens to be.
            place_of_supply=invoice.place_of_supply,
            rate_bps=invoice.tax_rate_bps,
            taxable=invoice.taxable_paise,
            split=split_like(invoice, invoice.taxable_paise),
            sac_code=invoice.sac_code,
            credit_note_for=invoice,
        )

    record(
        action=InvoiceAction.CREDIT_NOTE_ISSUED,
        school_id=invoice.school_id or PLATFORM_SCOPE,
        actor_id=actor_id,
        entity_type="invoice",
        entity_id=str(note.id),
        detail={
            "invoiceNumber": note.invoice_number,
            "creditNoteFor": invoice.invoice_number,
            "totalPaise": note.total_paise,
        },
    )
    return note


def _write(
    *,
    payment: Payment,
    number_on: date,
    billing: dict,
    place_of_supply: str,
    rate_bps: int,
    taxable: int,
    split: dict,
    credit_note_for: Invoice | None,
    sac_code: str | None = None,
) -> Invoice:
    """Insert one invoice row, number and all. Caller holds the transaction.

    `pdf_path` is left null. See `pdf.py`: the document is rendered on demand
    from this row, because there is nowhere configured to put a file and a path
    pointing at nothing would be worse than no path at all.
    """
    now = timezone.now()
    return Invoice.objects.create(
        id=uuid.uuid4(),
        invoice_number=allocate_invoice_number(number_on),
        payment=payment,
        school_id=payment.school_id,
        parent_user_id=payment.parent_user_id,
        billing_name=billing["billing_name"],
        billing_address=billing.get("billing_address") or {},
        # Blank is not the same as absent: the column's format check rejects an
        # empty string, and an unregistered consumer legitimately has no GSTIN.
        gstin=(billing.get("gstin") or "").strip() or None,
        place_of_supply=place_of_supply,
        sac_code=sac_code or settings.GST_SAC_CODE,
        tax_rate_bps=rate_bps,
        taxable_paise=taxable,
        cgst_paise=split["cgst_paise"],
        sgst_paise=split["sgst_paise"],
        igst_paise=split["igst_paise"],
        total_paise=taxable + sum(split.values()),
        invoice_date=number_on,
        pdf_path=None,
        status=Invoice.Status.ISSUED,
        credit_note_for=credit_note_for,
        created_at=now,
    )


__all__ = [
    "FINANCIAL_YEAR_START_MONTH",
    "NUMBER_FORMAT",
    "SERIAL_CEILING",
    "InvoiceAction",
    "InvoiceNumberExhausted",
    "allocate_invoice_number",
    "financial_year",
    "issue_credit_note",
    "issue_for_payment",
    "require_seller_identity",
    "split_for",
    "split_like",
]
