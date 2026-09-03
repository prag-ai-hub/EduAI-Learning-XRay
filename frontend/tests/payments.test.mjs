import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const m9   = read("../supabase/migrations/20260905000000_plans_and_subscriptions.sql");
const m10  = read("../supabase/migrations/20260905000100_payments_events_invoices.sql");
const m13  = read("../supabase/migrations/20260904000200_unify_user_foreign_keys.sql");
const authz= read("lib/authorization.ts");

test("M13 makes public.users the single parent for user references", () => {
  assert.match(m13, /foreign key \(id\) references auth\.users\(id\) on delete cascade/);
  assert.match(m13, /credit_transactions_user_id_fkey[\s\S]{0,120}references public\.users\(id\)/);
  assert.match(m13, /invitations_invited_by_fkey[\s\S]{0,120}references public\.users\(id\)/);
  // An administrator leaving must not erase the audit trail of credits granted.
  assert.match(m13, /admin_user_id\) references public\.users\(id\) on delete set null/);
  assert.match(m13, /M13 post-check FAILED: still referencing auth\.users directly/);
});

test("money is stored in integer paise, never a float", () => {
  for (const [name, sql] of [["m9", m9], ["m10", m10]]) {
    assert.doesNotMatch(sql, /_paise\s+(real|double precision|float)/i, `${name} uses a float for money`);
  }
  assert.match(m9,  /amount_paise\s+bigint\s+not null check \(amount_paise > 0\)/);
  assert.match(m10, /total_paise\s+bigint\s+not null check \(total_paise >= 0\)/);
});

test("a payment has exactly one payer and a total that adds up", () => {
  assert.match(m10, /check \(\(school_id is not null\) <> \(parent_user_id is not null\)\)/);
  assert.match(m10, /check \(\s*total_paise = amount_paise \+ tax_paise\s*\)/);
});

test("webhook redelivery is impossible, not merely handled", () => {
  assert.match(m10, /create unique index if not exists payment_events_gateway_event_idx/);
  assert.match(m10, /INSERT FIRST, PROCESS SECOND/i);
  // An unverified signature must be recorded, not silently dropped.
  assert.match(m10, /signature_verified boolean\s+not null/);
});

test("a school can never hold two live subscriptions", () => {
  assert.match(m9, /create unique index if not exists subscriptions_one_live_per_school_idx[\s\S]*?where status in \('trialing','active','past_due','grace'\)/);
});

test("schools.plan_id is marked as never authoritative", () => {
  // subscriptions decides entitlement; the column exists only for listings.
  assert.match(m9, /NEVER read this for an entitlement decision/);
  const fn = m9.slice(m9.indexOf("function public.resolve_entitlement"));
  assert.doesNotMatch(fn, /schools/, "resolve_entitlement must not read schools.plan_id");
});

test("past_due is entitled only inside its grace window", () => {
  const fn = m9.slice(m9.indexOf("function public.resolve_entitlement"));
  assert.match(fn, /when v_sub\.status in \('past_due','grace'\)/);
  assert.match(fn, /grace_until, v_sub\.current_period_end, now\(\)\) > now\(\)/);
});

test("GST invoices cannot mix intra-state and inter-state tax", () => {
  assert.match(m10, /constraint invoices_one_tax_shape/);
  assert.match(m10, /igst_paise = 0 and cgst_paise = sgst_paise/);
  assert.match(m10, /constraint invoices_total_adds_up/);
  // The rate is per-invoice so a change never rewrites history.
  assert.match(m10, /tax_rate_bps\s+integer\s+not null/);
});

test("invoice numbers are allocated in the caller's transaction", () => {
  // Concurrent webhooks must not collide or leave gaps in a GST series.
  assert.match(m10, /on conflict \(financial_year\) do update/);
  assert.match(m10, /lpad\(v_next::text, 6, '0'\)/);
  // Indian financial year starts in April.
  assert.match(m10, /extract\(month from p_on\) >= 4/);
});

test("credit top-ups join the existing ledger", () => {
  assert.match(m10, /add column if not exists payment_id uuid references public\.payments\(id\)/);
  assert.match(m10, /check \(transaction_type in \('allocation','adjustment','consumption','refund','purchase'\)\)/);
});

test("requireEntitlement gates billable work without blocking reads", () => {
  assert.match(authz, /export async function requireEntitlement/);
  assert.match(authz, /status:402/);
  assert.match(authz, /reason:"subscription_required"/);
  assert.match(authz, /reason:"upgrade_required"/);
  // An absent feature is a denial; failing open would make every future feature free.
  assert.match(authz, /if\(feature && !entitlement\.features\?\.\[feature\]\)/);
  assert.doesNotMatch(authz, /not implemented until M9/);
});

test("requireEntitlement does not lock out schools before M9 is deployed", () => {
  assert.match(authz, /resolve_entitlement\|schema cache\|could not find the function/);
});

const m15 = read("../supabase/migrations/20260905000300_refund_reopens_operation_key.sql");

test("a refunded operation key can be charged again", () => {
  // consume_credit asked "has this key ever been charged?" when the right
  // question is "does it currently hold a charge?". refund_credit reversed the
  // charge but left the consumption row, so the key answered "already charged"
  // forever and every retry after a failure was free.
  assert.match(m15, /and refunded_at is null/);
  assert.match(m15, /Only an UNREVERSED charge makes this a replay/);
});

test("uniqueness now constrains live charges, not the key for all time", () => {
  assert.match(m15, /drop index if exists public\.credit_transactions_operation_key_idx/);
  assert.match(m15, /create unique index if not exists credit_transactions_live_charge_idx[\s\S]*?where transaction_type = 'consumption' and refunded_at is null/);
});

test("refund_credit guards on the charge, not on a marker row", () => {
  // Guarding on the existence of a ':refund' row meant a re-charged operation
  // could never be refunded a second time.
  assert.match(m15, /transaction_type = 'consumption'\s*\n\s*and refunded_at is null/);
  assert.doesNotMatch(m15.slice(m15.indexOf("function public.refund_credit")),
                      /exists\s*\([^)]*':refund'/);
});

test("existing reversed charges are backfilled, not left ambiguous", () => {
  assert.match(m15, /update public\.credit_transactions c\s*\n\s*set refunded_at/);
  assert.match(m15, /r\.operation_key = c\.operation_key \|\| ':refund'/);
});
