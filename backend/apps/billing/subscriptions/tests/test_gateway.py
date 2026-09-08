"""The gateway client: what it sends, what it refuses, and what it never leaks."""

from __future__ import annotations

import httpx
import pytest
from django.test import override_settings

from apps.billing.subscriptions import gateway

from .conftest import BILLING_SETTINGS

SECRET = BILLING_SETTINGS["PAYMENT_GATEWAY_KEY_SECRET"]


def order(**over):
    return {"amount_paise": 100_000, "currency": "INR", "receipt": "r-1", "notes": {}, **over}


# --- configuration ----------------------------------------------------------


def test_an_unconfigured_environment_never_opens_a_socket(monkeypatch):
    # The suite must not be one forgotten patch away from calling Razorpay.
    def _explode(*args, **kwargs):
        raise AssertionError("the gateway client dialled out with no credentials set")

    monkeypatch.setattr(httpx.Client, "request", _explode)
    with pytest.raises(gateway.GatewayNotConfigured) as caught:
        gateway.create_order(**order())
    assert caught.value.status_code == 503


@override_settings(PAYMENT_GATEWAY_KEY_ID="id-only", PAYMENT_GATEWAY_KEY_SECRET="")
def test_half_a_credential_is_not_configured():
    with pytest.raises(gateway.GatewayNotConfigured):
        gateway.fetch_payment(gateway_payment_id="pay_1")


# --- failure mapping --------------------------------------------------------


@override_settings(**BILLING_SETTINGS)
def test_an_unreachable_gateway_is_a_502_not_a_500(monkeypatch):
    def _fail(self, method, url, **kwargs):
        raise httpx.ConnectTimeout("no route", request=httpx.Request(method, url))

    monkeypatch.setattr(httpx.Client, "request", _fail)
    with pytest.raises(gateway.GatewayUnavailable) as caught:
        gateway.create_order(**order())
    # 502 says "their fault"; a 500 would read as ours in every dashboard.
    assert caught.value.status_code == 502
    assert "No money has moved" in str(caught.value.detail)


@override_settings(**BILLING_SETTINGS)
@pytest.mark.parametrize("status", [400, 401, 429, 500, 503])
def test_every_gateway_failure_becomes_a_502(fake_gateway, status):
    fake_gateway(status=status, body={"error": {"code": "BAD_REQUEST_ERROR"}})
    with pytest.raises(gateway.GatewayUnavailable) as caught:
        gateway.create_order(**order())
    assert caught.value.status_code == 502


@override_settings(**BILLING_SETTINGS)
def test_a_non_json_body_is_a_502_not_a_traceback(monkeypatch):
    def _html(self, method, url, **kwargs):
        return httpx.Response(
            200, text="<html>maintenance</html>", request=httpx.Request(method, url)
        )

    monkeypatch.setattr(httpx.Client, "request", _html)
    with pytest.raises(gateway.GatewayUnavailable):
        gateway.create_order(**order())


@override_settings(**BILLING_SETTINGS)
def test_the_key_secret_is_never_in_the_error_a_caller_sees(fake_gateway, caplog):
    fake_gateway(status=500, body={"error": {"code": "SERVER_ERROR", "description": SECRET}})
    with pytest.raises(gateway.GatewayUnavailable) as caught:
        gateway.create_order(**order())
    assert SECRET not in str(caught.value.detail)
    # ...nor in the log line, which is why `description` is dropped and only the
    # short error code is recorded.
    assert SECRET not in caplog.text


# --- what goes on the wire --------------------------------------------------


@override_settings(**BILLING_SETTINGS)
def test_an_order_is_sent_in_paise_with_basic_auth(fake_gateway):
    calls = fake_gateway(order_id="order_abc")
    result = gateway.create_order(
        amount_paise=353_882, currency="INR", receipt="pay-1", notes={"paymentId": "pay-1"}
    )

    assert result["id"] == "order_abc"
    (call,) = calls
    assert call["method"] == "POST"
    assert call["url"].endswith("/orders")
    # Paise, undivided. Razorpay's API is paise-native, so any arithmetic here
    # would be a rounding bug waiting to happen.
    assert call["json"]["amount"] == 353_882
    assert call["auth"] == (
        BILLING_SETTINGS["PAYMENT_GATEWAY_KEY_ID"],
        SECRET,
    )


@override_settings(**BILLING_SETTINGS)
def test_cancelling_a_mandate_defaults_to_the_end_of_the_cycle(fake_gateway):
    calls = fake_gateway(body={"id": "sub_1", "status": "cancelled"})
    gateway.cancel_subscription(gateway_subscription_id="sub_1")
    # Cancelling mid-cycle would end an entitlement the payer already bought.
    assert calls[0]["json"] == {"cancel_at_cycle_end": 1}
    assert calls[0]["url"].endswith("/subscriptions/sub_1/cancel")


@override_settings(**BILLING_SETTINGS)
def test_the_publishable_key_id_is_the_only_credential_handed_out():
    assert gateway.public_key_id() == BILLING_SETTINGS["PAYMENT_GATEWAY_KEY_ID"]
    assert SECRET not in gateway.public_key_id()
