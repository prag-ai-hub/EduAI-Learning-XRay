-- M13 — Point every user foreign key at public.users
--
-- The credit ledger and the invitations table reference auth.users(id) while
-- every other table references public.users(id). Since M5 both columns are uuid
-- holding the same values, so nothing is broken today — but the schema has two
-- different parents for "a user", and the next table to be added has to guess
-- which one to follow. M10 adds payments, which would inherit the coin-flip.
--
-- public.users is a profile extension of auth.users: same id, one row each.
-- Making that explicit gives a single spine — auth.users -> public.users ->
-- everything else — and restores the delete cascade end to end, which merely
-- repointing the child tables would have broken.
--
-- Requires M5 (uuid identity).

-- ---------------------------------------------------------------------------
-- Preflight. A profile with no auth record cannot take the new key, and
-- deleting rows to make a migration pass is not this migration's decision.
-- ---------------------------------------------------------------------------
do $$
declare
  orphans   bigint;
  offenders text;
begin
  select count(*), string_agg(u.email, ', ' order by u.email)
    into orphans, offenders
  from public.users u
  left join auth.users a on a.id = u.id
  where a.id is null;

  if orphans > 0 then
    raise exception
      'M13 preflight FAILED: % row(s) in public.users have no auth.users record (%). '
      'These are usually rows seeded directly into the database. Remove them, or '
      'create the matching auth users, before re-running.', orphans, offenders;
  end if;
  raise notice 'M13 preflight passed: every profile has an auth record.';
end $$;

-- ---------------------------------------------------------------------------
-- The spine: a profile belongs to exactly one auth user, and dies with it.
-- ---------------------------------------------------------------------------
alter table public.users drop constraint if exists users_id_auth_fkey;
alter table public.users
  add constraint users_id_auth_fkey
  foreign key (id) references auth.users(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Repoint the two tables that referenced auth.users directly.
--
-- The cascade still reaches them: deleting an auth user removes the profile,
-- which removes the ledger. admin_user_id is set null rather than cascaded — an
-- administrator leaving must not erase the audit trail of credits they granted.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.credit_transactions') is not null then
    execute 'alter table public.credit_transactions drop constraint if exists credit_transactions_user_id_fkey';
    execute 'alter table public.credit_transactions add constraint credit_transactions_user_id_fkey
             foreign key (user_id) references public.users(id) on delete cascade';

    execute 'alter table public.credit_transactions drop constraint if exists credit_transactions_admin_user_id_fkey';
    execute 'alter table public.credit_transactions add constraint credit_transactions_admin_user_id_fkey
             foreign key (admin_user_id) references public.users(id) on delete set null';
  end if;

  if to_regclass('public.invitations') is not null then
    execute 'alter table public.invitations drop constraint if exists invitations_invited_by_fkey';
    execute 'alter table public.invitations add constraint invitations_invited_by_fkey
             foreign key (invited_by) references public.users(id) on delete cascade';
  end if;

  if to_regclass('public.parent_student_links') is not null then
    -- Already correct; asserted so a future edit cannot quietly diverge.
    if not exists (
      select 1 from pg_constraint
      where conname = 'parent_student_links_parent_user_id_fkey'
        and confrelid = 'public.users'::regclass
    ) then
      raise exception 'parent_student_links.parent_user_id must reference public.users';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Post-check: nothing in public may reference auth.users except public.users.
-- ---------------------------------------------------------------------------
do $$
declare stragglers text;
begin
  select string_agg(con.conrelid::regclass::text || '.' || att.attname, ', ')
    into stragglers
  from pg_constraint con
  join lateral unnest(con.conkey) as k(attnum) on true
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where con.contype = 'f'
    and con.confrelid = 'auth.users'::regclass
    and ns.nspname = 'public'
    and rel.relname <> 'users';

  if stragglers is not null then
    raise exception 'M13 post-check FAILED: still referencing auth.users directly: %', stragglers;
  end if;
  raise notice 'M13 complete: public.users is the single parent for user references.';
end $$;
