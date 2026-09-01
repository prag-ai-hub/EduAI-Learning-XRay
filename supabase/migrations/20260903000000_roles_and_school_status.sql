-- M7 — Four-tier role hierarchy and school lifecycle status
--
-- Introduces SuperAdmin / SchoolAdmin / Teacher / Parent per
-- docs/plan/01-ROLE-PERMISSION-MATRIX.md.
--
-- public.users.role was plain `text` with no constraint at all; the only gate
-- was application code coercing anything that was not 'Admin' to 'Teacher'.
-- The database now enforces the vocabulary.
--
-- Requires M5 (users.id is uuid).
--
-- DEVIATION from docs/plan/03-MIGRATION-PLAN-AND-SEQUENCING.md: that document
-- placed schools.plan_id here. It carries a foreign key to public.plans, which
-- does not exist until M9, so plan_id is added in M9 alongside its target.
-- schools.status lands here as planned.

do $$
begin
  if (select data_type from information_schema.columns
       where table_schema='public' and table_name='users' and column_name='id') <> 'uuid' then
    raise exception 'M7 requires M5 (20260902000000_identity_uuid_unification.sql). public.users.id is not uuid.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Step 1 — Preflight. Refuse to run if the table holds a role we do not know
-- how to migrate, rather than silently coercing real accounts to Teacher.
-- ---------------------------------------------------------------------------
do $$
declare unknown_roles text;
begin
  select string_agg(distinct role, ', ') into unknown_roles
  from public.users
  where role not in ('SuperAdmin','SchoolAdmin','Teacher','Parent','Admin');

  if unknown_roles is not null then
    raise exception
      'M7 preflight FAILED: public.users contains unmapped role value(s): %. '
      'Add an explicit mapping to this migration before re-running.', unknown_roles;
  end if;
  raise notice 'M7 preflight passed: all role values are mappable.';
end $$;

-- ---------------------------------------------------------------------------
-- Step 2 — school_id becomes optional.
-- SuperAdmin belongs to no school, and a Parent's access derives from
-- parent_student_links (M8) rather than from a single school membership.
-- ---------------------------------------------------------------------------
alter table public.users alter column school_id drop not null;

-- `unique (school_id, email)` no longer protects rows where school_id is null,
-- because NULLs compare as distinct. Supabase Auth already enforces unique
-- emails upstream; this is defence in depth for SuperAdmin and Parent rows.
create unique index if not exists users_email_no_school_idx
  on public.users (lower(email)) where school_id is null;

-- ---------------------------------------------------------------------------
-- Step 3 — Migrate existing role values, then constrain the vocabulary.
-- ---------------------------------------------------------------------------
update public.users set role = 'SchoolAdmin', updated_at = now() where role = 'Admin';

-- The seeded platform administrator becomes SuperAdmin. school_id must be
-- cleared in the same statement or the invariant added below rejects the row.
update public.users
   set role = 'SuperAdmin', school_id = null, updated_at = now()
 where lower(email) in ('priyadarshini.adap@eduaihub', 'priyadarshini.adap@eduaihub.in');

alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check
  check (role in ('SuperAdmin','SchoolAdmin','Teacher','Parent'));

-- A SchoolAdmin or Teacher is meaningless without a school; a SuperAdmin or
-- Parent must not be scoped to one. Enforced here rather than in application
-- code, which is what allowed the old role handling to drift.
alter table public.users drop constraint if exists users_role_school_scope_check;
alter table public.users
  add constraint users_role_school_scope_check
  check ((role in ('SchoolAdmin','Teacher')) = (school_id is not null));

-- ---------------------------------------------------------------------------
-- Step 4 — Invitations accept the same vocabulary.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.invitations') is not null then
    execute 'alter table public.invitations drop constraint if exists invitations_role_check';
    execute $c$alter table public.invitations
                 add constraint invitations_role_check
                 check (role in ('SchoolAdmin','Teacher','Parent'))$c$;
    execute $u$update public.invitations set role = 'SchoolAdmin' where role = 'Admin'$u$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Step 5 — School lifecycle status.
--
-- Pending   : registered, awaiting SuperAdmin approval
-- Active    : operating normally
-- Suspended : billing or policy hold - writes blocked, reads preserved
-- Closed    : terminated
--
-- Existing schools are set Active: they predate the approval workflow and must
-- not be locked out by this migration.
-- ---------------------------------------------------------------------------
alter table public.schools add column if not exists status text not null default 'Pending';
update public.schools set status = 'Active', updated_at = now() where status = 'Pending';

alter table public.schools drop constraint if exists schools_status_check;
alter table public.schools
  add constraint schools_status_check
  check (status in ('Pending','Active','Suspended','Closed'));

alter table public.schools add column if not exists approved_at  timestamptz;
alter table public.schools add column if not exists approved_by  uuid references public.users(id);
alter table public.schools add column if not exists suspended_at timestamptz;

create index if not exists schools_status_idx on public.schools(status);

-- ---------------------------------------------------------------------------
-- Step 6 — Time-boxed, audited cross-tenant access for SuperAdmin.
--
-- SuperAdmin reads are de-identified aggregates by default. Reading a named
-- student's work requires an unexpired grant recorded here, and every such read
-- writes an audit_events row. Without this table the permission matrix's
-- cross-tenant rule has nowhere to live.
-- ---------------------------------------------------------------------------
create table if not exists public.support_access_grants (
  id           uuid primary key default gen_random_uuid(),
  school_id    text        not null references public.schools(id),
  granted_to   uuid        not null references public.users(id),
  granted_by   uuid        references public.users(id),
  reason       text        not null check (length(btrim(reason)) >= 10),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists support_access_grants_active_idx
  on public.support_access_grants (granted_to, school_id, expires_at)
  where revoked_at is null;

alter table public.support_access_grants enable row level security;
revoke all on public.support_access_grants from anon, authenticated;
grant all on public.support_access_grants to service_role;

comment on table public.support_access_grants is
  'Time-boxed authorisation for a SuperAdmin to read identifiable data in one school. Expiry is enforced at query time; every read under a grant writes an audit_events row.';

-- ---------------------------------------------------------------------------
-- Step 7 — Post-check.
-- ---------------------------------------------------------------------------
do $$
declare bad bigint;
begin
  select count(*) into bad from public.users
   where role not in ('SuperAdmin','SchoolAdmin','Teacher','Parent');
  if bad > 0 then raise exception 'M7 post-check FAILED: % row(s) hold an invalid role.', bad; end if;

  select count(*) into bad from public.users
   where (role in ('SchoolAdmin','Teacher')) <> (school_id is not null);
  if bad > 0 then raise exception 'M7 post-check FAILED: % row(s) violate the role/school invariant.', bad; end if;

  raise notice 'M7 complete: four-tier roles and school status in place.';
end $$;
