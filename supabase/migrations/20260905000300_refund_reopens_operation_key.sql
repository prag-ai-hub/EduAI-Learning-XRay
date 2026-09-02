-- M15 — A refunded operation must be chargeable again
--
-- consume_credit decided idempotency by asking "has this operation key ever
-- been charged?". The correct question is "does this operation key currently
-- hold a charge?". refund_credit reverses the charge but leaves the consumption
-- row behind, so the check kept answering yes and the key became permanently
-- free:
--
--   charge  analysis:a1:f1:9999  -> charged=true,  balance 5 -> 4
--   refund  analysis:a1:f1:9999  -> balance 4 -> 5
--   retry   analysis:a1:f1:9999  -> charged=FALSE, balance stays 5
--   retry   analysis:a1:f1:9999  -> charged=FALSE, forever
--
-- /api/grade derives the key from assessment id + file id + OCR hash, so a
-- retry of the same evidence always reproduces the same key. Any analysis that
-- failed once - bad OCR, a provider timeout, an unavailable model - became free
-- for that evidence permanently. With OPENAI_MODEL still defaulting to a model
-- that does not exist, every first attempt fails and refunds, which makes
-- credits unenforceable in the current configuration.
--
-- The two mechanisms were written against different questions and never tested
-- together: idempotency was covered, refunding was covered, the interaction
-- was not.
--
-- Fix: a consumption row records when it was reversed, and only an unreversed
-- consumption blocks a re-charge. The audit trail keeps both rows.

alter table public.credit_transactions add column if not exists refunded_at timestamptz;

-- Backfill: any consumption whose ':refund' counterpart exists is reversed.
update public.credit_transactions c
   set refunded_at = coalesce(r.created_at, now())
  from public.credit_transactions r
 where c.transaction_type = 'consumption'
   and c.refunded_at is null
   and r.transaction_type = 'refund'
   and r.user_id = c.user_id
   and r.operation_key = c.operation_key || ':refund';

-- The old index reserved a key across every transaction type and for all time,
-- which is what made a reversal permanent. Uniqueness is only needed to stop
-- two LIVE charges for one operation.
drop index if exists public.credit_transactions_operation_key_idx;
create unique index if not exists credit_transactions_live_charge_idx
  on public.credit_transactions (user_id, operation_key)
  where transaction_type = 'consumption' and refunded_at is null and operation_key is not null;

create index if not exists credit_transactions_user_created_idx
  on public.credit_transactions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
create or replace function public.consume_credit(
  p_user_id       uuid,
  p_operation_key text,
  p_reference     text default null,
  p_cost          integer default 1
)
returns table(out_total_credits integer, out_used_credits integer, out_remaining_credits integer, out_charged boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
begin
  if p_user_id is null then raise exception 'A user id is required'; end if;
  if p_operation_key is null or length(p_operation_key) < 8 then
    raise exception 'A valid operation key is required';
  end if;
  if p_cost < 1 then raise exception 'Invalid credit cost'; end if;

  -- Taken before the idempotency check so two concurrent requests for the same
  -- operation serialize here rather than both passing the check.
  select u.* into v_user from public.users u where u.id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if v_user.disabled_at is not null or v_user.status <> 'Active' then
    raise exception 'Account disabled';
  end if;

  -- Only an UNREVERSED charge makes this a replay. A refunded operation is
  -- chargeable again, which is what makes a retry after a failure cost a credit.
  if exists (
    select 1 from public.credit_transactions
     where user_id = p_user_id
       and operation_key = p_operation_key
       and transaction_type = 'consumption'
       and refunded_at is null
  ) then
    return query select v_user.total_credits,
                        v_user.used_credits,
                        greatest(0, v_user.total_credits - v_user.used_credits),
                        false;
    return;
  end if;

  if v_user.total_credits - v_user.used_credits < p_cost then
    raise exception 'Insufficient credits';
  end if;

  update public.users u
     set used_credits = u.used_credits + p_cost,
         updated_at   = now()
   where u.id = p_user_id
  returning u.* into v_user;

  insert into public.credit_transactions
    (user_id, amount, transaction_type, operation_key, reference, reason)
  values
    (p_user_id, -p_cost, 'consumption', p_operation_key, p_reference, 'Assessment analysis');

  return query select v_user.total_credits,
                      v_user.used_credits,
                      v_user.total_credits - v_user.used_credits,
                      true;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.refund_credit(
  p_user_id       uuid,
  p_operation_key text,
  p_reason        text default 'Analysis failed'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge public.credit_transactions%rowtype;
begin
  if p_user_id is null or p_operation_key is null then return; end if;

  -- Reverses the live charge, if there is one. Guarding on refunded_at rather
  -- than on the existence of a ':refund' row means a re-charged operation can
  -- be refunded again, which the old guard silently refused.
  select * into v_charge
    from public.credit_transactions
   where user_id = p_user_id
     and operation_key = p_operation_key
     and transaction_type = 'consumption'
     and refunded_at is null
   order by created_at desc
   limit 1
   for update;

  if not found then return; end if;

  update public.credit_transactions
     set refunded_at = now()
   where id = v_charge.id;

  update public.users u
     set used_credits = greatest(0, u.used_credits - abs(v_charge.amount)),
         updated_at   = now()
   where u.id = p_user_id;

  insert into public.credit_transactions
    (user_id, amount, transaction_type, operation_key, reason)
  values
    (p_user_id, abs(v_charge.amount), 'refund', p_operation_key || ':refund', p_reason);
end $$;

revoke all on function public.consume_credit(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.refund_credit(uuid, text, text)           from public, anon, authenticated;
grant execute on function public.consume_credit(uuid, text, text, integer) to service_role;
grant execute on function public.refund_credit(uuid, text, text)           to service_role;

comment on column public.credit_transactions.refunded_at is
  'Set on a consumption row when it is reversed. Only an unreversed consumption blocks a re-charge of the same operation key.';
