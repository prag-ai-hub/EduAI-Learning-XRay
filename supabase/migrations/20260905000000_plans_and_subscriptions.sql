-- M9 — Plans and subscriptions
--
-- Implements docs/plan/02-PAYMENT-DATA-MODEL.md §2. Gateway is Razorpay, but
-- every gateway-specific value lives in a `gateway`-prefixed column so a second
-- provider needs no migration.
--
-- Money is bigint PAISE throughout. Never float, never numeric-with-rounding:
-- Razorpay's API is paise-native, so there is no conversion at the boundary and
-- no rounding to disagree about. Display divides by 100.
--
-- Conventions from M12/M13 apply: OUT parameters are out_-prefixed, and every
-- user reference points at public.users.

-- ---------------------------------------------------------------------------
-- plans — the catalogue. B2B (school) and B2C (parent) share it, separated by
-- `audience`, so one pricing page query serves both.
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id               uuid primary key default gen_random_uuid(),
  code             text        not null unique check (code ~ '^[a-z0-9_]{3,60}$'),
  name             text        not null,
  description      text,
  audience         text        not null check (audience in ('school','parent')),
  billing_period   text        not null check (billing_period in ('monthly','quarterly','annual','one_time')),
  amount_paise     bigint      not null check (amount_paise > 0),
  currency         text        not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  credits_included integer     not null default 0 check (credits_included >= 0),
  max_teachers     integer     check (max_teachers is null or max_teachers > 0),
  max_students     integer     check (max_students is null or max_students > 0),
  features         jsonb       not null default '{}'::jsonb,
  gateway          text        check (gateway in ('razorpay')),
  gateway_plan_id  text,
  -- Archived rather than deleted: a subscription must still resolve its plan
  -- for invoice history years later.
  status           text        not null default 'active' check (status in ('active','archived')),
  sort_order       integer     not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists plans_audience_idx on public.plans(audience, status, sort_order);

-- ---------------------------------------------------------------------------
-- subscriptions — one school's ongoing entitlement.
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                      uuid        primary key default gen_random_uuid(),
  school_id               text        not null references public.schools(id) on delete cascade,
  plan_id                 uuid        not null references public.plans(id),
  status                  text        not null default 'trialing'
                                      check (status in ('trialing','active','past_due','grace','cancelled','expired')),
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  -- Set on first payment failure. A school in grace keeps working; the 402 gate
  -- only closes once this passes.
  grace_until             timestamptz,
  cancel_at_period_end    boolean     not null default false,
  gateway                 text        not null default 'razorpay' check (gateway in ('razorpay')),
  gateway_subscription_id text,
  gateway_customer_id     text,
  started_at              timestamptz,
  cancelled_at            timestamptz,
  ended_at                timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (current_period_end is null or current_period_start is null
         or current_period_end > current_period_start)
);

-- At most one live subscription per school. An upgrade supersedes rather than
-- duplicating, so entitlement is never ambiguous.
create unique index if not exists subscriptions_one_live_per_school_idx
  on public.subscriptions (school_id)
  where status in ('trialing','active','past_due','grace');

create index if not exists subscriptions_school_idx  on public.subscriptions(school_id);
create unique index if not exists subscriptions_gateway_id_idx
  on public.subscriptions (gateway, gateway_subscription_id)
  where gateway_subscription_id is not null;

-- ---------------------------------------------------------------------------
-- schools.plan_id — deferred here from M7 because it needs public.plans.
--
-- DENORMALISED CONVENIENCE ONLY. subscriptions is authoritative for
-- entitlement; resolve_entitlement() below never reads this column. It exists
-- because the Day 2 specification names it and admin listings read it.
-- ---------------------------------------------------------------------------
alter table public.schools add column if not exists plan_id uuid references public.plans(id);
comment on column public.schools.plan_id is
  'Denormalised current plan for listings. NEVER read this for an entitlement decision - subscriptions is authoritative.';

-- ---------------------------------------------------------------------------
-- Entitlement resolution — one source of truth, used by requireEntitlement().
-- ---------------------------------------------------------------------------
create or replace function public.resolve_entitlement(p_school_id text)
returns table(
  out_has_entitlement  boolean,
  out_status           text,
  out_plan_code        text,
  out_plan_name        text,
  out_features         jsonb,
  out_credits_included integer,
  out_period_end       timestamptz,
  out_grace_until      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sub  public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
begin
  select s.* into v_sub
    from public.subscriptions s
   where s.school_id = p_school_id
     and s.status in ('trialing','active','past_due','grace')
   order by s.created_at desc
   limit 1;

  if not found then
    return query select false, 'none'::text, null::text, null::text,
                        '{}'::jsonb, 0, null::timestamptz, null::timestamptz;
    return;
  end if;

  select p.* into v_plan from public.plans p where p.id = v_sub.plan_id;

  -- past_due is entitled only while inside its grace window. Everything else in
  -- the live set is entitled.
  return query select
    case
      when v_sub.status in ('trialing','active') then true
      when v_sub.status in ('past_due','grace')
        then coalesce(v_sub.grace_until, v_sub.current_period_end, now()) > now()
      else false
    end,
    v_sub.status,
    v_plan.code,
    v_plan.name,
    coalesce(v_plan.features, '{}'::jsonb),
    coalesce(v_plan.credits_included, 0),
    v_sub.current_period_end,
    v_sub.grace_until;
end $$;

alter table public.plans         enable row level security;
alter table public.subscriptions enable row level security;
revoke all on public.plans, public.subscriptions from anon, authenticated;
grant all  on public.plans, public.subscriptions to service_role;
revoke all on function public.resolve_entitlement(text) from public, anon, authenticated;
grant execute on function public.resolve_entitlement(text) to service_role;

comment on function public.resolve_entitlement(text) is
  'Single source of truth for whether a school may perform billable work. past_due is entitled only inside its grace window.';
