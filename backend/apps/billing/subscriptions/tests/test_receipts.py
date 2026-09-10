"""The receipt and invoice read surface, and the PDF it hands out.

Two things are being tested and they fail in different ways. The scoping is the
one that fails as a data breach: an invoice carries a name, a postal address and
a GSTIN, so an endpoint that answers the wrong tenant hands out more than a
payment list would. The rendering is the one that fails quietly - a
factor-of-100 error looks like a plausible number all the way to a customer -
so the money conversion is tested on its own, in both directions of magnitude.

The routes are declared here rather than in `urls.py`, which this work does not
own. `urlpatterns` in a test module plus `ROOT_URLCONF` is Django's own hook for
that, and the paths are the ones the real table should use, so wiring them for
real changes nothing here. The routes needed are named in the result.
"""

from __future__ import annotations

import base64
import contextlib
import re
import zlib
from datetime import date

import pytest
from django.test import override_settings
from django.urls import include, path
from django.utils import timezone
from rest_framework.routers import DefaultRouter
from rest_framework.test import APIClient

from apps.accounts.capabilities import Capability
from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.billing.subscriptions import invoices as inv
from apps.billing.subscriptions import pdf
from apps.billing.subscriptions.models import Invoice
from apps.billing.subscriptions.views import InvoiceViewSet, ReceiptViewSet
from apps.platform.audit.models import AuditEvent
from apps.tenants.schools.tenancy import CROSS_TENANT_READ

from .conftest import BILLING_SETTINGS
from .test_invoices import FY_2031, snapshot

pytestmark = pytest.mark.django_db

router = DefaultRouter()
router.register("invoices", InvoiceViewSet, basename="invoice")
router.register("receipts", ReceiptViewSet, basename="receipt")

urlpatterns = [path("api/v1/billing/", include(router.urls))]

INVOICES = "/api/v1/billing/invoices/"
RECEIPTS = "/api/v1/billing/receipts/"

#: `ROOT_URLCONF=__name__` points Django at the table above.
routed = override_settings(ROOT_URLCONF=__name__, **BILLING_SETTINGS)


def _drawn_text(body: bytes) -> str:
    """Everything the PDF actually prints, as one string.

    Page content is ASCII85-encoded and then Flate-compressed, and ReportLab
    splits a run of text across several `Tj` operators - "Tag <", "b", ">" - so
    the operands have to be reassembled before any of it can be searched for.
    """
    drawn = []
    for chunk in re.findall(rb"stream\r?\n(.*?)endstream", body, re.S):
        raw = chunk.strip()
        for decode in (lambda b: base64.a85decode(b, adobe=True), zlib.decompress):
            with contextlib.suppress(Exception):
                raw = decode(raw)
        drawn += [m.decode("latin-1") for m in re.findall(rb"\((.*?)\)\s*Tj", raw)]
    return "".join(drawn)


def issued(school=None, parent=None, *, make_plan, make_payment, place="27", amount=299_900):
    """One captured payment with its invoice, for whoever is paying."""
    plan = make_plan(
        audience="school" if school else "parent",
        billing_period="annual" if school else "one_time",
        amount_paise=amount,
    )
    payment = snapshot(
        make_payment(
            plan=plan,
            school=school,
            parent_user=parent,
            purpose="subscription" if school else "credit_topup",
        ),
        place=place,
        gstin=f"{place}AAACN0000A1Z5" if school else "",
    )
    return inv.issue_for_payment(payment, on=FY_2031)


# ---------------------------------------------------------------------------
# Scoping. Not uniform across roles - see views._PayerScopedViewSet.
# ---------------------------------------------------------------------------


@routed
def test_a_school_admin_sees_only_their_own_schools_invoices(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    mine, theirs = make_school("Mine"), make_school("Theirs")
    ours = issued(mine, make_plan=make_plan, make_payment=make_payment)
    other = issued(theirs, make_plan=make_plan, make_payment=make_payment)

    body = api_client_for(make_user(SCHOOL_ADMIN, school=mine)).get(INVOICES).json()

    assert [row["id"] for row in body["results"]] == [str(ours.id)]
    assert str(other.id) not in body["results"][0].values()


@routed
def test_a_parent_sees_only_their_own_invoices(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    # A parent has no school, so the tenant filter alone would show them nothing
    # and, if it were relaxed, would show them everything. Their reach is the
    # payer column on the row itself.
    parent, other_parent = make_user(PARENT), make_user(PARENT)
    mine = issued(parent=parent, make_plan=make_plan, make_payment=make_payment)
    issued(parent=other_parent, make_plan=make_plan, make_payment=make_payment)
    issued(make_school(), make_plan=make_plan, make_payment=make_payment)

    body = api_client_for(parent).get(INVOICES).json()

    assert [row["id"] for row in body["results"]] == [str(mine.id)]


@routed
def test_a_school_admin_cannot_reach_another_schools_invoice_by_id(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    mine, theirs = make_school("Mine"), make_school("Theirs")
    other = issued(theirs, make_plan=make_plan, make_payment=make_payment)
    client = api_client_for(make_user(SCHOOL_ADMIN, school=mine))

    assert client.get(f"{INVOICES}{other.id}/").status_code == 404
    assert client.get(f"{INVOICES}{other.id}/pdf/").status_code == 404


@routed
def test_a_super_admin_must_name_the_school(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    """The matrix's ◐ row, not its ✔ all row.

    "View school payment history & invoices" is grant-gated. Unnamed, the
    request is refused rather than quietly answered with everything.
    """
    issued(make_school("One"), make_plan=make_plan, make_payment=make_payment)

    response = api_client_for(make_user(SUPER_ADMIN)).get(INVOICES)

    assert response.status_code == 400
    assert "school" in response.json().get("error", {}).get("detail", {})


@routed
def test_a_super_admin_without_a_grant_reads_nothing(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    school = make_school("One")
    issued(school, make_plan=make_plan, make_payment=make_payment)

    response = api_client_for(make_user(SUPER_ADMIN)).get(INVOICES, {"school": school.id})

    assert response.status_code == 403


@routed
def test_a_granted_super_admin_reads_that_school_and_the_read_is_audited(
    make_school, make_user, api_client_for, make_plan, make_payment, make_grant
):
    school = make_school("One")
    theirs = issued(school, make_plan=make_plan, make_payment=make_payment)
    issued(make_school("Two"), make_plan=make_plan, make_payment=make_payment)
    reader = make_user(SUPER_ADMIN)
    make_grant(granted_to=reader, school=school)

    before = AuditEvent.objects.filter(action=CROSS_TENANT_READ).count()
    body = api_client_for(reader).get(INVOICES, {"school": school.id}).json()

    assert [row["id"] for row in body["results"]] == [str(theirs.id)]
    assert AuditEvent.objects.filter(action=CROSS_TENANT_READ).count() == before + 1


@routed
def test_a_teacher_has_no_billing_capability_at_all(make_school, make_user, api_client_for):
    client = api_client_for(make_user(TEACHER, school=make_school()))
    assert client.get(INVOICES).status_code == 403
    assert client.get(RECEIPTS).status_code == 403


@routed
def test_an_anonymous_caller_reads_nothing():
    assert APIClient().get(INVOICES).status_code in (401, 403)
    assert APIClient().get(RECEIPTS).status_code in (401, 403)


@routed
def test_an_invoice_is_read_only(make_school, make_user, api_client_for, make_plan, make_payment):
    # Immutable by design: a correction is a new row, never a PATCH.
    school = make_school()
    invoice = issued(school, make_plan=make_plan, make_payment=make_payment)
    client = api_client_for(make_user(SCHOOL_ADMIN, school=school))

    assert client.patch(f"{INVOICES}{invoice.id}/", {"status": "cancelled"}).status_code == 405
    assert client.delete(f"{INVOICES}{invoice.id}/").status_code == 405


# ---------------------------------------------------------------------------
# Receipts (17.1)
# ---------------------------------------------------------------------------


@routed
def test_a_receipt_names_the_invoice_for_the_charge(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    school = make_school()
    invoice = issued(school, make_plan=make_plan, make_payment=make_payment)

    body = api_client_for(make_user(SCHOOL_ADMIN, school=school)).get(RECEIPTS).json()

    row = body["results"][0]
    assert row["invoice_number"] == invoice.invoice_number
    assert row["invoice_id"] == str(invoice.id)
    assert row["total_paise"] == invoice.total_paise


@routed
def test_an_unpaid_order_is_not_a_receipt(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    school = make_school()
    make_payment(plan=make_plan(audience="school"), school=school, status="created")
    settled = issued(school, make_plan=make_plan, make_payment=make_payment)

    body = api_client_for(make_user(SCHOOL_ADMIN, school=school)).get(RECEIPTS).json()

    assert [row["invoice_number"] for row in body["results"]] == [settled.invoice_number]


@routed
def test_a_receipt_for_a_payment_not_yet_invoiced_says_so_rather_than_500ing(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    # The webhook captures and then invoices. Between the two there is a real
    # settled payment with no invoice, and it must still render.
    school = make_school()
    snapshot(make_payment(plan=make_plan(audience="school"), school=school))

    row = api_client_for(make_user(SCHOOL_ADMIN, school=school)).get(RECEIPTS).json()["results"][0]

    assert row["invoice_number"] is None
    assert row["invoice_id"] is None


@routed
def test_a_receipt_does_not_publish_the_billing_snapshot(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    # Same rule as the payment list: the address is the invoice's business.
    school = make_school()
    issued(school, make_plan=make_plan, make_payment=make_payment)

    body = api_client_for(make_user(SCHOOL_ADMIN, school=school)).get(RECEIPTS).content.decode()

    assert "27AAACN0000A1Z5" not in body
    assert "MG Road" not in body
    assert "idempotency_key" not in body


# ---------------------------------------------------------------------------
# The PDF (17.2)
# ---------------------------------------------------------------------------


@routed
def test_the_pdf_download_is_a_pdf_named_after_the_invoice(
    make_school, make_user, api_client_for, make_plan, make_payment
):
    school = make_school()
    invoice = issued(school, make_plan=make_plan, make_payment=make_payment)

    response = api_client_for(make_user(SCHOOL_ADMIN, school=school)).get(
        f"{INVOICES}{invoice.id}/pdf/"
    )

    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    # An invoice number contains slashes; a filename must not.
    assert response["Content-Disposition"] == 'attachment; filename="EDU-31-32-000001.pdf"'


@routed
def test_the_download_is_audited(make_school, make_user, api_client_for, make_plan, make_payment):
    school = make_school()
    invoice = issued(school, make_plan=make_plan, make_payment=make_payment)
    admin = make_user(SCHOOL_ADMIN, school=school)

    api_client_for(admin).get(f"{INVOICES}{invoice.id}/pdf/")

    event = AuditEvent.objects.get(action=inv.InvoiceAction.DOWNLOADED, entity_id=str(invoice.id))
    assert event.actor_id == str(admin.id)


def test_the_download_declares_its_own_capability():
    """Listing and taking away the document are different cells in the matrix.

    Every role that holds one currently holds the other, so no role can prove
    the distinction from the outside. Declaring them separately anyway is what
    makes it possible to withdraw one later without discovering that the code
    never told them apart.
    """
    assert InvoiceViewSet.capability_map["pdf"] == Capability.PAYMENT_INVOICE_DOWNLOAD
    assert InvoiceViewSet.required_capabilities == frozenset({Capability.PAYMENT_HISTORY_READ})


# --- what the page says ------------------------------------------------------


@routed
def test_paise_become_rupees_and_not_a_hundred_times_too_much(make_school, make_plan, make_payment):
    """The single most likely place for a factor-of-100 error to reach a customer."""
    assert pdf.rupees(0) == "0.00"
    assert pdf.rupees(1) == "0.01"
    assert pdf.rupees(100) == "1.00"
    assert pdf.rupees(299_900) == "2,999.00"
    # Indian grouping: lakhs, not thousands.
    assert pdf.rupees(12_345_678) == "1,23,456.78"
    assert pdf.rupees(1_234_567_890) == "1,23,45,678.90"

    invoice = issued(make_school(), make_plan=make_plan, make_payment=make_payment, amount=299_900)
    page = pdf.describe_invoice(invoice)
    assert page["supply"]["taxable"] == "2,999.00"
    assert page["total"] == "3,538.82"  # 2999.00 + 269.91 + 269.91


def test_a_rate_in_basis_points_becomes_a_percentage():
    assert pdf.percent(1800) == "18.00%"
    assert pdf.percent(1800, halved=True) == "9.00%"
    assert pdf.percent(0) == "0.00%"
    assert pdf.percent(1250, halved=True) == "6.25%"
    # An odd rate nobody has chosen, but which the schema permits, still halves
    # exactly rather than silently losing a fraction on the page.
    assert pdf.percent(1801, halved=True) == "9.005%"


@routed
def test_an_intra_state_invoice_shows_cgst_and_sgst_and_no_igst(
    make_school, make_plan, make_payment
):
    page = pdf.describe_invoice(
        issued(make_school(), make_plan=make_plan, make_payment=make_payment, place="27")
    )

    assert [label for label, _ in page["taxes"]] == ["CGST @ 9.00%", "SGST @ 9.00%"]
    assert [amount for _, amount in page["taxes"]] == ["269.91", "269.91"]


@routed
def test_an_inter_state_invoice_shows_igst_alone(make_school, make_plan, make_payment):
    page = pdf.describe_invoice(
        issued(make_school(), make_plan=make_plan, make_payment=make_payment, place="29")
    )

    assert [label for label, _ in page["taxes"]] == ["IGST @ 18.00%"]
    assert [amount for _, amount in page["taxes"]] == ["539.82"]


@routed
def test_the_page_shows_the_rows_tax_shape_even_after_the_seller_moves(
    make_school, make_plan, make_payment
):
    """A rate change must not rewrite history, and neither must a move.

    Everything on the page except the seller's own identity comes off the row,
    so re-rendering an old invoice in a differently-configured environment
    produces the same document.
    """
    invoice = issued(make_school(), make_plan=make_plan, make_payment=make_payment, place="27")
    before = pdf.describe_invoice(invoice)

    with override_settings(
        **{**BILLING_SETTINGS, "GST_SELLER_STATE_CODE": "29", "GST_RATE_BPS": 2800}
    ):
        after = pdf.describe_invoice(invoice)

    assert after["taxes"] == before["taxes"]
    assert after["supply"] == before["supply"]
    assert after["total"] == before["total"]


@routed
def test_the_page_carries_both_parties_the_sac_code_and_the_number(
    make_school, make_plan, make_payment
):
    invoice = issued(make_school(), make_plan=make_plan, make_payment=make_payment)

    page = pdf.describe_invoice(invoice)

    assert page["title"] == "Tax Invoice"
    assert page["number"] == invoice.invoice_number
    assert page["date"] == date(2031, 6, 1).strftime("%d %B %Y")
    assert page["seller"]["gstin"] == BILLING_SETTINGS["GST_SELLER_GSTIN"]
    assert page["buyer"]["gstin"] == "27AAACN0000A1Z5"
    assert page["buyer"]["name"] == "Nehru Vidyalaya Trust"
    assert "12 MG Road" in page["buyer"]["address"]
    assert page["supply"]["sac_code"] == BILLING_SETTINGS["GST_SAC_CODE"]


@routed
def test_an_unregistered_buyer_is_shown_as_unregistered_not_as_blank(
    make_user, make_plan, make_payment
):
    parent = make_user(PARENT)
    page = pdf.describe_invoice(
        issued(parent=parent, make_plan=make_plan, make_payment=make_payment)
    )
    assert page["buyer"]["gstin"] == "Unregistered"


@routed
def test_a_credit_note_says_so_and_names_what_it_corrects(make_school, make_plan, make_payment):
    original = issued(make_school(), make_plan=make_plan, make_payment=make_payment)
    note = inv.issue_credit_note(original, on=FY_2031)

    page = pdf.describe_invoice(Invoice.objects.select_related("credit_note_for").get(pk=note.pk))

    assert page["title"] == "Credit Note"
    assert page["credit_note_for"] == original.invoice_number


@routed
def test_the_rendered_document_carries_no_rupee_sign(make_school, make_plan, make_payment):
    # Helvetica is WinAnsi-encoded and has no U+20B9; printing one puts a black
    # box on the page. "INR" is stated in the column heading instead.
    invoice = issued(make_school(), make_plan=make_plan, make_payment=make_payment)
    page = pdf.describe_invoice(invoice)

    assert "₹" not in repr(page)
    body = pdf.render_invoice(invoice)
    assert body.startswith(b"%PDF")
    assert len(body) > 1000


@routed
def test_rendering_is_deterministic_for_one_row(make_school, make_plan, make_payment):
    invoice = issued(make_school(), make_plan=make_plan, make_payment=make_payment)
    assert pdf.describe_invoice(invoice) == pdf.describe_invoice(invoice)


@routed
def test_an_address_key_nobody_anticipated_is_still_printed(make_school, make_plan, make_payment):
    """A line the buyer gave and the invoice omits is missing from a legal document."""
    invoice = issued(make_school(), make_plan=make_plan, make_payment=make_payment)
    invoice.billing_address = {"city": "Pune", "landmark": "opposite the post office"}
    invoice.save(update_fields=["billing_address"])

    lines = pdf.describe_invoice(invoice)["buyer"]["address"]

    assert "Pune" in lines
    assert any("opposite the post office" in line for line in lines)


@routed
def test_the_invoice_date_on_the_page_is_the_rows_date_not_today(
    make_school, make_plan, make_payment
):
    invoice = issued(make_school(), make_plan=make_plan, make_payment=make_payment)
    assert invoice.invoice_date == FY_2031
    assert timezone.localdate() != FY_2031
    assert pdf.describe_invoice(invoice)["date"] == "01 June 2031"


# ---------------------------------------------------------------------------
# The renderer's input is markup, not text
# ---------------------------------------------------------------------------


@routed
@pytest.mark.parametrize(
    ("name", "why"),
    [
        ("Nehru <b>Vidyalaya</b> Trust", "tags are consumed and the name renders bold"),
        ("Rao <b School", "an unclosed tag raises out of paraparser"),
        ('X <img src="http://127.0.0.1:9/p.png" width="1" height="1"/>', "reportlab fetches it"),
        ("A & B < C School", "a bare ampersand or angle bracket is markup too"),
    ],
    ids=["bold", "unclosed", "image", "bare"],
)
def test_a_hostile_billing_name_renders_as_itself(make_school, make_plan, make_payment, name, why):
    """ReportLab's Paragraph takes markup, and the billing name comes from checkout.

    Unescaped, each of these does something different and all three are wrong on
    a tax document: the recipient's legal name silently changes, their download
    500s permanently, or our server makes an outbound request of the buyer's
    choosing. See pdf._para.
    """
    plan = make_plan(audience="school", billing_period="annual", amount_paise=299_900)
    payment = snapshot(
        make_payment(plan=plan, school=make_school(), purpose="subscription"),
        billing_name=name,
    )
    invoice = inv.issue_for_payment(payment, on=FY_2031)

    body = pdf.render_invoice(invoice)

    assert body.startswith(b"%PDF-"), f"render failed: {why}"
    assert invoice.billing_name == name, "the stored name must be untouched"


@routed
def test_the_renderer_escapes_rather_than_stripping(make_school, make_plan, make_payment):
    """The characters survive into the drawn page instead of being eaten.

    The test above proves rendering does not crash; this proves the name is
    still the buyer's name afterwards. Without escaping the tags are parsed and
    never reach the content stream, so `<b>` is simply gone from the document.
    """
    plan = make_plan(audience="school", billing_period="annual", amount_paise=299_900)
    payment = snapshot(
        make_payment(plan=plan, school=make_school(), purpose="subscription"),
        billing_name="Tag <b>Kept</b> School",
    )
    body = pdf.render_invoice(inv.issue_for_payment(payment, on=FY_2031))

    assert _drawn_text(body).count("<b>") == 1, (
        "the angle brackets were parsed as markup instead of printed"
    )
