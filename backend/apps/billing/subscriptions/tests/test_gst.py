"""GST arithmetic, and the constraint it exists to satisfy.

Nothing here asserts what the tax treatment *should* be - that is the
accountant's call and the settings are hooks for it. What is asserted is that
whatever rate is configured produces a figure the invoice table will accept.
"""

from __future__ import annotations

import uuid

import pytest
from django.db import connection
from django.test import override_settings
from django.utils import timezone

from apps.billing.subscriptions.models import Invoice
from apps.billing.subscriptions.services import gst_split, require_tax_settings, tax_paise

from .conftest import BILLING_SETTINGS


def test_the_tax_on_an_amount_is_rounded_to_the_nearest_paisa():
    assert tax_paise(299_900, 1800) == 53_982  # exact
    assert tax_paise(100, 1800) == 18
    assert tax_paise(0, 1800) == 0
    # A stated zero rate is a legitimate answer and must charge zero, not refuse.
    assert tax_paise(299_900, 0) == 0


@pytest.mark.parametrize("amount", [1, 7, 99, 333, 19_900, 299_900, 5_999_900, 123_456_789])
@pytest.mark.parametrize("rate", [0, 500, 1200, 1800, 2800])
def test_the_tax_figure_is_always_even(amount, rate):
    # Not cosmetic. `invoices_one_tax_shape` demands cgst_paise = sgst_paise
    # exactly, so an odd tax cannot be written as an intra-state invoice at all -
    # and that failure would surface in a webhook, after the money was taken.
    assert tax_paise(amount, rate) % 2 == 0


@override_settings(**BILLING_SETTINGS)
def test_an_intra_state_supply_splits_into_equal_halves():
    split = gst_split(299_900, 1800, place_of_supply="27")  # the seller's own state
    assert split == {"cgst_paise": 26_991, "sgst_paise": 26_991, "igst_paise": 0}


@override_settings(**BILLING_SETTINGS)
def test_an_inter_state_supply_is_all_igst():
    split = gst_split(299_900, 1800, place_of_supply="29")
    assert split == {"cgst_paise": 0, "sgst_paise": 0, "igst_paise": 53_982}


@override_settings(**BILLING_SETTINGS)
@pytest.mark.parametrize("place", ["27", "29"])
@pytest.mark.parametrize("amount", [1, 333, 19_900, 299_900])
def test_either_shape_adds_back_up_to_the_same_total(place, amount):
    split = gst_split(amount, 1800, place_of_supply=place)
    assert sum(split.values()) == tax_paise(amount, 1800)


@pytest.mark.parametrize("missing", ["GST_RATE_BPS", "GST_SELLER_STATE_CODE", "GST_SAC_CODE"])
def test_any_unset_tax_setting_refuses_to_price_anything(missing):
    # Refusing is the point. A default rate here would be indistinguishable from
    # a decision somebody made, and would end up printed on an invoice.
    blank = None if missing == "GST_RATE_BPS" else ""
    with override_settings(**{**BILLING_SETTINGS, missing: blank}):
        with pytest.raises(Exception) as caught:
            require_tax_settings()
        assert caught.value.status_code == 503


@override_settings(**BILLING_SETTINGS)
def test_a_configured_rate_is_returned_as_basis_points():
    assert require_tax_settings() == 1800


# --- against the real constraints -------------------------------------------


@pytest.mark.django_db
@override_settings(**BILLING_SETTINGS)
@pytest.mark.parametrize("place_of_supply", ["27", "29"])
@pytest.mark.parametrize("amount", [1, 333, 19_901, 299_900])
def test_the_computed_split_is_one_the_invoice_table_accepts(
    make_school, make_plan, make_payment, place_of_supply, amount
):
    """The invoice package will insert rows shaped like this. Prove they fit.

    `invoices_one_tax_shape` and `invoices_total_adds_up` are the two checks
    that would otherwise be discovered by a webhook, in production, holding a
    captured payment it cannot invoice.
    """
    school = make_school()
    plan = make_plan(audience="school", amount_paise=amount)
    payment = make_payment(plan=plan, school=school)
    split = gst_split(amount, 1800, place_of_supply=place_of_supply)

    with connection.cursor() as cursor:
        cursor.execute("select public.next_invoice_number()")
        number = cursor.fetchone()[0]

    invoice = Invoice.objects.create(
        id=uuid.uuid4(),
        invoice_number=number,
        payment=payment,
        school=school,
        parent_user=None,
        billing_name="Nehru Vidyalaya Trust",
        billing_address={"city": "Pune"},
        gstin=None,
        place_of_supply=place_of_supply,
        sac_code=BILLING_SETTINGS["GST_SAC_CODE"],
        tax_rate_bps=1800,
        taxable_paise=amount,
        total_paise=amount + sum(split.values()),
        invoice_date=timezone.now().date(),
        status=Invoice.Status.ISSUED,
        created_at=timezone.now(),
        **split,
    )

    # The row inserted at all, which is what both check constraints decide.
    invoice.refresh_from_db()
    assert invoice.total_paise == amount + sum(split.values())
    if sum(split.values()):
        assert invoice.is_inter_state is (place_of_supply != "27")
