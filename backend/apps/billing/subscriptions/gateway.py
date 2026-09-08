"""The payment gateway, over its REST API.

Razorpay, reached with httpx and HTTP Basic auth, not the razorpay Python SDK.
The SDK adds a dependency and an abstraction over four endpoints we call
directly, and it decides its own timeouts; the thing that actually matters here
is that a hung gateway must not hold a worker - and, at checkout, a per-payer
advisory lock - open indefinitely.

Three rules this module keeps, all of them the same rule as the AI proxy's:

  * The key secret is read from settings and never returned, never logged, and
    never put in an exception detail. `PAYMENT_GATEWAY_KEY_ID` is a different
    matter: it is the publishable half that the browser checkout script needs,
    and `public_key_id()` exists to hand it out on purpose.
  * A response body is never logged whole. Razorpay echoes the request back in
    its error payloads, so a body can carry the notes we sent; the status and
    the short error code are enough to debug with.
  * A gateway failure is a 502, not a 500. "Razorpay is down" and "we have a
    bug" are different incidents and must not read the same in a log or to a
    caller staring at a payment screen.

Testing seam: everything goes through `_request`, which is the only place that
opens a socket. A test either patches `httpx.Client.request` or leaves the keys
unset, in which case `_request` raises before any connection is attempted -
which is why the suite makes no network call even by accident.
"""

from __future__ import annotations

import logging

import httpx
from django.conf import settings
from rest_framework.exceptions import APIException

logger = logging.getLogger(__name__)

#: Checkout is interactive: someone is watching a spinner, and this call happens
#: while a per-payer lock is held. The budget is therefore much tighter than the
#: AI proxy's, where generation is legitimately slow.
TIMEOUT = httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0)


class GatewayNotConfigured(APIException):
    """No credentials in this environment. Not the caller's fault, and not a bug."""

    status_code = 503
    default_detail = "Payments are not configured in this environment."
    default_code = "gateway_not_configured"


class GatewayUnavailable(APIException):
    """The gateway could not be reached, or answered with a failure.

    502 rather than 500 deliberately: this service worked, its upstream did not.
    """

    status_code = 502
    default_detail = "The payment gateway could not be reached. No money has moved."
    default_code = "gateway_unavailable"


def configured() -> bool:
    return bool(settings.PAYMENT_GATEWAY_KEY_ID and settings.PAYMENT_GATEWAY_KEY_SECRET)


def public_key_id() -> str:
    """The publishable key id, for the browser's checkout script.

    Razorpay's key_id is designed to be embedded in a page - it identifies the
    merchant and authorises nothing on its own. The secret is what signs, and it
    never leaves this process.
    """
    return settings.PAYMENT_GATEWAY_KEY_ID


def _request(method: str, path: str, *, json: dict | None = None) -> dict:
    """One call to the gateway. The only place in this service that dials out."""
    if not configured():
        raise GatewayNotConfigured()

    url = f"{settings.PAYMENT_GATEWAY_BASE_URL.rstrip('/')}/{path.lstrip('/')}"
    auth = (settings.PAYMENT_GATEWAY_KEY_ID, settings.PAYMENT_GATEWAY_KEY_SECRET)

    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.request(method, url, json=json, auth=auth)
    except httpx.HTTPError as exc:
        # The exception's own repr can contain the URL but not the credentials,
        # since httpx puts Basic auth in a header. Log the type only regardless.
        logger.warning("gateway %s %s unreachable: %s", method, path, type(exc).__name__)
        raise GatewayUnavailable() from exc

    if response.status_code >= 400:
        logger.warning(
            "gateway %s %s returned HTTP %s (%s)",
            method,
            path,
            response.status_code,
            _error_code(response),
        )
        # A 4xx here is a bad plan id or a mis-set key - our problem, not the
        # payer's - and a 5xx is theirs. Neither is something the payer can act
        # on, and both mean the same thing to them: nothing was charged.
        raise GatewayUnavailable(
            detail="The payment gateway rejected the request. No money has moved."
            if response.status_code < 500
            else GatewayUnavailable.default_detail
        )

    try:
        return response.json()
    except ValueError as exc:
        logger.warning("gateway %s %s returned a non-JSON body", method, path)
        raise GatewayUnavailable() from exc


def _error_code(response: httpx.Response) -> str:
    """Razorpay's short error code, e.g. BAD_REQUEST_ERROR.

    Deliberately not the `description` beside it: that field quotes the request
    back, and the request carries our notes.
    """
    try:
        body = response.json()
    except ValueError:
        return "-"
    error = body.get("error") if isinstance(body, dict) else None
    return (error or {}).get("code", "-") if isinstance(error, dict) else "-"


# --- orders -----------------------------------------------------------------


def create_order(*, amount_paise: int, currency: str, receipt: str, notes: dict) -> dict:
    """Create an order for a one-off charge.

    `amount_paise` is sent as-is: Razorpay's API is paise-native, so there is no
    conversion at this boundary and nothing to round.

    `receipt` is our own payment id. Razorpay caps it at 40 characters, which a
    uuid fits inside, and it is what makes a stray order in the dashboard
    traceable back to a row here.
    """
    return _request(
        "POST",
        "orders",
        json={
            "amount": amount_paise,
            "currency": currency,
            "receipt": receipt,
            "notes": notes,
        },
    )


def fetch_payment(*, gateway_payment_id: str) -> dict:
    """Read a payment back from the gateway.

    The gateway is the source of truth for money (payment data model §1.2). The
    webhook handler uses this to confirm what a payload claims before acting on
    it - a signature proves the sender, not the contents' currency.
    """
    return _request("GET", f"payments/{gateway_payment_id}")


# --- recurring --------------------------------------------------------------
#
# Checkout does not use these yet. It creates one order per period, because
# Razorpay Subscriptions need each plan mirrored in the Razorpay dashboard
# (`plans.gateway_plan_id`, empty in every row today) and need an auto-debit
# mandate from the payer. Both are commercial decisions that have not been
# taken. `cancel_subscription` is wired up already so that a subscription
# created out-of-band can still be stopped from here.


def create_subscription(
    *, gateway_plan_id: str, total_count: int, notes: dict, customer_notify: bool = True
) -> dict:
    """Start a recurring mandate against a plan mirrored at the gateway."""
    return _request(
        "POST",
        "subscriptions",
        json={
            "plan_id": gateway_plan_id,
            "total_count": total_count,
            "customer_notify": 1 if customer_notify else 0,
            "notes": notes,
        },
    )


def cancel_subscription(*, gateway_subscription_id: str, at_cycle_end: bool = True) -> dict:
    """Stop a recurring mandate.

    `at_cycle_end` by default: the payer has already paid for the current cycle,
    and cancelling in the middle of it would end an entitlement they bought.
    """
    return _request(
        "POST",
        f"subscriptions/{gateway_subscription_id}/cancel",
        json={"cancel_at_cycle_end": 1 if at_cycle_end else 0},
    )


__all__ = [
    "TIMEOUT",
    "GatewayNotConfigured",
    "GatewayUnavailable",
    "cancel_subscription",
    "configured",
    "create_order",
    "create_subscription",
    "fetch_payment",
    "public_key_id",
]
