-- M10 — Payments, the webhook ledger, and GST invoices
--
-- Implements docs/plan/02-PAYMENT-DATA-MODEL.md §2 and §4.
--
-- Two rules the schema enforces rather than trusts:
--   1. The gateway is the source of truth for money. A payment is only marked
--      captured from a signature-verified webhook, never from a client callback.
--   2. Every webhook is recorded before it is acted on. payment_events is the
--      idempotency ledger, keyed on the gateway's own event id, so a redelivery
--      hits a unique index and does nothing.
--
-- Invoices are immutable. A correction is a credit note referencing the
-- original, never an UPDATE — the same shape as evaluation_versions.

-- ---------------------------------------------------------------------------
-- payments — every money movement, B2B and B2C.
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id                 uuid        primary key default gen_random_uuid(),
  -- Exactly one payer. This is what keeps a parent's card off a school ledger.
  school_id          text        references public.schools(id) on delete set null,
  parent_user_id     uuid        references public.users(id)   on delete set null,
  subscription_id    uuid        references public.subscriptions(id) on delete set null,
  plan_id            uuid        references public.plans(id),
  purpose            text        not null check (purpose in ('subscription','subscription_renewal','credit_topup')),
  amount_paise       bigint      not null check (amount_paise >= 0),
  tax_paise          bigint      not null default 0 check (tax_paise >= 0),
  total_paise        bigint      not null check (total_paise >= 0),
  currency           text        not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  status             text        not null default 'created'
                                 check (status in ('created','authorized','captured','failed','refunded','partially_refunded')),
  gateway            text        not null default 'razorpay' check (gateway in ('razorpay')),
  gateway_order_id   text,
  -- Set on capture. The gateway's own id is the natural idempotency key.
  gateway_payment_id text,
  method             text,
  failure_code       text,
  failure_reason     text,
  idempotency_key    text        not null,
  notes              jsonb       not null default '{}'::jsonb,
  captured_at        timestamptz,
  refunded_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint payments_single_payer check ((school_id is not null) <> (parent_user_id is not null)),
  constraint payments_total_adds_up check (total_paise = amount_paise + tax_paise)
);

create unique index if not exists payments_idempotency_idx on public.payments(idempotency_key);
create unique index if not exists payments_gateway_payment_idx
  on public.payments (gateway, gateway_payment_id) where gateway_payment_id is not null;
create index if not exists payments_school_idx on public.payments(school_id, created_at desc);
create index if not exists payments_parent_idx on public.payments(parent_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- payment_events — the webhook ledger. The most important table for retries.
--
-- Handler contract: INSERT FIRST, PROCESS SECOND. A redelivery hits the unique
-- index on gateway_event_id, returns 200 immediately and does nothing else. A
-- processing failure leaves status='failed' with the payload intact for replay.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_events (
  id                 uuid        primary key default gen_random_uuid(),
  gateway            text        not null default 'razorpay' check (gateway in ('razorpay')),
  gateway_event_id   text        not null,
  event_type         text        not null,
  -- Recorded, never assumed. An unverified event must be visible, not silently
  -- discarded, because a flood of them is an attack signal.
  signature_verified boolean     not null,
  payload            jsonb       not null,
  payment_id         uuid        references public.payments(id) on delete set null,
  subscription_id    uuid        references public.subscriptions(id) on delete set null,
  status             text        not null default 'received' check (status in ('received','processed','ignored','failed')),
  processing_error   text,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz
);
create unique index if not exists payment_events_gateway_event_idx
  on public.payment_events (gateway, gateway_event_id);
create index if not exists payment_events_unprocessed_idx
  on public.payment_events (received_at) where status in ('received','failed');

-- ---------------------------------------------------------------------------
-- invoices — immutable, GST-shaped.
--
-- NOTE: rates, SAC codes and place-of-supply rules must be confirmed with
-- EduAI Hub's accountant before go-live. The schema holds all three tax columns
-- so either an intra-state (CGST+SGST) or inter-state (IGST) split renders
-- without a migration, and the rate is stored per invoice so a future change
-- does not rewrite history.
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id               uuid        primary key default gen_random_uuid(),
  invoice_number   text        not null unique,
  payment_id       uuid        not null references public.payments(id),
  school_id        text        references public.schools(id) on delete set null,
  parent_user_id   uuid        references public.users(id)   on delete set null,
  billing_name     text        not null,
  billing_address  jsonb       not null default '{}'::jsonb,
  gstin            text        check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$'),
  place_of_supply  text        not null,
  sac_code         text        not null default '997331',
  tax_rate_bps     integer     not null default 1800 check (tax_rate_bps >= 0),
  taxable_paise    bigint      not null check (taxable_paise >= 0),
  cgst_paise       bigint      not null default 0 check (cgst_paise >= 0),
  sgst_paise       bigint      not null default 0 check (sgst_paise >= 0),
  igst_paise       bigint      not null default 0 check (igst_paise >= 0),
  total_paise      bigint      not null check (total_paise >= 0),
  invoice_date     date        not null default current_date,
  pdf_path         text,
  status           text        not null default 'issued' check (status in ('issued','cancelled')),
  credit_note_for  uuid        references public.invoices(id),
  created_at       timestamptz not null default now(),
  -- Intra-state uses CGST+SGST, inter-state uses IGST. Never both.
  constraint invoices_one_tax_shape check (
    (igst_paise = 0 and cgst_paise = sgst_paise) or
    (igst_paise > 0 and cgst_paise = 0 and sgst_paise = 0)
  ),
  constraint invoices_total_adds_up check (
    total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise
  )
);
create index if not exists invoices_school_idx on public.invoices(school_id, invoice_date desc);
create index if not exists invoices_parent_idx on public.invoices(parent_user_id, invoice_date desc);

-- ---------------------------------------------------------------------------
-- Invoice numbering. GST requires a sequential, gapless, financial-year-scoped
-- series of at most 16 characters. Allocated inside the caller's transaction so
-- concurrent webhooks cannot collide or leave holes.
--   Format: EDU/26-27/000001
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_counters (
  financial_year text primary key,
  last_number    bigint not null default 0
);

create or replace function public.next_invoice_number(p_on date default current_date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_start integer := case when extract(month from p_on) >= 4
                               then extract(year from p_on)::integer
                               else extract(year from p_on)::integer - 1 end;
  v_fy   text := lpad(((v_year_start)      % 100)::text, 2, '0') || '-' ||
                 lpad(((v_year_start + 1)  % 100)::text, 2, '0');
  v_next bigint;
begin
  insert into public.invoice_counters (financial_year, last_number)
  values (v_fy, 1)
  on conflict (financial_year) do update
    set last_number = public.invoice_counters.last_number + 1
  returning last_number into v_next;

  return 'EDU/' || v_fy || '/' || lpad(v_next::text, 6, '0');
end $$;

-- ---------------------------------------------------------------------------
-- Credit top-ups join the existing ledger rather than a parallel one, so a
-- user has a single auditable credit history.
-- ---------------------------------------------------------------------------
alter table public.credit_transactions add column if not exists payment_id uuid references public.payments(id) on delete set null;
alter table public.credit_transactions drop constraint if exists credit_transactions_transaction_type_check;
alter table public.credit_transactions
  add constraint credit_transactions_transaction_type_check
  check (transaction_type in ('allocation','adjustment','consumption','refund','purchase'));

alter table public.payments        enable row level security;
alter table public.payment_events  enable row level security;
alter table public.invoices        enable row level security;
alter table public.invoice_counters enable row level security;
revoke all on public.payments, public.payment_events, public.invoices, public.invoice_counters from anon, authenticated;
grant all  on public.payments, public.payment_events, public.invoices, public.invoice_counters to service_role;
revoke all on function public.next_invoice_number(date) from public, anon, authenticated;
grant execute on function public.next_invoice_number(date) to service_role;

comment on table public.payment_events is
  'Webhook idempotency ledger. Insert before processing: a redelivery hits the unique index on gateway_event_id and is a no-op.';
comment on table public.invoices is
  'Immutable. A correction is a new row with credit_note_for set, never an update.';
