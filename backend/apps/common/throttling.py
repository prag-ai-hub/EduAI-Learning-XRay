"""Rate limits: the numbers, and what each one is actually protecting.

Imported by `settings.base` as `DEFAULT_THROTTLE_RATES`, so these are the live
thresholds rather than a copy of them, and `tests/test_rate_limits.py` asserts
against the same dict. A plain module with no Django imports, because settings
loads it before the app registry exists.

Every rate here is spent through `ScopedRateThrottle`, which means two things
worth knowing before tuning any number:

  * **The bucket is keyed per account, or per IP when there is no account.**
    Scoped throttles that sit behind authentication are therefore per user, and
    one household or one school behind a single NAT address does not share a
    bucket.
  * **Every view sharing a scope shares a bucket.** `user` is one allowance
    across all of a person's ordinary reads, not 120/min per endpoint. That is
    deliberate: it bounds a client that loops over several endpoints, which a
    per-endpoint limit does not.

Per-process, unless `REDIS_URL` is set. The default cache is LocMemCache, so
with N gunicorn workers each limit is effectively N times looser and resets on
every restart. `eduai.E007`/`E008` fail the deploy check for exactly this; the
invite-code limit below is the one where it matters most.
"""

from __future__ import annotations

#: Ordinary authenticated reads and writes - the fallback for everything that
#: does not name a tighter scope. Generous because a workspace screen fans out
#: into several calls on load, and a teacher moving through the app quickly is
#: not the threat model.
USER = "120/min"

#: Sign-up and registration: school registration and parent sign-up. Both write
#: a row for an identity that has none, so they are the surfaces where a script
#: with a fresh Supabase account does the most damage per request.
AUTH = "10/min"

#: The AI proxy. This is not the spend cap - credits are, and they are checked
#: per analysis - but it bounds how fast a single account can burn them, and how
#: fast a bug in a client loop can spend real money.
AI = "20/min"

#: Checkout. Idempotency already stops a double-clicked Pay button creating two
#: orders; this stops a script filling the gateway's dashboard with abandoned
#: ones, which is a reputational problem with the payment provider rather than a
#: security one.
CHECKOUT = "12/min"

#: The gateway's own callbacks. Deliberately high: a webhook throttled away is a
#: payment the product never learns about, and Razorpay's redelivery is finite.
#: Keyed by IP, so this is per gateway egress address.
WEBHOOK = "300/min"

#: Redeeming a parent invite code, per account, enforced by
#: `apps.tenants.parents.views.RedemptionThrottle` (which carries the same
#: number as a fallback in case this key is ever removed). A code is 50 bits, so
#: this is not what makes guessing infeasible - the entropy is. It is what stops
#: a signed-in account being used as a grinder at all, and it bounds the audit
#: noise one can generate. Per account rather than per IP because parents share
#: carrier-grade NAT addresses in their thousands.
PARENT_LINK = "10/hour"

#: What DRF reads. `anon` and `user` are DRF's own default scope names;
#: `AnonRateThrottle` is not installed - every route either authenticates or is
#: the signed webhook - so only `user` is used, and as an explicit
#: `throttle_scope` rather than as a default class.
THROTTLE_RATES: dict[str, str] = {
    "user": USER,
    "auth": AUTH,
    "ai": AI,
    "checkout": CHECKOUT,
    "webhook": WEBHOOK,
    "parent_link": PARENT_LINK,
}
