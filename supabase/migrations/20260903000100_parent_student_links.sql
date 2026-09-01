-- M8 — Parent accounts: linking a parent to a child
--
-- A Parent has no school membership. Their access derives entirely from the
-- links recorded here, which is what makes "a parent sees only their own
-- children" enforceable rather than a UI convention.
--
-- Requires M5 (uuid identity) and M7 (the Parent role exists).
--
-- Linking is invite-code based, matching the Day 13/15 "Invite parent" task: a
-- teacher or school admin issues a code for one student, and the parent redeems
-- it after signing up. A parent is never able to name a child directly, so no
-- one can attach themselves to a student they were not given access to.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_role_check' and conrelid = 'public.users'::regclass
  ) then
    raise exception 'M8 requires M7 (20260903000000_roles_and_school_status.sql).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Invite codes. One code, one student, short-lived, single-use by default.
-- ---------------------------------------------------------------------------
create table if not exists public.parent_invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text        not null unique check (code ~ '^[A-Z0-9]{6,12}$'),
  school_id   text        not null references public.schools(id),
  student_id  text        not null references public.students(id) on delete cascade,
  created_by  uuid        not null references public.users(id),
  -- Optional: pre-bind the code to one address so a leaked code is unusable by
  -- anyone else. Null means any parent holding the code may redeem it.
  email       text,
  relationship text       not null default 'Guardian'
                          check (relationship in ('Mother','Father','Guardian')),
  max_uses    integer     not null default 1 check (max_uses between 1 and 5),
  used_count  integer     not null default 0 check (used_count >= 0),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (used_count <= max_uses),
  check (expires_at > created_at)
);

create index if not exists parent_invite_codes_student_idx on public.parent_invite_codes(student_id);
create index if not exists parent_invite_codes_open_idx
  on public.parent_invite_codes (code)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- The link itself. This is the authorisation record every parent-facing query
-- joins through.
--
-- school_id is denormalised from the student so a parent with children at more
-- than one school is a natural case rather than a special one, and so tenant
-- scoping never has to walk back through students.
-- ---------------------------------------------------------------------------
create table if not exists public.parent_student_links (
  id             uuid primary key default gen_random_uuid(),
  parent_user_id uuid        not null references public.users(id) on delete cascade,
  student_id     text        not null references public.students(id) on delete cascade,
  school_id      text        not null references public.schools(id),
  relationship   text        not null default 'Guardian'
                             check (relationship in ('Mother','Father','Guardian')),
  status         text        not null default 'active'
                             check (status in ('active','revoked')),
  linked_via     text        not null default 'invite_code'
                             check (linked_via in ('invite_code','admin')),
  invite_code_id uuid        references public.parent_invite_codes(id),
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     uuid        references public.users(id),
  unique (parent_user_id, student_id)
);

create index if not exists parent_student_links_parent_idx
  on public.parent_student_links (parent_user_id) where status = 'active';
create index if not exists parent_student_links_student_idx
  on public.parent_student_links (student_id) where status = 'active';
create index if not exists parent_student_links_school_idx
  on public.parent_student_links (school_id);

-- Only a Parent may sit on the parent side of a link. Enforced with a trigger
-- because a CHECK constraint cannot read another table.
create or replace function public.enforce_parent_link_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  select role into v_role from public.users where id = new.parent_user_id;
  if v_role is null then
    raise exception 'parent_student_links.parent_user_id % has no profile', new.parent_user_id;
  end if;
  if v_role <> 'Parent' then
    raise exception 'parent_student_links.parent_user_id % has role %, expected Parent', new.parent_user_id, v_role;
  end if;
  return new;
end $$;

drop trigger if exists parent_student_links_role_check on public.parent_student_links;
create trigger parent_student_links_role_check
  before insert or update of parent_user_id on public.parent_student_links
  for each row execute function public.enforce_parent_link_role();

-- ---------------------------------------------------------------------------
-- Redemption. Kept server-side and atomic so a code cannot be spent twice by
-- two concurrent requests, and so the caller never chooses the student.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_parent_invite_code(
  p_parent_user_id uuid,
  p_code           text
)
returns table(link_id uuid, student_id text, school_id text, relationship text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code   public.parent_invite_codes%rowtype;
  v_link   public.parent_student_links%rowtype;
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
  -- if the code has since been exhausted or expired. Checking exhaustion before
  -- this made the second call error with 'already been used', which defeats the
  -- purpose of the idempotent path.
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

-- Server-only: the function trusts p_parent_user_id, exactly as consume_credit
-- does. Letting `authenticated` call it would let any signed-in user link
-- themselves to a child by redeeming a code on someone else's behalf.
revoke all on function public.redeem_parent_invite_code(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_parent_invite_code(uuid, text) to service_role;

alter table public.parent_invite_codes   enable row level security;
alter table public.parent_student_links  enable row level security;
revoke all on public.parent_invite_codes, public.parent_student_links from anon, authenticated;
grant all  on public.parent_invite_codes, public.parent_student_links to service_role;

comment on table public.parent_student_links is
  'Authorisation record for parent access. Every parent-facing query joins through this table; there is no other path to a student.';
comment on function public.redeem_parent_invite_code(uuid, text) is
  'Atomically redeems an invite code into a parent-student link. service_role only. Re-redemption is idempotent.';
