"""Issuing invoices: the number series, the split, and corrections.

Nothing here asserts what the tax treatment *should* be - that is the
accountant's call and the settings are hooks for it. What is asserted is that
the number series cannot skip or repeat, that the split is the shape the row
claims it is, and that a correction never touches the document it corrects.

Every split assertion is written out as an equality rather than left to
`invoices_one_tax_shape` and `invoices_total_adds_up`. The constraints are the
backstop; if they are the thing that fails, the message is an IntegrityError
naming a constraint instead of a line saying which figure was wrong.

WHAT THESE TESTS CANNOT PROVE. Two concurrent captures never producing a
duplicate or a gap needs two committing connections, and `transaction=True`
commits outside pytest-django's rollback and pollutes the shared local
database. What is proved instead is that allocation goes through
`public.next_invoice_number` inside the caller's transaction - the SQL
`insert … on conflict do update` holds the counter row's lock until commit, so
a second caller blocks - and that a rolled-back issue takes its number with it,
which is the observable half of gaplessness. See the result note.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from django.db import transaction
from django.test import override_settings
from django.utils import timezone

from apps.billing.subscriptions import invoices as inv
from apps.billing.subscriptions.models import Invoice, InvoiceCounter
from apps.billing.subscriptions.services import PaymentNotSettled, tax_paise
from apps.platform.audit.models import AuditEvent

from .conftest import BILLING_SETTINGS

pytestmark = pytest.mark.django_db

#: Far enough out that no committed counter row exists for this financial year,
#: so a test can assert the absolute serial rather than a relative one. Each
#: test's counter row is rolled back with the test.
FY_2031 = date(2031, 6, 1)


def snapshot(payment, *, rate_bps=1800, place="27", gstin="27AAACN0000A1Z5", **billing):
    """Put a captured payment into the state checkout would have left it in.

    `make_payment` writes a bare row; checkout also stores the buyer's billing
    snapshot and the rate actually charged, and those two are what an invoice is
    made out of.
    """
    tax = tax_paise(payment.amount_paise, rate_bps)
    payment.notes = {
        "billing": {
            "billing_name": billing.get("billing_name", "Nehru Vidyalaya Trust"),
            "billing_address": billing.get(
                "billing_address", {"line1": "12 MG Road", "city": "Pune", "pincode": "411001"}
            ),
            "gstin": gstin,
            "place_of_supply": place,
        },
        "taxRateBps": rate_bps,
    }
    payment.tax_paise = tax
    payment.total_paise = payment.amount_paise + tax
    payment.status = "captured"
    payment.captured_at = timezone.now()
    payment.save()
    return payment


# ---------------------------------------------------------------------------
# The financial year
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("on", "expected"),
    [
        (date(2026, 3, 31), "25-26"),  # the last day of a financial year
        (date(2026, 4, 1), "26-27"),  # the first day of the next
        (date(2026, 1, 1), "25-26"),  # a January invoice belongs to the year before
        (date(2025, 12, 31), "25-26"),
        (date(2099, 4, 1), "99-00"),  # the century rolls over without widening
    ],
)
def test_the_financial_year_turns_over_on_the_first_of_april(on, expected):
    assert inv.financial_year(on) == expected


def test_the_series_changes_at_the_year_boundary_and_restarts_at_one():
    """31 March and 1 April are different series, each beginning at 000001.

    Continuing one series across the boundary is the failure this guards: the
    numbers would still be sequential and the year would still be wrong.
    """
    last_day = inv.allocate_invoice_number(date(2031, 3, 31))
    first_day = inv.allocate_invoice_number(date(2031, 4, 1))

    assert last_day == "EDU/30-31/000001"
    assert first_day == "EDU/31-32/000001"


# ---------------------------------------------------------------------------
# The number series
# ---------------------------------------------------------------------------


def test_numbers_within_one_year_are_sequential_and_gapless():
    allocated = [inv.allocate_invoice_number(FY_2031) for _ in range(3)]

    assert allocated == ["EDU/31-32/000001", "EDU/31-32/000002", "EDU/31-32/000003"]
    assert InvoiceCounter.objects.get(financial_year="31-32").last_number == 3


def test_a_number_fits_the_sixteen_character_gst_limit():
    # `EDU/25-26/000001` is exactly 16, which is why the serial is six digits
    # and not seven.
    assert len(inv.allocate_invoice_number(FY_2031)) == 16


def test_a_rolled_back_issue_takes_its_number_with_it():
    """The observable half of gaplessness.

    A number consumed by an issue that then failed would leave a hole in the
    series, which is a compliance failure rather than an untidiness. Allocation
    happens inside the caller's transaction precisely so that it cannot.
    """
    first = inv.allocate_invoice_number(FY_2031)

    with pytest.raises(RuntimeError), transaction.atomic():
        inv.allocate_invoice_number(FY_2031)
        raise RuntimeError("the invoice insert failed")

    assert inv.allocate_invoice_number(FY_2031) == "EDU/31-32/000002"
    assert first == "EDU/31-32/000001"


# ---------------------------------------------------------------------------
# The split
# ---------------------------------------------------------------------------


@override_settings(**BILLING_SETTINGS)
def test_a_sale_in_the_sellers_own_state_splits_into_equal_halves(
    make_school, make_plan, make_payment
):
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=299_900), school=make_school()),
        place="27",  # the seller's own state in BILLING_SETTINGS
    )

    invoice = inv.issue_for_payment(payment, on=FY_2031)

    assert invoice.igst_paise == 0
    assert invoice.cgst_paise == invoice.sgst_paise == 26_991
    assert invoice.taxable_paise == 299_900
    assert invoice.total_paise == 299_900 + 26_991 + 26_991


@override_settings(**BILLING_SETTINGS)
def test_a_sale_in_another_state_is_all_igst(make_school, make_plan, make_payment):
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=299_900), school=make_school()),
        place="29",
        gstin="29AAACN0000A1Z5",
    )

    invoice = inv.issue_for_payment(payment, on=FY_2031)

    assert invoice.cgst_paise == invoice.sgst_paise == 0
    assert invoice.igst_paise == 53_982
    assert invoice.is_inter_state is True


@override_settings(**BILLING_SETTINGS)
@pytest.mark.parametrize("place", ["27", "29"])
@pytest.mark.parametrize("amount", [1, 333, 19_901, 299_900, 123_456_789])
def test_the_invoice_total_is_the_taxable_value_plus_the_tax(
    make_school, make_plan, make_payment, place, amount
):
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=amount), school=make_school()),
        place=place,
        gstin=f"{place}AAACN0000A1Z5",
    )

    invoice = inv.issue_for_payment(payment, on=FY_2031)

    assert invoice.total_paise == (
        invoice.taxable_paise + invoice.cgst_paise + invoice.sgst_paise + invoice.igst_paise
    )
    # And the customer was charged exactly what the invoice says.
    assert invoice.total_paise == payment.total_paise


@override_settings(**BILLING_SETTINGS)
def test_the_rate_on_the_invoice_is_the_rate_that_was_charged(make_school, make_plan, make_payment):
    """Settings hold today's rate; an invoice states a historical fact.

    The sale below was charged at 12%, and the environment now says 18%. If the
    invoice took 18% from settings it would misstate a completed sale, and the
    figures would no longer add up to the money that moved.
    """
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=100_000), school=make_school()),
        rate_bps=1200,
    )

    invoice = inv.issue_for_payment(payment, on=FY_2031)

    assert invoice.tax_rate_bps == 1200
    assert invoice.cgst_paise + invoice.sgst_paise == 12_000


@override_settings(**BILLING_SETTINGS)
def test_a_snapshot_that_disagrees_with_the_money_taken_refuses(
    make_school, make_plan, make_payment
):
    # 1800 bps of 100000 paise is 18000, not 9000. One of the two is wrong and
    # this is not the place to decide which.
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=100_000), school=make_school())
    )
    payment.tax_paise = 9_000
    payment.total_paise = 109_000
    payment.save(update_fields=["tax_paise", "total_paise"])

    with pytest.raises(PaymentNotSettled):
        inv.issue_for_payment(payment, on=FY_2031)


@override_settings(**BILLING_SETTINGS)
def test_a_payment_with_no_rate_snapshot_refuses_rather_than_reading_settings(
    make_school, make_plan, make_payment
):
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=100_000), school=make_school())
    )
    payment.notes = {"billing": payment.notes["billing"]}
    payment.save(update_fields=["notes"])

    with pytest.raises(PaymentNotSettled):
        inv.issue_for_payment(payment, on=FY_2031)


@override_settings(**BILLING_SETTINGS)
def test_a_payment_with_no_billing_snapshot_refuses(make_school, make_plan, make_payment):
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=100_000), school=make_school())
    )
    payment.notes = {"taxRateBps": 1800}
    payment.save(update_fields=["notes"])

    with pytest.raises(PaymentNotSettled):
        inv.issue_for_payment(payment, on=FY_2031)


# ---------------------------------------------------------------------------
# Refusing to invent a tax fact
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "missing", ["GST_RATE_BPS", "GST_SELLER_STATE_CODE", "GST_SAC_CODE", "GST_SELLER_GSTIN"]
)
def test_an_unset_tax_setting_refuses_to_issue_anything(
    make_school, make_plan, make_payment, missing
):
    """503, not a plausible-looking number.

    A defaulted rate or SAC code is indistinguishable from a decision somebody
    made, and it would be printed on a document an auditor reads back.
    """
    blank = None if missing == "GST_RATE_BPS" else ""
    with override_settings(**BILLING_SETTINGS):
        payment = snapshot(
            make_payment(
                plan=make_plan(audience="school", amount_paise=100_000), school=make_school()
            )
        )

    with override_settings(**{**BILLING_SETTINGS, missing: blank}):
        with pytest.raises(Exception) as caught:
            inv.issue_for_payment(payment, on=FY_2031)
        assert getattr(caught.value, "status_code", None) == 503

    assert Invoice.objects.filter(payment=payment).count() == 0


# ---------------------------------------------------------------------------
# Idempotency and the capture-time contract
# ---------------------------------------------------------------------------


@override_settings(**BILLING_SETTINGS)
def test_an_uncaptured_payment_is_not_invoiced(make_school, make_plan, make_payment):
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=100_000), school=make_school())
    )
    payment.status = "created"
    payment.save(update_fields=["status"])

    with pytest.raises(PaymentNotSettled):
        inv.issue_for_payment(payment, on=FY_2031)


@override_settings(**BILLING_SETTINGS)
def test_issuing_twice_returns_the_first_invoice_and_burns_no_number(
    make_school, make_plan, make_payment
):
    """A gateway redelivers. A second number on one sale is a gap plus a duplicate."""
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=100_000), school=make_school())
    )

    first = inv.issue_for_payment(payment, on=FY_2031)
    again = inv.issue_for_payment(payment, on=FY_2031)

    assert again.id == first.id
    assert again.invoice_number == first.invoice_number
    assert Invoice.objects.filter(payment=payment).count() == 1
    assert InvoiceCounter.objects.get(financial_year="31-32").last_number == 1


@override_settings(**BILLING_SETTINGS)
def test_a_parent_top_up_is_invoiced_to_the_parent_and_to_no_school(
    make_user, make_plan, make_payment
):
    from apps.accounts.roles import PARENT

    parent = make_user(PARENT)
    plan = make_plan(audience="parent", billing_period="one_time", amount_paise=49_900)
    payment = snapshot(
        make_payment(plan=plan, parent_user=parent, purpose="credit_topup"),
        gstin="",  # a parent is an unregistered consumer
    )

    invoice = inv.issue_for_payment(payment, on=FY_2031)

    assert invoice.parent_user_id == parent.id
    assert invoice.school_id is None
    # Blank is not the same as absent: the column's format check rejects "".
    assert invoice.gstin is None


@override_settings(**BILLING_SETTINGS)
def test_issuing_is_audited(make_school, make_plan, make_payment):
    school = make_school()
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=100_000), school=school)
    )

    invoice = inv.issue_for_payment(payment, on=FY_2031)

    event = AuditEvent.objects.get(action=inv.InvoiceAction.ISSUED, entity_id=str(invoice.id))
    assert event.school_id == school.id
    assert event.detail_json["invoiceNumber"] == invoice.invoice_number


@override_settings(**BILLING_SETTINGS)
def test_no_pdf_path_is_recorded(make_school, make_plan, make_payment):
    # The document is rendered on demand from the row; there is no object
    # storage configured to point a path at. See pdf.py.
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=100_000), school=make_school())
    )
    assert inv.issue_for_payment(payment, on=FY_2031).pdf_path is None


# ---------------------------------------------------------------------------
# Corrections
# ---------------------------------------------------------------------------


@override_settings(**BILLING_SETTINGS)
def test_a_correction_is_a_new_row_and_the_original_is_untouched(
    make_school, make_plan, make_payment
):
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=299_900), school=make_school())
    )
    original = inv.issue_for_payment(payment, on=FY_2031)
    before = Invoice.objects.values().get(pk=original.pk)

    note = inv.issue_credit_note(original, on=FY_2031)

    assert note.id != original.id
    assert note.credit_note_for_id == original.id
    assert note.invoice_number == "EDU/31-32/000002"
    # Every column of the original, unchanged - including its status. A
    # document that has been sent cannot be un-sent by an UPDATE.
    assert Invoice.objects.values().get(pk=original.pk) == before


@override_settings(**BILLING_SETTINGS)
def test_a_correction_reverses_the_whole_amount_in_the_originals_shape(
    make_school, make_plan, make_payment
):
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=299_900), school=make_school())
    )
    original = inv.issue_for_payment(payment, on=FY_2031)

    note = inv.issue_credit_note(original, on=FY_2031)

    assert note.taxable_paise == original.taxable_paise
    assert note.cgst_paise == original.cgst_paise
    assert note.sgst_paise == original.sgst_paise
    assert note.igst_paise == original.igst_paise
    assert note.total_paise == original.total_paise
    assert note.tax_rate_bps == original.tax_rate_bps
    # The amounts are positive because every money column checks `>= 0`. What
    # makes this a credit is `credit_note_for`.
    assert note.total_paise > 0


@override_settings(**BILLING_SETTINGS)
def test_a_correction_keeps_the_original_shape_after_the_seller_moves_state(
    make_school, make_plan, make_payment
):
    """The rule that "every rate and code comes from the ROW" earning its keep.

    An intra-state sale corrected after the seller re-registers elsewhere must
    still be corrected intra-state, or the credit note does not net off against
    the invoice it names.
    """
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=299_900), school=make_school()),
        place="27",
    )
    original = inv.issue_for_payment(payment, on=FY_2031)
    assert original.is_inter_state is False

    with override_settings(**{**BILLING_SETTINGS, "GST_SELLER_STATE_CODE": "29"}):
        note = inv.issue_credit_note(original, on=FY_2031)

    assert note.igst_paise == 0
    assert note.cgst_paise == note.sgst_paise == original.cgst_paise


@override_settings(**BILLING_SETTINGS)
def test_a_correction_is_issued_only_once(make_school, make_plan, make_payment):
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=100_000), school=make_school())
    )
    original = inv.issue_for_payment(payment, on=FY_2031)

    first = inv.issue_credit_note(original, on=FY_2031)
    again = inv.issue_credit_note(original, on=FY_2031)

    assert again.id == first.id
    assert Invoice.objects.filter(credit_note_for=original).count() == 1


@override_settings(**BILLING_SETTINGS)
def test_a_credit_note_cannot_itself_be_credited(make_school, make_plan, make_payment):
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=100_000), school=make_school())
    )
    note = inv.issue_credit_note(inv.issue_for_payment(payment, on=FY_2031), on=FY_2031)

    with pytest.raises(PaymentNotSettled):
        inv.issue_credit_note(note, on=FY_2031)


@override_settings(**BILLING_SETTINGS)
def test_a_correction_does_not_become_the_payments_invoice(make_school, make_plan, make_payment):
    """Re-issuing after a correction must not hand back the credit note.

    The idempotency lookup filters on `credit_note_for is null` for exactly
    this reason: a redelivered capture that received the credit note would treat
    the sale as invoiced by a document that reverses it.
    """
    payment = snapshot(
        make_payment(plan=make_plan(audience="school", amount_paise=100_000), school=make_school())
    )
    original = inv.issue_for_payment(payment, on=FY_2031)
    note = inv.issue_credit_note(original, on=FY_2031)

    # Ordering by creation is a tiebreak, not the guard - `credit_note_for is
    # null` is. Backdating the credit note takes the ordering away and leaves
    # only the filter, which is a state a clock adjustment on the host is
    # enough to produce. Written with `update` because the application never
    # writes it: that is the point of fabricating it here.
    Invoice.objects.filter(pk=note.pk).update(created_at=original.created_at - timedelta(days=1))

    assert inv.issue_for_payment(payment, on=FY_2031).id == original.id


# ---------------------------------------------------------------------------
# The allocator's own guards
# ---------------------------------------------------------------------------


def test_a_number_from_the_wrong_financial_year_is_refused(monkeypatch):
    """A migration that changed the SQL must fail here, not on a document.

    The Python derivation and the SQL one are independent on purpose; this is
    what makes that independence worth having.
    """
    from django.db import connection as real_connection

    class _Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, *args):
            return None

        def fetchone(self):
            return ("EDU/99-00/000001",)

    monkeypatch.setattr(real_connection, "cursor", lambda: _Cursor())

    with pytest.raises(inv.InvoiceNumberExhausted):
        inv.allocate_invoice_number(FY_2031)


def test_a_malformed_number_is_refused_rather_than_printed(monkeypatch):
    from django.db import connection as real_connection

    class _Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, *args):
            return None

        def fetchone(self):
            return (f"INV-{uuid.uuid4().hex[:6]}",)

    monkeypatch.setattr(real_connection, "cursor", lambda: _Cursor())

    with pytest.raises(inv.InvoiceNumberExhausted):
        inv.allocate_invoice_number(FY_2031)
