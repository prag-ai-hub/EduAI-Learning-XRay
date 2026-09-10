-- M18 — a revoked parent link must not be restored by a stale invite code
--
-- Revoking a parent-student link is the only mechanism anyone has for ending a
-- parent's access to a child. It is a safeguarding action: a custody order, a
-- parent removed from a child's life, an account handed to the wrong person.
--
-- M8's redeem function undid it. The idempotency branch ran FIRST and, on
-- finding an existing link, reactivated it when it was revoked and returned
-- immediately - before the expiry check, before the used_count check, and
-- before the email binding. So a parent who kept any old code could restore
-- access the school had deliberately withdrawn, using a code that was expired,
-- already spent, or issued to somebody else's address entirely.
--
-- The comment there read "A parent who already holds this link has already been
-- authorised". That is true of an ACTIVE link and exactly backwards for a
-- revoked one, where authorisation is the thing that was taken away.
--
-- So the two cases separate:
--
--   * an ACTIVE link is a retry. Return it unchanged, consuming nothing, even
--     if the code has since expired - that is what makes redemption idempotent,
--     and it is unaffected by this change.
--   * a REVOKED link is a new authorisation. It now requires a fully valid
--     code - unexpired, unexhausted, matching the bound email - and consumes a
--     use, exactly like a first-time link. A school that revoked in error
--     issues a fresh code; the parent's old one no longer does anything.
--
-- The signature, the out_-prefixed OUT names and the service_role-only grant
-- are all unchanged from M8.

create or replace function public.redeem_parent_invite_code(
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

  select * into v_link
    from public.parent_student_links l
   where l.parent_user_id = p_parent_user_id and l.student_id = v_code.student_id;

  -- A live link is a retry: already authorised, nothing to re-check, no use
  -- consumed. A revoked one falls through to the validity checks below.
  if found and v_link.status <> 'revoked' then
    return query select v_link.id, v_link.student_id, v_link.school_id, v_link.relationship;
    return;
  end if;

  if v_code.expires_at <= now()           then raise exception 'This invite code has expired'; end if;
  if v_code.used_count >= v_code.max_uses then raise exception 'This invite code has already been used'; end if;

  if v_code.email is not null
     and lower(v_code.email) <> (select lower(email) from public.users where id = p_parent_user_id) then
    raise exception 'This invite code was issued to a different email address';
  end if;

  if found then
    -- Restoring withdrawn access. Reached only with a code that has just passed
    -- every check a first-time link passes, and it spends a use like one.
    update public.parent_student_links
       set status = 'active', revoked_at = null, revoked_by = null
     where id = v_link.id
    returning * into v_link;
  else
    insert into public.parent_student_links
      (parent_user_id, student_id, school_id, relationship, linked_via, invite_code_id)
    values
      (p_parent_user_id, v_code.student_id, v_code.school_id, v_code.relationship, 'invite_code', v_code.id)
    returning * into v_link;
  end if;

  update public.parent_invite_codes
     set used_count = used_count + 1
   where id = v_code.id;

  return query select v_link.id, v_link.student_id, v_link.school_id, v_link.relationship;
end $$;

comment on function public.redeem_parent_invite_code(uuid, text) is
  'Atomically redeems an invite code into a parent-student link. service_role only. Retrying an ACTIVE link is idempotent; restoring a REVOKED one requires a fully valid, unspent code and consumes a use. OUT names are out_-prefixed so they cannot shadow columns.';
