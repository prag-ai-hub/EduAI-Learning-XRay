"""Rendering an invoice row as a tax invoice. ReportLab, no DOM, no storage.

--------------------------------------------------------------------------
ON DEMAND, NOT STORED
--------------------------------------------------------------------------
`invoices.pdf_path` stays null and this module writes no file. The row is the
record; the document is a deterministic function of the row, so re-rendering it
in 2029 produces the same page it produced on the day of the sale - every rate,
code, amount and tax shape is read from the row and none of it from settings.

Storing would mean choosing where, and this service has no object storage
configured. A `pdf_path` pointing at a bucket that does not exist is worse than
a null one: it reads as "the document is filed" to everybody downstream. When a
bucket is provisioned, the change is to write the bytes and set the path at the
end of `invoices._write` - nothing here has to move.

--------------------------------------------------------------------------
THE ONE THING THAT IS NOT ON THE ROW
--------------------------------------------------------------------------
The seller's own identity. `invoices` has columns for the buyer's GSTIN and
none for ours, so the seller block is read from settings. That is a real gap
and it is named in the handover: change the company GSTIN and every historical
invoice reprints with the new one. It is also why `require_seller_identity` is
called at *issue* time - so an unset GSTIN stops a sale being invoiced rather
than surfacing as an unrenderable row later.

--------------------------------------------------------------------------
MONEY
--------------------------------------------------------------------------
Paise in the database, rupees on the page, and the conversion is integer
`divmod` - never a float, never a division that could put 2,999.0000000001 in
front of a customer. `rupees()` is separately tested for exactly that.

No rupee sign. ReportLab's built-in Helvetica is WinAnsi-encoded and has no
U+20B9; printing one produces a black box on the page. "INR" is stated in the
column heading instead. Embedding a Unicode font would fix it and means
shipping a font file, which is a decision for whoever owns the brand.
"""

from __future__ import annotations

from io import BytesIO
from xml.sax.saxutils import escape

from django.conf import settings
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .models import Invoice

#: Point sizes and a single ink colour. Deliberately plain: a tax invoice is
#: read by an accountant and by a machine, and neither is helped by styling.
INK = colors.HexColor("#111111")
FAINT = colors.HexColor("#888888")
RULE = colors.HexColor("#cccccc")

_BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=9, leading=12, textColor=INK)
_LABEL = ParagraphStyle("label", parent=_BODY, fontSize=7.5, textColor=FAINT)
_TITLE = ParagraphStyle("title", parent=_BODY, fontSize=15, leading=18, fontName="Helvetica-Bold")


def rupees(paise: int) -> str:
    """Paise as a rupee figure, grouped the Indian way: `1,23,456.78`.

    Integer arithmetic throughout. This is the single most likely place for a
    factor-of-100 error to reach a customer, so it is one function with one
    test rather than a `/ 100` written out at each call site.
    """
    sign = "-" if paise < 0 else ""
    whole, paisa = divmod(abs(int(paise)), 100)
    digits = str(whole)
    if len(digits) > 3:
        # Last three digits, then pairs: the lakh/crore grouping.
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join([*groups, tail])
    return f"{sign}{digits}.{paisa:02d}"


def percent(bps: int, *, halved: bool = False) -> str:
    """Basis points as a percentage. `1800` is `18.00%`, halved is `9.00%`.

    Halving happens in half-basis-points so that an odd rate - which nobody has
    chosen, but which the schema permits - halves exactly instead of silently
    losing a fraction on the page. Three decimals are shown only when the third
    one carries something.
    """
    half_bps = int(bps) if halved else int(bps) * 2
    whole, rest = divmod(half_bps, 200)  # 200 half-basis-points make one percent
    decimals = f"{rest * 5:03d}"
    if decimals.endswith("0"):
        decimals = decimals[:2]
    return f"{whole}.{decimals}%"


def describe_invoice(invoice: Invoice) -> dict:
    """Everything that appears on the page, as strings, before any drawing.

    Split out from the drawing so the content is testable without parsing a
    PDF. `render_invoice` draws exactly this and adds nothing of its own, so a
    test over this dict is a test over what the customer receives.
    """
    is_credit_note = invoice.credit_note_for_id is not None
    plan = getattr(invoice.payment, "plan", None)

    #: The tax rows, in the shape the ROW actually is. Not recomputed from the
    #: seller's current state: an old intra-state invoice reprints intra-state
    #: forever, which is what makes a reprint the same document.
    if invoice.is_inter_state:
        taxes = [(f"IGST @ {percent(invoice.tax_rate_bps)}", rupees(invoice.igst_paise))]
    else:
        taxes = [
            (f"CGST @ {percent(invoice.tax_rate_bps, halved=True)}", rupees(invoice.cgst_paise)),
            (f"SGST @ {percent(invoice.tax_rate_bps, halved=True)}", rupees(invoice.sgst_paise)),
        ]

    return {
        "title": "Credit Note" if is_credit_note else "Tax Invoice",
        "seller": {
            # Read from settings, with an empty name until one is configured -
            # see the module docstring. Never a placeholder that reads like a
            # company name somebody chose.
            "name": (getattr(settings, "GST_SELLER_NAME", "") or "").strip(),
            "gstin": (settings.GST_SELLER_GSTIN or "").strip(),
            "state_code": (settings.GST_SELLER_STATE_CODE or "").strip(),
        },
        "buyer": {
            "name": invoice.billing_name,
            "address": _address_lines(invoice.billing_address),
            "gstin": invoice.gstin or "Unregistered",
            "place_of_supply": invoice.place_of_supply,
        },
        "number": invoice.invoice_number,
        "date": invoice.invoice_date.strftime("%d %B %Y"),
        "credit_note_for": _credited_number(invoice) if is_credit_note else None,
        "supply": {
            "description": plan.name if plan is not None else invoice.payment.purpose,
            "sac_code": invoice.sac_code,
            "rate": percent(invoice.tax_rate_bps),
            "taxable": rupees(invoice.taxable_paise),
        },
        "taxes": taxes,
        "total": rupees(invoice.total_paise),
        "status": invoice.status,
    }


def render_invoice(invoice: Invoice) -> bytes:
    """The invoice as PDF bytes. Draws `describe_invoice` and nothing else."""
    page = describe_invoice(invoice)
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"{page['title']} {page['number']}",
        # No author or subject: they would carry the seller's name into file
        # metadata, where nobody would think to correct it.
    )
    document.build(_flowables(page))
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------


def _flowables(page: dict) -> list:
    heading = [
        _para(page["title"].upper(), _TITLE),
        Spacer(1, 6),
        _party_table(page),
        Spacer(1, 12),
    ]
    if page["credit_note_for"]:
        heading.append(
            _para(f"Correction to invoice {page['credit_note_for']}. Amounts are credits.", _BODY)
        )
        heading.append(Spacer(1, 8))
    if page["status"] == Invoice.Status.CANCELLED:
        heading.append(_para("CANCELLED", _TITLE))
        heading.append(Spacer(1, 8))
    return [*heading, KeepTogether(_amounts_table(page))]


def _party_table(page: dict) -> Table:
    seller = page["seller"]
    seller_lines = [line for line in (seller["name"],) if line]
    seller_lines += [f"GSTIN {seller['gstin']}", f"State code {seller['state_code']}"]

    buyer = page["buyer"]
    buyer_lines = [buyer["name"], *buyer["address"]]
    buyer_lines += [f"GSTIN {buyer['gstin']}", f"Place of supply {buyer['place_of_supply']}"]

    meta = [
        ("Invoice number", page["number"]),
        ("Invoice date", page["date"]),
    ]

    table = Table(
        [
            [
                _block("Supplier", seller_lines),
                _block("Recipient", buyer_lines),
                _block("", [f"{label}: {value}" for label, value in meta]),
            ]
        ],
        colWidths=[58 * mm, 58 * mm, 58 * mm],
    )
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def _amounts_table(page: dict) -> Table:
    supply = page["supply"]
    rows = [
        ["Description", "SAC", "Rate", "Amount (INR)"],
        [
            _para(supply["description"], _BODY),
            supply["sac_code"],
            supply["rate"],
            supply["taxable"],
        ],
        ["", "", "Taxable value", supply["taxable"]],
    ]
    rows += [["", "", label, amount] for label, amount in page["taxes"]]
    rows.append(["", "", "Total", page["total"]])

    last = len(rows) - 1
    table = Table(rows, colWidths=[84 * mm, 22 * mm, 30 * mm, 38 * mm])
    table.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
                ("FONT", (0, 1), (-1, -1), "Helvetica", 9),
                ("FONT", (2, last), (-1, last), "Helvetica-Bold", 9),
                ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, 1), 0.4, RULE),
                ("LINEABOVE", (2, last), (-1, last), 0.6, INK),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def _para(text, style) -> Paragraph:
    """A Paragraph over text that is not ours.

    ReportLab's Paragraph argument is not a string, it is a markup document -
    `paraparser` reads tags out of it. Everything on an invoice that a buyer
    typed goes through here, and passing any of it raw has three separate
    consequences, all reproduced:

      * `Nehru <b>Vidyalaya</b>` renders as bold "Nehru Vidyalaya" - the tags
        are consumed, so the recipient's legal name on a tax document is
        silently not what they gave. A bare `&` or `<` in a name does the same.
      * `Rao <b School` raises ValueError("parse ended with 2 unclosed tags"),
        so that buyer's invoice download 500s permanently, with no way for them
        to fix it and no obvious cause.
      * `<img src="http://.../x.png"/>` makes ReportLab FETCH that URL while
        rendering. Billing text arrives from checkout, so this is a request
        the buyer chooses and our server makes.

    Escaping is the whole fix; there is no legitimate markup in a party name.
    """
    return Paragraph(escape("" if text is None else str(text)), style)


def _block(label: str, lines: list[str]) -> list:
    body = [_para(line, _BODY) for line in lines if line]
    return [_para(label.upper(), _LABEL), *body] if label else body


def _address_lines(address) -> list[str]:
    """A billing address as ordered lines.

    The address is free-form JSON because Indian addresses are. Known keys are
    ordered so the common case reads like an address; anything else is appended
    rather than dropped, because a line the buyer gave and the invoice omits is
    a line missing from a legal document.
    """
    if not isinstance(address, dict):
        return []
    order = ["line1", "line2", "street", "area", "city", "district", "state", "pincode", "country"]
    seen = set()
    lines = []
    for key in order:
        value = str(address.get(key) or "").strip()
        if value:
            lines.append(value)
        seen.add(key)
    for key in sorted(address):
        if key in seen:
            continue
        value = str(address.get(key) or "").strip()
        if value:
            lines.append(f"{key}: {value}")
    return lines


def _credited_number(invoice: Invoice) -> str:
    original = invoice.credit_note_for
    return original.invoice_number if original is not None else ""


__all__ = ["describe_invoice", "percent", "render_invoice", "rupees"]
