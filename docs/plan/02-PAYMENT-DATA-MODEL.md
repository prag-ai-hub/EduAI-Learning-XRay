# Day 1 · Task 2 — Payment Data Model

Gateway: **Razorpay**. Schema keeps gateway-neutral column names (`gateway`,
`gateway_order_id`, `gateway_payment_id`, `gateway_event_id`) so a second gateway can be added
without a migration.

---

## 1. Design rules

1. **Money is `bigint` paise.** Never float, never numeric-with-rounding. Razorpay's API is
   paise-native, so no conversion at the boundary. Display divides by 100.
2. **The gateway is the source of truth for money; our tables are a mirror.** We never mark a
   payment captured from a client callback — only from a signature-verified webhook.
3. **Every webhook is recorded before it is acted on.** `payment_events` is the idempotency
   ledger, keyed on the gateway's own event id.
4. **Subscriptions and payments are separate lifecycles.** A subscription can survive a failed
   payment (grace); a payment can exist with no subscription (parent top-up).
5. **Invoices are immutable.** A correction is a credit note, never an UPDATE. This mirrors the
   `evaluation_versions` pattern already proven in the codebase.

---

## 2. Tables

### `plans`

Catalogue of purchasable products. Both B2B (school subscription) and B2C (parent) live here,
separated by `audience`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `code` | text unique | stable slug, e.g. `school_standard_annual` |
| `name`, `description` | text | shown at checkout |
| `audience` | text check | `school` \| `parent` |
| `billing_period` | text check | `monthly` \| `quarterly` \| `annual` \| `one_time` |
| `amount_paise` | bigint check > 0 | ex-GST list price |
| `currency` | text default `INR` | |
| `credits_included` | integer default 0 | analysis credits granted per period |
| `max_teachers`, `max_students` | integer null | null = unlimited |
| `features` | jsonb | entitlement flags read by `requireEntitlement()` |
| `gateway` , `gateway_plan_id` | text null | Razorpay plan id for subscription plans |
| `status` | text check | `active` \| `archived` — archived plans keep existing subscribers |
| `sort_order` | integer | pricing-page ordering |
| `created_at`, `updated_at` | timestamptz | |

Archiving instead of deleting matters: a subscription must always resolve its plan for invoice
history, years later.

### `subscriptions`

One school's ongoing entitlement.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `school_id` | text → `schools(id)` | |
| `plan_id` | uuid → `plans(id)` | |
| `status` | text check | `trialing` \| `active` \| `past_due` \| `grace` \| `cancelled` \| `expired` |
| `current_period_start` / `_end` | timestamptz | |
| `grace_until` | timestamptz null | set on first payment failure |
| `cancel_at_period_end` | boolean default false | |
| `gateway`, `gateway_subscription_id`, `gateway_customer_id` | text | |
| `started_at`, `cancelled_at`, `ended_at` | timestamptz null | |
| `created_at`, `updated_at` | timestamptz | |

Constraint: a partial unique index enforces **at most one non-terminal subscription per school**
(`where status in ('trialing','active','past_due','grace')`). Upgrades supersede rather than
duplicate.

### `payments`

Every money movement, B2B and B2C.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `school_id` | text null → `schools(id)` | set for B2B |
| `parent_user_id` | uuid null → `auth.users(id)` | set for B2C |
| `subscription_id` | uuid null → `subscriptions(id)` | |
| `plan_id` | uuid null → `plans(id)` | snapshot of what was bought |
| `purpose` | text check | `subscription` \| `subscription_renewal` \| `credit_topup` |
| `amount_paise`, `tax_paise`, `total_paise` | bigint | `total = amount + tax`, enforced by check |
| `currency` | text default `INR` | |
| `status` | text check | `created` \| `authorized` \| `captured` \| `failed` \| `refunded` \| `partially_refunded` |
| `gateway` | text default `razorpay` | |
| `gateway_order_id` | text | Razorpay order |
| `gateway_payment_id` | text **unique** null | set on capture — the natural idempotency key |
| `method` | text null | upi / card / netbanking |
| `failure_code`, `failure_reason` | text null | |
| `idempotency_key` | text unique | client-supplied, `{purpose}:{payer}:{nonce}` |
| `captured_at`, `refunded_at` | timestamptz null | |
| `notes` | jsonb | gateway notes echo |
| `created_at`, `updated_at` | timestamptz | |

Check constraint: **exactly one** of `school_id` / `parent_user_id` is non-null. This is what
keeps a parent's card off a school's ledger.

### `payment_events` — the webhook ledger

The single most important table for Day 16/17/21.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `gateway` | text | |
| `gateway_event_id` | text **unique** | Razorpay `x-razorpay-event-id`. Unique index = replay protection |
| `event_type` | text | `payment.captured`, `subscription.charged`, … |
| `signature_verified` | boolean not null | recorded, never assumed |
| `payload` | jsonb | raw body, retained for dispute resolution |
| `payment_id`, `subscription_id` | uuid null | resolved during processing |
| `status` | text check | `received` \| `processed` \| `ignored` \| `failed` |
| `processing_error` | text null | |
| `received_at`, `processed_at` | timestamptz | |

Handler contract: **insert first, process second.** A duplicate delivery hits the unique index,
returns `200 OK` immediately, and does nothing else. A processing failure leaves
`status='failed'` for retry without losing the payload. This is the same idempotency shape as
`credit_transactions.operation_key` and `evaluation_versions.idempotency_key` — one pattern,
three uses.

### `invoices`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `invoice_number` | text **unique** | GST series, see §4 |
| `payment_id` | uuid → `payments(id)` | |
| `school_id` / `parent_user_id` | as on payment | |
| `billing_name`, `billing_address` | text / jsonb | captured at checkout |
| `gstin` | text null | B2B only |
| `place_of_supply` | text | state code, drives CGST+SGST vs IGST |
| `sac_code` | text | service accounting code |
| `taxable_paise` | bigint | |
| `cgst_paise`, `sgst_paise`, `igst_paise` | bigint default 0 | exactly one pair is non-zero |
| `total_paise` | bigint | |
| `invoice_date` | date | |
| `pdf_path` | text null | Supabase Storage key |
| `status` | text check | `issued` \| `cancelled` |
| `credit_note_for` | uuid null → `invoices(id)` | corrections are new rows |
| `created_at` | timestamptz | |

### Extending `credit_transactions`

No new table for top-ups. The existing ledger gains:

- `payment_id uuid null references payments(id)`
- `transaction_type` check widened to include `purchase`

A parent top-up therefore appears in the same ledger as an admin allocation and a grading
consumption — one auditable history per user.

### Extending `schools`

- `status text not null default 'Pending' check (status in ('Pending','Active','Suspended','Closed'))`
- `plan_id uuid null references plans(id)` — as specified in the Day 2 plan

> **Note on `schools.plan_id`.** `subscriptions` is authoritative for entitlement;
> `schools.plan_id` is a denormalised convenience column maintained by the webhook handler.
> It must never be read for an entitlement decision — `requireEntitlement()` always resolves
> through `subscriptions`. Kept because the Day 2 spec names it and admin listings read it.

---

## 3. Lifecycles

### B2B subscription

```
SchoolAdmin picks plan
  → POST /api/payments/checkout   → create Razorpay order/subscription, insert payments(created)
  → Razorpay Checkout on the client
  → webhook payment.captured / subscription.charged
      → insert payment_events (unique event id)
      → payments → captured
      → subscriptions upsert: status=active, roll current_period_*
      → grant plan.credits_included to the school pool
      → issue invoice, render PDF, email
```

Failure path: `payment.failed` → `subscriptions.status = past_due`, `grace_until = now() + 7d`,
reminder emails on days 1/3/6, then `expired` and a 402 gate on new billable work.

### B2C parent top-up

Same shape, `purpose='credit_topup'`, no subscription row, credits land in
`credit_transactions` with `transaction_type='purchase'` and the `payment_id` link.

---

## 4. GST — implementation shape

> **These are implementation hooks, not tax advice. Every rate, SAC code and place-of-supply
> rule below must be confirmed with EduAI Hub's accountant before go-live (Day 19).**

- **Rate:** SaaS is generally taxed at 18%. Stored per-invoice, never hardcoded in the PDF
  renderer, so a rate change does not rewrite history.
- **SAC code:** likely `997331` (licensing services for the right to use software) or `998434`.
  Confirm with the CA and store on the invoice row.
- **Intra- vs inter-state:** if `place_of_supply` equals the seller's registered state →
  CGST + SGST at half the rate each; otherwise → IGST at the full rate. One helper computes the
  split; the schema holds all three columns so either shape renders.
- **Invoice numbering:** sequential, gapless, financial-year scoped, ≤16 chars.
  Proposed format `EDU/25-26/000001`. A Postgres sequence per financial year, allocated inside
  the same transaction as the invoice insert, guarantees no gaps and no duplicates under
  concurrent webhooks.
- **B2B vs B2C:** capture `gstin` for schools at checkout; parents are unregistered consumers.

### Server-side PDF — a gap the plan does not fund

The existing PDF engine (`html2canvas` + `jsPDF`) runs **in the browser**. Invoices are
generated by a webhook on Cloudflare Workers, where there is no DOM. Options, cheapest first:

1. **`pdf-lib` in the Worker** — pure JS, no DOM, runs on Workers. Layout is manual but an
   invoice is a fixed table. *Recommended.*
2. Generate HTML in the Worker, render via an external PDF service. Adds a vendor and a cost.
3. Queue and render client-side on next admin login. Rejected — an invoice must exist at capture.

Day 19's 6 hrs assumed engine reuse; option 1 keeps it close to budget.

---

## 5. Razorpay on Cloudflare Workers

- **Do not use the Razorpay Node SDK.** It depends on Node builtins that are unavailable or
  behave differently on Workers. Use the REST API with `fetch` and Basic auth
  (`key_id:key_secret`).
- **Webhook signature:** HMAC-SHA256 of the raw body with the webhook secret, compared to
  `x-razorpay-signature`. Use Web Crypto (`crypto.subtle`) — already the pattern in
  `app/api/shares/route.ts`. Compare with a **constant-time** helper; the existing share-token
  code compares with `!==` and should be fixed at the same time.
- **Read the raw body before parsing.** Signature is over the exact bytes; `request.json()`
  first will break verification.
- **Secrets:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, plus
  `GST_SELLER_STATE_CODE` and `GST_RATE_BPS`. All must be added to `.env.example`, which is
  already missing `SUPABASE_PUBLISHABLE_KEY`.

---

## 6. Entitlement resolution

One function, one source of truth:

```ts
requireEntitlement(profile, feature)
  → resolve school's subscription (status in active|trialing|grace)
  → load plan.features
  → 402 { checkoutUrl } when absent or lapsed
```

Analysis credits stay a **separate** meter from plan entitlement: the plan grants credits on
renewal, and `consume_credit` spends them. Both must pass before `/api/grade` proceeds — which
is why the broken credit RPC (M6) has to be fixed before any of this is testable.
