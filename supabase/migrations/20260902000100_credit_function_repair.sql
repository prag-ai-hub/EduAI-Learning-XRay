-- M6 — Repair consume_credit / refund_credit
--
-- The functions defined in M3 (20260812000000) cannot execute. Two defects:
--
--   1. app/api/grade/route.ts calls them through getSupabaseServer(), which
--      authenticates with the SERVICE ROLE key. There is no end-user JWT on
--      that connection, so auth.uid() returns NULL and the function raises
--      'Authentication required' on its first line. Every analysis fails.
--
--   2. `where id = auth.uid()` compared public.users.id (text) to auth.uid()
--      (uuid). No such operator exists, so the statement would error even with
--      a user JWT present. M5 fixes the type; this migration fixes the caller
--      contract.
--
-- Fix: the caller supplies the user id explicitly. Requires M5.
--
-- SECURITY: because these functions now trust p_user_id, any role able to call
-- them could charge or refund an arbitrary user. M3 granted EXECUTE to
-- `authenticated`; that grant is revoked here. Only service_role may call them,
-- which is already the only call path in the application.

do $$
begin
  if to_regclass('public.credit_transactions') is null then
    raise exception
      'M6 requires M3 (20260812000000_credits_rbac_invitations.sql). '
      'public.credit_transactions does not exist. Apply M3 first.';
  end if;
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'users' and column_name = 'id') <> 'uuid' then
    raise exception
      'M6 requires M5 (20260902000000_identity_uuid_unification.sql). '
      'public.users.id is not uuid.';
  end if;
end $$;

-- Remove the unusable signatures rather than leaving them callable.
drop function if exists public.consume_credit(text, text, integer);
drop function if exists public.refund_credit(text, text);

create or replace function public.consume_credit(
  p_user_id       uuid,
  p_operation_key text,
  p_reference     text default null,
  p_cost          integer default 1
)
returns table(total_credits integer, used_credits integer, remaining_credits integer, charged boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
begin
  if p_user_id is null then
    raise exception 'A user id is required';
  end if;
  if p_operation_key is null or length(p_operation_key) < 8 then
    raise exception 'A valid operation key is required';
  end if;
  if p_cost < 1 then
    raise exception 'Invalid credit cost';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'User not found';
  end if;
  if v_user.disabled_at is not null or v_user.status <> 'Active' then
    raise exception 'Account disabled';
  end if;

  -- Idempotency: replaying the same operation key never double-charges.
  if exists (
    select 1 from public.credit_transactions
    where user_id = p_user_id and operation_key = p_operation_key
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

  update public.users
     set used_credits = used_credits + p_cost,
         updated_at   = now()
   where id = p_user_id
  returning * into v_user;

  insert into public.credit_transactions
    (user_id, amount, transaction_type, operation_key, reference, reason)
  values
    (p_user_id, -p_cost, 'consumption', p_operation_key, p_reference, 'Assessment analysis');

  return query select v_user.total_credits,
                      v_user.used_credits,
                      v_user.total_credits - v_user.used_credits,
                      true;
end $$;

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
  v_amount integer;
begin
  if p_user_id is null or p_operation_key is null then
    return;
  end if;

  select -amount into v_amount
    from public.credit_transactions
   where user_id = p_user_id
     and operation_key = p_operation_key
     and transaction_type = 'consumption'
   for update;

  -- Nothing was charged, or this operation was already refunded.
  if v_amount is null or exists (
    select 1 from public.credit_transactions
    where user_id = p_user_id and operation_key = p_operation_key || ':refund'
  ) then
    return;
  end if;

  update public.users
     set used_credits = greatest(0, used_credits - v_amount),
         updated_at   = now()
   where id = p_user_id;

  insert into public.credit_transactions
    (user_id, amount, transaction_type, operation_key, reason)
  values
    (p_user_id, v_amount, 'refund', p_operation_key || ':refund', p_reason);
end $$;

-- Server-only. See the SECURITY note at the top of this file.
revoke all on function public.consume_credit(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.refund_credit(uuid, text, text)           from public, anon, authenticated;
grant execute on function public.consume_credit(uuid, text, text, integer) to service_role;
grant execute on function public.refund_credit(uuid, text, text)           to service_role;

comment on function public.consume_credit(uuid, text, text, integer) is
  'Charges one analysis operation to a user. Idempotent on operation_key. service_role only: the caller is trusted to have authenticated p_user_id.';
comment on function public.refund_credit(uuid, text, text) is
  'Reverses a consume_credit charge for a failed analysis. Idempotent. service_role only.';
