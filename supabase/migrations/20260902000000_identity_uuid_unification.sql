-- M5 — Identity unification: public.users.id text -> uuid
--
-- Why: public.users.id is text while auth.users.id is uuid. Every comparison
-- of the form `users.id = auth.uid()` therefore has no operator and errors at
-- runtime. This already breaks consume_credit/refund_credit (see M6), and would
-- propagate into every table the payment and parent-portal work adds.
--
-- Scope: user identity only. public.schools.id deliberately STAYS text — its
-- values are 'school-{uuid}' strings that are not valid UUIDs and are embedded
-- in every teacher's workspace_snapshots.state_json blob. Schools are never
-- compared to auth.uid(), so converting them would be risk without benefit.
--
-- This migration discovers its own targets from pg_constraint rather than
-- hardcoding a table list, so it is correct whether or not M4
-- (evaluator grading foundation) has been applied to this database.
--
-- Reversible: the uuid -> text cast back is lossless. Take a backup first.

-- ---------------------------------------------------------------------------
-- Step 1 — Preflight. Refuse to run unless every affected value is a real UUID.
-- A partial cast is unrecoverable, so this aborts the whole migration.
-- ---------------------------------------------------------------------------
do $$
declare
  r      record;
  bad    bigint;
  total  integer := 0;
  uuid_re constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- The parent column.
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'users' and column_name = 'id') = 'text' then
    execute format(
      'select count(*) from public.users where id is not null and id !~ %L', uuid_re
    ) into bad;
    if bad > 0 then
      raise exception
        'M5 preflight FAILED: public.users.id has % row(s) that are not UUIDs. '
        'Inspect with: select id, email from public.users where id !~ ''%'' ; '
        'Resolve those rows before re-running this migration.', bad, uuid_re;
    end if;
    total := total + 1;
  end if;

  -- Every column that currently points at public.users(id).
  for r in
    select con.conrelid::regclass::text as tbl, att.attname as col
    from pg_constraint con
    join lateral unnest(con.conkey) as k(attnum) on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and con.confrelid = 'public.users'::regclass
  loop
    execute format(
      'select count(*) from %s where %I is not null and %I::text !~ %L',
      r.tbl, r.col, r.col, uuid_re
    ) into bad;
    if bad > 0 then
      raise exception
        'M5 preflight FAILED: %.% has % row(s) that are not UUIDs.', r.tbl, r.col, bad;
    end if;
    total := total + 1;
  end loop;

  raise notice 'M5 preflight passed: % column(s) hold only UUID-shaped values.', total;
end $$;

-- ---------------------------------------------------------------------------
-- Step 2 — Drop dependent foreign keys, convert every column, restore the keys.
--
-- Constraint definitions are captured with pg_get_constraintdef before dropping
-- and replayed verbatim afterwards, so any ON DELETE / ON UPDATE behaviour that
-- exists in this database is preserved exactly rather than assumed.
-- ---------------------------------------------------------------------------
do $$
declare
  r        record;
  replay   text[] := '{}';
  children text[][] := '{}';
  stmt     text;
  i        integer;
begin
  for r in
    select con.conname,
           con.conrelid::regclass::text as tbl,
           att.attname                  as col,
           pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join lateral unnest(con.conkey) as k(attnum) on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and con.confrelid = 'public.users'::regclass
    order by con.conrelid::regclass::text, att.attname
  loop
    replay   := replay   || format('alter table %s add constraint %I %s', r.tbl, r.conname, r.def);
    children := children || array[array[r.tbl, r.col]];
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    raise notice 'M5: dropped FK % on %.%', r.conname, r.tbl, r.col;
  end loop;

  -- Parent first: the primary key index is rebuilt automatically.
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'users' and column_name = 'id') = 'text' then
    execute 'alter table public.users alter column id type uuid using id::uuid';
    raise notice 'M5: public.users.id -> uuid';
  else
    raise notice 'M5: public.users.id is already uuid, skipping';
  end if;

  -- Then every child column that referenced it.
  if array_length(children, 1) is not null then
    for i in 1 .. array_length(children, 1) loop
      execute format(
        'alter table %s alter column %I type uuid using %I::uuid',
        children[i][1], children[i][2], children[i][2]
      );
      raise notice 'M5: %.% -> uuid', children[i][1], children[i][2];
    end loop;
  end if;

  foreach stmt in array replay loop
    execute stmt;
    raise notice 'M5: restored %', stmt;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Step 3 — Post-check. Fail loudly rather than leave a half-converted schema.
-- ---------------------------------------------------------------------------
do $$
declare
  wrong_type bigint;
  orphans    bigint;
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'users' and column_name = 'id') <> 'uuid' then
    raise exception 'M5 post-check FAILED: public.users.id is not uuid.';
  end if;

  select count(*) into wrong_type
  from pg_constraint con
  join lateral unnest(con.conkey) as k(attnum) on true
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
  where con.contype = 'f'
    and con.confrelid = 'public.users'::regclass
    and att.atttypid <> 'uuid'::regtype;
  if wrong_type > 0 then
    raise exception 'M5 post-check FAILED: % referencing column(s) are still not uuid.', wrong_type;
  end if;

  -- Every application user should now resolve against Supabase Auth. A non-zero
  -- count is not fatal (an operator may have seeded rows), but it must be seen.
  select count(*) into orphans
  from public.users u
  left join auth.users a on a.id = u.id
  where a.id is null;
  if orphans > 0 then
    raise warning 'M5: % row(s) in public.users have no matching auth.users record.', orphans;
  end if;

  raise notice 'M5 complete: identity unified on uuid.';
end $$;
