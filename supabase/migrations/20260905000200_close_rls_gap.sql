-- M14 — Close an anonymous read/write hole, and make it unrepeatable
--
-- CRITICAL. public.credit_transactions and public.invitations were created in
-- M3 with neither row level security nor a revoke, so Supabase's default
-- privileges left both fully readable AND writable by `anon` and
-- `authenticated` through PostgREST.
--
-- The anon key is public by design: /api/auth/config serves it to every
-- browser. Verified against the local stack before this migration:
--
--   GET    /rest/v1/invitations?select=email,name,role     -> 200, full list
--   GET    /rest/v1/credit_transactions?select=*           -> 200, full ledger
--   DELETE /rest/v1/credit_transactions?amount=lt.0        -> 204, ledger emptied
--
-- So any visitor could read every invited teacher's email address and destroy
-- the entire credit ledger.
--
-- M1 revoked and enabled RLS on the tables it created. M4, M7, M8, M9 and M10
-- each did the same for theirs. M3 is the only migration that did neither, and
-- nothing was checking. The sweep below therefore does not name those two
-- tables: it walks every table in `public` so a future migration that forgets
-- is corrected here rather than shipping another hole.

do $$
declare
  r       record;
  fixed   text[] := '{}';
begin
  for r in
    select c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    -- Every application table is reached through server routes holding the
    -- service-role key. No table is queried directly by a browser, so anon and
    -- authenticated need no privilege on any of them.
    execute format('revoke all on public.%I from anon, authenticated', r.relname);
    execute format('grant all on public.%I to service_role', r.relname);

    if not r.relrowsecurity then
      execute format('alter table public.%I enable row level security', r.relname);
      fixed := fixed || r.relname;
    end if;
  end loop;

  if array_length(fixed, 1) is not null then
    raise notice 'M14: row level security enabled on %', array_to_string(fixed, ', ');
  end if;
end $$;

-- A trigger function needs no direct EXECUTE grant: it runs as the table owner
-- from the trigger, never called by a client.
revoke all on function public.enforce_parent_link_role() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Post-check. Fails the migration rather than leaving a table exposed.
-- ---------------------------------------------------------------------------
do $$
declare
  unprotected text;
  granted     text;
begin
  select string_agg(c.relname, ', ')
    into unprotected
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if unprotected is not null then
    raise exception 'M14 post-check FAILED: no row level security on %', unprotected;
  end if;

  select string_agg(distinct table_name || ' (' || grantee || ')', ', ')
    into granted
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon','authenticated');
  if granted is not null then
    raise exception 'M14 post-check FAILED: anon/authenticated still hold grants on %', granted;
  end if;

  raise notice 'M14 complete: every public table is service-role only, with RLS enabled.';
end $$;
