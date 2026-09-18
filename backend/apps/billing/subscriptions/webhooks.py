"""Gateway callbacks. The only place in this service where money moves.

Nothing on the checkout surface marks a payment captured, because a client
callback is not evidence that anything was paid - a browser can post whatever it
likes. A signature-verified webhook is the evidence (payment data model §1.2),
and this module is where it is checked.

--------------------------------------------------------------------------
AUTHENTICATION IS THE SIGNATURE
--------------------------------------------------------------------------
A gateway holds no bearer token, so this endpoint is unauthenticated and says so
explicitly rather than inheriting a default that a later settings change could
turn into something else. What stands in for a token is an HMAC-SHA256 of the
**raw request body** under `PAYMENT_GATEWAY_WEBHOOK_SECRET`, compared in
constant time against `X-Razorpay-Signature`.

Three things that quietly break this check, all avoided here:

  * **Parsing first.** `request.data` re-serialises, and a re-serialised body is
    not the byte string that was signed - key order, whitespace and unicode
    escaping all differ. The signature would then never match, or worse, would
    be computed over bytes nobody sent. The raw body is read first, once, and
    everything downstream parses that same buffer.
  * **`!=`.** A short-circuiting comparison leaks the expected digest one byte
    at a time to anyone who can time the response. `hmac.compare_digest`.
  * **An unset secret.** An empty secret would make the check trivially
    satisfiable, so an unconfigured environment refuses every delivery with a
    503 rather than accepting anything. 503 and not 400: the gateway retries a
    503, so events that arrive during a misconfiguration land once it is fixed
    instead of being lost.

--------------------------------------------------------------------------
THE LEDGER, AND WHY AN UNVERIFIED EVENT IS NOT WRITTEN TO IT
--------------------------------------------------------------------------
`payment_events` is unique on (gateway, gateway_event_id) and is the idempotency
record: insert first, process second, and a redelivery collides and does
nothing. That is exactly why an event whose signature does not verify is logged
and dropped rather than recorded. Writing it would hand an anonymous caller the
ability to *claim an event id*: post a forgery carrying the id of a real
in-flight capture, and the genuine delivery that follows is dismissed as a
duplicate and the money never lands. The ledger's idempotency guarantee is only
as trustworthy as the rows in it, so only verified rows go in.

A **failed** row is reprocessed on redelivery, unlike a processed or ignored
one. The migration says so in as many words - "a processing failure leaves
status='failed' with the payload intact for replay" - and without it the
insert-first rule would turn every transient database error into a permanently
swallowed payment.

--------------------------------------------------------------------------
WHAT EACH STATUS CODE MEANS TO THE GATEWAY
--------------------------------------------------------------------------
The answer is a retry instruction, not a courtesy:

  * **2xx** - do not send this again. Used for a processed event, a duplicate,
    an event type we do not act on, and for a *permanent* failure such as a
    payload naming an order this service has never heard of. A retry cannot
    conjure the missing row, and a permanent 5xx loop hides the problem in the
    gateway's dashboard instead of surfacing it in our logs, where the row sits
    at `status='failed'` with the reason on it.
  * **5xx** - send it again. Used for a *transient* failure: the database was
    unavailable, something raised unexpectedly. The event stays `failed` and the
    redelivery replays it.
  * **4xx** - the request was not from the gateway (bad signature, unparseable
    body). Nothing was recorded and nothing moved.

--------------------------------------------------------------------------
ORDERING - GATEWAYS DELIVER OUT OF ORDER
--------------------------------------------------------------------------
The rule, in one sentence: **capture is absorbing, failure is not.**

  * A payment that is `captured`, `refunded` or `partially_refunded` has settled.
    No event moves it out of that: a `payment.failed` arriving after the capture
    (a late delivery, or the failure of an earlier attempt on the same order) is
    recorded and ignored.
  * A payment that is `failed` may still be captured afterwards. It is the same
    order, and a payer whose first card was declined and whose second worked has
    genuinely paid; refusing that capture would take their money and hand them
    nothing. This is why failure is a stopping point for the attempt and not for
    the order.
  * `payment.authorized` only ever moves a payment out of `created`, so a
    late-arriving authorisation cannot un-capture anything either.

Redelivery of an old event is handled one level up by the ledger, so these rules
only have to be right about genuinely new events arriving in the wrong order.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import uuid
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.platform.audit.services import record

from . import services
from .models import GATEWAY_RAZORPAY, Payment, PaymentEvent, Subscription

logger = logging.getLogger(__name__)

SIGNATURE_HEADER = "X-Razorpay-Signature"
EVENT_ID_HEADER = "X-Razorpay-Event-Id"

#: How long a school keeps working after a renewal fails. Seven days, from the
#: payment data model §3 ("`grace_until = now() + 7d`") - a stated decision, not
#: a number invented here, which is the same standard the GST settings are held
#: to. It is deliberately a constant and not a setting: `resolve_entitlement`
#: enforces the window from the `grace_until` column, so changing this only
#: affects subscriptions that fail *after* the change, and a per-environment
#: value would mean two schools in the same database were given different terms
#: for no reason a support agent could reconstruct.
GRACE_PERIOD = timedelta(days=7)

#: Statuses from which no webhook may move a payment. See ORDERING above.
SETTLED = frozenset(
    {
        Payment.Status.CAPTURED,
        Payment.Status.REFUNDED,
        Payment.Status.PARTIALLY_REFUNDED,
    }
)


class WebhookAction:
    """Audit action names for the events that move money.

    Declared here for the same reason `services.BillingAction` is declared
    there - `apps.platform.audit.services.Action` is outside this package - and
    they belong beside those.
    """

    PAYMENT_CAPTURED = "payment.captured"
    PAYMENT_FAILED = "payment.failed"
    SUBSCRIPTION_PAST_DUE = "subscription.past_due"
    SUBSCRIPTION_CANCELLED = "subscription.cancelled"


class Unprocessable(Exception):
    """This event can never be applied, so retrying it is pointless.

    A payload naming an order this service did not create, or one missing the
    entity its own event type promises. Recorded as a failed event and answered
    2xx: the gateway stops resending, and the row keeps the payload and the
    reason for whoever investigates.
    """


# ---------------------------------------------------------------------------
# Signature
# ---------------------------------------------------------------------------


def expected_signature(raw: bytes, secret: str) -> str:
    """The hex digest the gateway should have sent for exactly these bytes."""
    return hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()


def signature_ok(raw: bytes, provided: str | None, secret: str) -> bool:
    """Constant-time check of `provided` against the digest of `raw`.

    `compare_digest` throughout, including for the length mismatch that a `!=`
    would answer instantly. It raises on non-ASCII, which a header from a real
    gateway never is, so a hostile header is a refusal rather than a 500.
    """
    if not secret or not provided:
        return False
    provided = provided.strip()
    if not provided.isascii():
        return False
    return hmac.compare_digest(expected_signature(raw, secret), provided)


# ---------------------------------------------------------------------------
# The endpoint
# ---------------------------------------------------------------------------


class RazorpayWebhookView(APIView):
    """POST /api/v1/billing/webhooks/razorpay - the gateway's callback.

    Unauthenticated by design and by declaration, throttled on a scope sized for
    a retrying gateway rather than for a human.
    """

    #: No token exists to check. Stated rather than inherited: leaving the
    #: project default in place would make this endpoint's security depend on a
    #: settings block edited for entirely unrelated reasons.
    authentication_classes: list = []
    permission_classes = [AllowAny]

    #: 300/min. An open endpoint needs a ceiling - without one, anyone can make
    #: this process compute HMACs all day - but the ceiling has to sit far above
    #: anything the gateway does, including the burst when it drains a backlog
    #: after an outage. A throttled delivery answers 429, which the gateway
    #: retries, so the cap defers events rather than losing them; that is only
    #: true while the cap is high enough that the backlog eventually clears.
    throttle_scope = "webhook"

    def post(self, request):
        secret = settings.PAYMENT_GATEWAY_WEBHOOK_SECRET
        if not secret:
            # Nothing can be verified, so nothing may be believed. 503 keeps the
            # gateway retrying until an operator sets the secret.
            logger.error("webhook refused: PAYMENT_GATEWAY_WEBHOOK_SECRET is unset")
            return Response({"detail": "Webhooks are not configured."}, status=503)

        # The raw bytes, before anything parses them. `request.data` here would
        # consume the stream and leave only a re-serialisation to verify.
        raw = request.body

        if not signature_ok(raw, request.headers.get(SIGNATURE_HEADER), secret):
            # Deliberately no detail about which half failed, and no ledger row:
            # see the module docstring on event-id squatting.
            logger.warning(
                "webhook rejected: bad or missing signature (%d bytes from %s)",
                len(raw),
                request.META.get("REMOTE_ADDR", "-"),
            )
            return Response({"detail": "Invalid signature."}, status=400)

        try:
            event = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            logger.warning("webhook rejected: body is not JSON")
            return Response({"detail": "Body is not JSON."}, status=400)

        event_type = event.get("event") if isinstance(event, dict) else None
        if not isinstance(event_type, str) or not event_type:
            logger.warning("webhook rejected: no event type in a verified body")
            return Response({"detail": "No event type."}, status=400)

        return self._handle(event_id=_event_id(request, raw), event_type=event_type, event=event)

    def _handle(self, *, event_id: str, event_type: str, event: dict) -> Response:
        with transaction.atomic():
            row = _claim(event_id=event_id, event_type=event_type, event=event)
            if row is None:
                # Already processed or ignored under this event id. 2xx, and
                # nothing else - this is the redelivery the ledger exists for.
                logger.info("webhook %s (%s) already handled", event_id, event_type)
                return Response({"status": "duplicate"})

            handler = HANDLERS.get(event_type)
            if handler is None:
                # Razorpay adds event types without asking. An unrecognised one
                # is a record, not an incident: it is kept in full so that a
                # handler written later can be replayed against it.
                _finish(row, PaymentEvent.Status.IGNORED, note=f"no handler for {event_type}")
                return Response({"status": "ignored"})

            try:
                # A savepoint, so that a failure rolls back the work without
                # taking the ledger row - which is the only durable evidence of
                # what arrived - down with it.
                with transaction.atomic():
                    outcome = handler(row, event)
            except Unprocessable as exc:
                logger.error("webhook %s (%s) cannot be applied: %s", event_id, event_type, exc)
                _finish(row, PaymentEvent.Status.FAILED, note=str(exc))
                return Response({"status": "failed", "retryable": False})
            except Exception as exc:  # noqa: BLE001 - the gateway must be told to retry
                logger.exception("webhook %s (%s) failed", event_id, event_type)
                _finish(row, PaymentEvent.Status.FAILED, note=f"{type(exc).__name__}: {exc}")
                return Response({"status": "failed", "retryable": True}, status=500)

            _finish(row, PaymentEvent.Status.PROCESSED, note=outcome)
            return Response({"status": "processed", "outcome": outcome})


def _event_id(request, raw: bytes) -> str:
    """The gateway's own id for this delivery, or a stand-in derived from it.

    Razorpay puts the id in a header rather than in the body. If it is ever
    absent the digest of the body takes its place: a redelivery is the same
    bytes and therefore the same key, so idempotency survives a header the
    gateway changes its mind about. Prefixed, so a derived key can never be
    confused with one the gateway issued.
    """
    header = (request.headers.get(EVENT_ID_HEADER) or "").strip()
    return header or f"body:{hashlib.sha256(raw).hexdigest()}"


def _claim(*, event_id: str, event_type: str, event: dict) -> PaymentEvent | None:
    """Insert the ledger row, or take over an unfinished one. None if handled.

    Insert first, process second. The insert is what makes two simultaneous
    deliveries of one event mutually exclusive: the loser hits the unique index,
    then blocks on the winner's row until it commits and sees the finished
    status.
    """
    try:
        with transaction.atomic():
            return PaymentEvent.objects.create(
                id=uuid.uuid4(),
                gateway=GATEWAY_RAZORPAY,
                gateway_event_id=event_id,
                event_type=event_type,
                signature_verified=True,  # nothing unverified reaches this line
                payload=event,
                status=PaymentEvent.Status.RECEIVED,
                received_at=timezone.now(),
            )
    except IntegrityError:
        pass

    existing = (
        PaymentEvent.objects.select_for_update()
        .filter(gateway=GATEWAY_RAZORPAY, gateway_event_id=event_id)
        .first()
    )
    if existing is None:
        # The colliding row has gone since. Vanishingly unlikely, and the honest
        # answer is a retry rather than a guess.
        raise IntegrityError(f"payment event {event_id} collided and then vanished")
    if existing.status in (PaymentEvent.Status.PROCESSED, PaymentEvent.Status.IGNORED):
        return None
    # `received` (a delivery that died mid-flight) or `failed`: replay it. Both
    # capture-time seams are idempotent, so replaying something that in fact
    # completed grants nothing twice.
    return existing


def _finish(row: PaymentEvent, status: str, *, note: str | None = None) -> None:
    row.status = status
    row.processing_error = note if status == PaymentEvent.Status.FAILED else None
    row.processed_at = timezone.now()
    row.save(
        update_fields=["status", "processing_error", "processed_at", "payment", "subscription"]
    )


# ---------------------------------------------------------------------------
# Reading the payload
# ---------------------------------------------------------------------------


def _entity(event: dict, name: str) -> dict:
    """`payload.<name>.entity`, or a permanent failure.

    A verified signature proves who sent the body, not that the body says what
    this handler assumes. An event type promising an entity it did not bring is
    not something a retry improves.
    """
    payload = event.get("payload")
    holder = payload.get(name) if isinstance(payload, dict) else None
    entity = holder.get("entity") if isinstance(holder, dict) else None
    if not isinstance(entity, dict):
        raise Unprocessable(f"payload.{name}.entity is missing or malformed")
    return entity


def _resolve_payment(entity: dict) -> Payment:
    """The local payment this gateway payment belongs to.

    By order id first: checkout stored it from the gateway's own response, so it
    is the correlation this service established rather than one asserted by the
    payload. `notes.paymentId` is the fallback for a payment made against an
    order created elsewhere. Where both are present and disagree, the event is
    refused rather than resolved by preference - two contradictory identities in
    one signed payload is not something to pick a winner from.
    """
    by_order = None
    order_id = entity.get("order_id")
    if isinstance(order_id, str) and order_id:
        by_order = Payment.objects.filter(
            gateway=GATEWAY_RAZORPAY, gateway_order_id=order_id
        ).first()

    by_note = None
    notes = entity.get("notes")
    noted = notes.get("paymentId") if isinstance(notes, dict) else None
    if isinstance(noted, str) and noted:
        try:
            by_note = Payment.objects.filter(pk=uuid.UUID(noted)).first()
        except ValueError:
            by_note = None

    if by_order and by_note and by_order.pk != by_note.pk:
        raise Unprocessable("order id and notes.paymentId name different payments")

    payment = by_order or by_note
    if payment is None:
        raise Unprocessable(f"no payment matches order {order_id!r}")
    return payment


def _captured_at(entity: dict):
    """When the money actually moved, per the gateway.

    Its `created_at` rather than now(): a delivery replayed days later must not
    date the capture - and so the invoice that follows it - to the moment our
    worker happened to pick the event up.
    """
    stamp = entity.get("created_at")
    if isinstance(stamp, int) and not isinstance(stamp, bool) and stamp > 0:
        try:
            return datetime.fromtimestamp(stamp, tz=dt_timezone.utc)
        except (OverflowError, OSError, ValueError):
            pass
    return timezone.now()


# ---------------------------------------------------------------------------
# Handlers
#
# Each returns a short outcome string for the ledger, or raises: Unprocessable
# for something no retry fixes, anything else for something a retry might.
# ---------------------------------------------------------------------------


def _payment_captured(row: PaymentEvent, event: dict) -> str:
    entity = _entity(event, "payment")
    payment = _resolve_payment(entity)
    row.payment = payment
    return _apply_capture(row, payment, entity)


def _subscription_charged(row: PaymentEvent, event: dict) -> str:
    """A renewal collected against a mandate. Same money, same transition.

    Deliberately not a second implementation of capture: a renewal that took a
    different code path from a first payment is a renewal that eventually grants
    something a first payment does not.
    """
    entity = _entity(event, "payment")
    payment = _resolve_payment(entity)
    row.payment = payment
    row.subscription = _subscription_from(event) or payment.subscription
    return _apply_capture(row, payment, entity)


def _apply_capture(row: PaymentEvent, payment: Payment, entity: dict) -> str:
    """Mark the payment captured and grant what it bought. Idempotent."""
    gateway_payment_id = entity.get("id")
    if not isinstance(gateway_payment_id, str) or not gateway_payment_id:
        raise Unprocessable("the payment entity carries no id")

    # The gateway is the source of truth for money, and this is the one place
    # where believing the payload would cost real value: an event claiming a
    # smaller amount than the order must never buy the plan the order was for.
    # The amounts are compared, not corrected - a disagreement is a fact about
    # the world that a webhook handler has no business resolving on its own.
    amount = entity.get("amount")
    currency = entity.get("currency")
    if amount != payment.total_paise or (currency and currency != payment.currency):
        raise Unprocessable(
            f"payload charges {amount} {currency} against an order for "
            f"{payment.total_paise} {payment.currency}"
        )

    with transaction.atomic():
        locked = Payment.objects.select_for_update(of=("self",)).get(pk=payment.pk)
        if locked.status in SETTLED:
            # ORDERING: already settled, by an earlier delivery or a redelivery
            # of this one. The seams below are idempotent anyway; stopping here
            # keeps a duplicate out of the audit trail as well.
            #
            # The invoice is the exception, and it has to run outside this
            # transaction, below. `_issue_invoice` swallows its own failures so
            # a renderer cannot unwind a capture - which means a capture whose
            # first invoice attempt failed stays captured and uninvoiced, and
            # every later delivery used to stop here and never retry it. There
            # was no path back: nothing else calls the seam. `issue_for_payment`
            # returns the existing invoice under a row lock, so a redelivery for
            # an already-invoiced payment costs one query and changes nothing.
            settled = True
        else:
            settled = False

    if settled:
        _issue_invoice(payment)
        return "already settled"

    with transaction.atomic():
        locked = Payment.objects.select_for_update(of=("self",)).get(pk=payment.pk)

        now = timezone.now()
        locked.status = Payment.Status.CAPTURED
        locked.gateway_payment_id = gateway_payment_id
        locked.method = entity.get("method") or locked.method
        locked.captured_at = _captured_at(entity)
        locked.failure_code = None
        locked.failure_reason = None
        locked.updated_at = now
        locked.save(
            update_fields=[
                "status",
                "gateway_payment_id",
                "method",
                "captured_at",
                "failure_code",
                "failure_reason",
                "updated_at",
            ]
        )
        payment = locked

    if payment.purpose == Payment.Purpose.CREDIT_TOPUP:
        granted = services.grant_topup_credits(payment)
        outcome = f"topup: {granted} credits"
        subscription_id = None
    else:
        subscription = services.activate_subscription(payment)
        row.subscription = subscription
        # A school pack is capacity, not just access: its credits are what the
        # pricing table sells ("up to 50 students, 1 assessment"). Granted after
        # the subscription so a redelivery finds both already done.
        granted = (
            services.grant_pack_credits(payment)
            if payment.plan is not None and services.is_pack(payment.plan)
            else 0
        )
        outcome = f"subscription {subscription.status} to {subscription.current_period_end}"
        if granted:
            outcome += f", {granted} credits"
        subscription_id = str(subscription.id)

    record(
        action=WebhookAction.PAYMENT_CAPTURED,
        school_id=payment.school_id or services.PLATFORM_SCOPE,
        actor_id=None,  # a gateway confirmation has no human actor
        entity_type="payment",
        entity_id=str(payment.id),
        detail={
            "purpose": payment.purpose,
            "totalPaise": payment.total_paise,
            "currency": payment.currency,
            "gatewayPaymentId": gateway_payment_id,
            "subscriptionId": subscription_id,
        },
    )

    _issue_invoice(payment)
    return outcome


def _payment_authorized(row: PaymentEvent, event: dict) -> str:
    """Money is held but not taken. Nothing is granted here.

    Recorded because a payment stuck at `authorized` is the shape of a capture
    that never arrived, and a row that still says `created` hides that.
    """
    entity = _entity(event, "payment")
    payment = _resolve_payment(entity)
    row.payment = payment

    with transaction.atomic():
        locked = Payment.objects.select_for_update(of=("self",)).get(pk=payment.pk)
        # ORDERING: only ever forwards out of `created`. An authorisation
        # delivered after its own capture must not undo it.
        if locked.status != Payment.Status.CREATED:
            return f"left at {locked.status}"
        locked.status = Payment.Status.AUTHORIZED
        locked.method = entity.get("method") or locked.method
        locked.updated_at = timezone.now()
        locked.save(update_fields=["status", "method", "updated_at"])
    return "authorized"


def _payment_failed(row: PaymentEvent, event: dict) -> str:
    """An attempt did not go through. The subscription does not die of it."""
    entity = _entity(event, "payment")
    payment = _resolve_payment(entity)
    row.payment = payment

    with transaction.atomic():
        locked = Payment.objects.select_for_update(of=("self",)).get(pk=payment.pk)
        if locked.status in SETTLED:
            # ORDERING: a failure arriving after the money landed - a late
            # delivery, or an earlier attempt on the same order failing after a
            # later one succeeded. Recorded, never applied.
            return f"ignored: payment is already {locked.status}"

        locked.status = Payment.Status.FAILED
        locked.failure_code = entity.get("error_code") or None
        locked.failure_reason = entity.get("error_description") or None
        locked.updated_at = timezone.now()
        locked.save(update_fields=["status", "failure_code", "failure_reason", "updated_at"])
        payment = locked

    record(
        action=WebhookAction.PAYMENT_FAILED,
        school_id=payment.school_id or services.PLATFORM_SCOPE,
        actor_id=None,
        entity_type="payment",
        entity_id=str(payment.id),
        detail={
            "purpose": payment.purpose,
            "totalPaise": payment.total_paise,
            # The gateway's own code and description. Neither carries card data;
            # Razorpay's failure reasons are about the instrument, not its number.
            "failureCode": payment.failure_code,
            "failureReason": payment.failure_reason,
        },
    )

    grace = _open_grace(payment)
    if grace is not None:
        row.subscription = grace
        return f"failed; grace until {grace.grace_until}"
    return "failed"


def _open_grace(payment: Payment) -> Subscription | None:
    """Put the school's subscription into `past_due` with a grace window.

    THE GRACE RULE (17.3). A renewal that fails moves the subscription to
    `past_due` and sets `grace_until` to seven days out. Until that moment the
    school keeps working exactly as before; after it, `resolve_entitlement`
    stops entitling and billable work gets its 402. The rule is not restated in
    Python: the SQL function is the one that decides, and all this does is set
    the column it reads (`entitlements.py` explains why a rule written twice is
    a rule enforced in neither service).

    **The window is never extended.** A payer whose card fails every night would
    otherwise renew their own grace forever and never be cut off. The first
    failure starts the clock; later ones are recorded on the payment and change
    nothing here.

    A top-up failure reaches none of this: a parent buying credits has no
    subscription to put into grace, and their existing balance is not at stake.
    """
    if payment.purpose == Payment.Purpose.CREDIT_TOPUP or not payment.school_id:
        return None

    with transaction.atomic():
        subscription = services.live_subscription(payment.school_id, for_update=True)
        if subscription is None:
            # Nothing to protect: a first subscription that never captured
            # leaves the school where it already was, outside the product.
            return None
        if subscription.grace_until is not None:
            return subscription  # already counting down; see above

        now = timezone.now()
        if subscription.current_period_end and subscription.current_period_end > now:
            # They have already paid through current_period_end, so there is
            # nothing here to protect and a grace window would only shorten
            # what they bought: seven days from now can fall long before the
            # period ends, and resolve_entitlement reads past_due + grace_until.
            #
            # Two different failures land here and both are wrong to act on:
            #
            #   * a failed NEW or UPGRADE purchase. The attempt bought nothing,
            #     and the running subscription it was meant to replace is
            #     untouched - cutting it off would punish a school for trying
            #     to give us more money.
            #   * a stale `payment.failed` for a superseded attempt. A retry
            #     after a decline creates a NEW payment row, so the terminal-
            #     status guard above cannot see that attempt 2 already captured
            #     and extended the period. The period itself can.
            #
            # A genuine renewal failure is unaffected: renewals are charged at
            # or after the period end, so there is no live period to find.
            return subscription
        subscription.status = Subscription.Status.PAST_DUE
        subscription.grace_until = now + GRACE_PERIOD
        subscription.updated_at = now
        subscription.save(update_fields=["status", "grace_until", "updated_at"])

    record(
        action=WebhookAction.SUBSCRIPTION_PAST_DUE,
        school_id=payment.school_id,
        actor_id=None,
        entity_type="subscription",
        entity_id=str(subscription.id),
        detail={
            "paymentId": str(payment.id),
            "failureCode": payment.failure_code,
            "graceUntil": subscription.grace_until.isoformat(),
        },
    )
    return subscription


def _subscription_cancelled(row: PaymentEvent, event: dict) -> str:
    """The mandate is dead at the gateway. The period already paid for is not.

    The same shape as `services.cancel_at_period_end`, and for the same reason:
    ending the entitlement now would take back days the school has bought, and
    there is no refund path to make that right. Only a subscription with no
    period left to serve is ended outright.
    """
    entity = _entity(event, "subscription")
    subscription = _subscription_from(event)
    if subscription is None:
        raise Unprocessable(f"no subscription matches gateway id {entity.get('id')!r}")
    row.subscription = subscription

    now = timezone.now()
    with transaction.atomic():
        locked = Subscription.objects.select_for_update().get(pk=subscription.pk)
        if locked.status in (Subscription.Status.CANCELLED, Subscription.Status.EXPIRED):
            return f"already {locked.status}"

        locked.cancel_at_period_end = True
        locked.cancelled_at = locked.cancelled_at or now
        serves_a_paid_period = locked.current_period_end is not None and (
            locked.current_period_end > now
        )
        fields = ["cancel_at_period_end", "cancelled_at", "updated_at"]
        if not serves_a_paid_period:
            locked.status = Subscription.Status.CANCELLED
            locked.ended_at = now
            fields += ["status", "ended_at"]
        locked.updated_at = now
        locked.save(update_fields=fields)
        subscription = locked

    record(
        action=WebhookAction.SUBSCRIPTION_CANCELLED,
        school_id=subscription.school_id,
        actor_id=None,
        entity_type="subscription",
        entity_id=str(subscription.id),
        detail={
            "source": "gateway",
            "endsAt": subscription.current_period_end.isoformat()
            if subscription.current_period_end
            else None,
        },
    )
    return "cancelled at period end" if serves_a_paid_period else "cancelled"


def _subscription_from(event: dict) -> Subscription | None:
    """The local subscription a payload's subscription entity refers to, if any."""
    payload = event.get("payload")
    holder = payload.get("subscription") if isinstance(payload, dict) else None
    entity = holder.get("entity") if isinstance(holder, dict) else None
    gateway_id = entity.get("id") if isinstance(entity, dict) else None
    if not isinstance(gateway_id, str) or not gateway_id:
        return None
    return Subscription.objects.filter(
        gateway=GATEWAY_RAZORPAY, gateway_subscription_id=gateway_id
    ).first()


#: Event type -> handler. Anything absent is recorded and acknowledged.
HANDLERS = {
    "payment.authorized": _payment_authorized,
    "payment.captured": _payment_captured,
    "payment.failed": _payment_failed,
    "subscription.charged": _subscription_charged,
    "subscription.cancelled": _subscription_cancelled,
}


# ---------------------------------------------------------------------------
# The invoice seam
# ---------------------------------------------------------------------------

#: What this module calls once a payment has captured: a callable taking the
#: captured `Payment` and issuing its GST invoice. `invoices.py` was written
#: alongside this file and now provides it, but the import stays deferred and
#: tolerant of its absence, because a capture must not be refused over a missing
#: renderer. That the entry point is really there is a matter for the suite -
#: `test_a_capture_issues_the_gst_invoice` fails if it moves - rather than
#: something to discover from a warning log in production.
INVOICE_ENTRY_POINT = ("apps.billing.subscriptions.invoices", "issue_for_payment")


def _issue_invoice(payment: Payment) -> None:
    """Issue the invoice for a captured payment, if the invoice module is here.

    Never lets an invoice failure undo a capture. The money has moved; a
    subscription that refused to activate because a PDF renderer raised would be
    the worse of the two outcomes by a distance, and the event row plus this log
    line are enough to reissue from. Its own savepoint, so a database error
    inside the renderer cannot poison the transaction that recorded the capture.
    """
    module_name, attribute = INVOICE_ENTRY_POINT
    try:
        from importlib import import_module

        issue = getattr(import_module(module_name), attribute)
    except (ImportError, AttributeError):
        logger.warning(
            "payment %s captured with no invoice issued: %s.%s is not available",
            payment.id,
            module_name,
            attribute,
        )
        return

    try:
        with transaction.atomic():
            issue(payment)
    except Exception:  # noqa: BLE001 - an invoice must never unwind a capture
        logger.exception("invoice generation failed for captured payment %s", payment.id)


__all__ = [
    "EVENT_ID_HEADER",
    "GRACE_PERIOD",
    "HANDLERS",
    "INVOICE_ENTRY_POINT",
    "SIGNATURE_HEADER",
    "RazorpayWebhookView",
    "Unprocessable",
    "WebhookAction",
    "expected_signature",
    "signature_ok",
]
