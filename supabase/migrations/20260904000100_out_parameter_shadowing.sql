-- Eliminates a defect class, not a single bug.
--
-- A plpgsql function declared `returns table(...)` turns each OUT name into a
-- variable in the function's scope. Where that name also names a column of a
-- table the function touches, a bare reference is ambiguous and the function
-- fails at RUNTIME - it compiles and deploys perfectly happily.
--
-- This has now bitten twice:
--   M3  consume_credit           'column reference "used_credits" is ambiguous'
--                                - every credit charge failed, unreachable
--                                  behind the auth.uid() defect until M6.
--   M11 publish_student_result   'column reference "assessment_id" is ambiguous'
--                                - caught only because the migration was run
--                                  against a real database with seeded rows.
--
-- Qualification fixes most sites, but NOT all: the column list in
-- ON CONFLICT (...) cannot be table-qualified, so there is no way to
-- disambiguate it. The only reliable fix is for OUT names never to collide.
--
-- Convention adopted here and enforced by tests/migration-contract.test.mjs:
--   every OUT parameter of a table-returning function is prefixed `out_`.
--
-- An audit of the schema found two functions still carrying colliding names.
-- Neither is currently broken - every reference in them happens to be
-- qualified - but both are one careless edit away from the same failure.
--
-- OUT parameter names cannot be changed by CREATE OR REPLACE, so each function
-- is dropped and recreated. Grants are reapplied below.

-- ---------------------------------------------------------------------------
-- consume_credit: total_credits and used_credits shadow columns of public.users
-- ---------------------------------------------------------------------------
drop function if exists public.consume_credit(uuid, text, text, integer);

create function public.consume_credit(
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
  if p_user_id is null then
    raise exception 'A user id is required';
  end if;
  if p_operation_key is null or length(p_operation_key) < 8 then
    raise exception 'A valid operation key is required';
  end if;
  if p_cost < 1 then
    raise exception 'Invalid credit cost';
  end if;

  select u.* into v_user from public.users u where u.id = p_user_id for update;
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
-- redeem_parent_invite_code: student_id, school_id and relationship shadow
-- columns of parent_student_links and parent_invite_codes. school_id alone
-- collides with fifteen tables.
-- ---------------------------------------------------------------------------
drop function if exists public.redeem_parent_invite_code(uuid, text);

create function public.redeem_parent_invite_code(
  p_parent_user_id uuid,
  p_code           text
)
returns table(out_link_id uuid, out_student_id text, out_school_id text, out_relationship text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.parent_invite_codes%rowtype;
  v_link public.parent_student_links%rowtype;
begin
  if p_parent_user_id is null or p_code is null then
    raise exception 'A parent id and code are required';
  end if;

  select * into v_code
    from public.parent_invite_codes c
   where c.code = upper(btrim(p_code))
   for update;

  if not found                     then raise exception 'This invite code is not valid'; end if;
  if v_code.revoked_at is not null then raise exception 'This invite code has been revoked'; end if;

  -- Idempotency comes FIRST. A parent who already holds this link has already
  -- been authorised, so retrying must return that link rather than fail - even
  -- if the code has since been exhausted or expired.
  select * into v_link
    from public.parent_student_links l
   where l.parent_user_id = p_parent_user_id and l.student_id = v_code.student_id;

  if found then
    if v_link.status = 'revoked' then
      update public.parent_student_links
         set status = 'active', revoked_at = null, revoked_by = null
       where id = v_link.id
      returning * into v_link;
    end if;
    return query select v_link.id, v_link.student_id, v_link.school_id, v_link.relationship;
    return;
  end if;

  -- Only a genuinely new link consumes the code.
  if v_code.expires_at <= now()           then raise exception 'This invite code has expired'; end if;
  if v_code.used_count >= v_code.max_uses then raise exception 'This invite code has already been used'; end if;

  if v_code.email is not null
     and lower(v_code.email) <> (select lower(email) from public.users where id = p_parent_user_id) then
    raise exception 'This invite code was issued to a different email address';
  end if;

  insert into public.parent_student_links
    (parent_user_id, student_id, school_id, relationship, linked_via, invite_code_id)
  values
    (p_parent_user_id, v_code.student_id, v_code.school_id, v_code.relationship, 'invite_code', v_code.id)
  returning * into v_link;

  update public.parent_invite_codes
     set used_count = used_count + 1
   where id = v_code.id;

  return query select v_link.id, v_link.student_id, v_link.school_id, v_link.relationship;
end $$;

revoke all on function public.consume_credit(uuid, text, text, integer)  from public, anon, authenticated;
revoke all on function public.redeem_parent_invite_code(uuid, text)      from public, anon, authenticated;
grant execute on function public.consume_credit(uuid, text, text, integer) to service_role;
grant execute on function public.redeem_parent_invite_code(uuid, text)     to service_role;

comment on function public.consume_credit(uuid, text, text, integer) is
  'Charges one analysis operation to a user. Idempotent on operation_key. service_role only. OUT names are out_-prefixed so they cannot shadow columns of public.users.';
comment on function public.redeem_parent_invite_code(uuid, text) is
  'Atomically redeems an invite code into a parent-student link. service_role only. Re-redemption is idempotent. OUT names are out_-prefixed so they cannot shadow columns.';
