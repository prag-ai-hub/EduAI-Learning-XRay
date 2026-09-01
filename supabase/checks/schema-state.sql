-- Read-only. Safe to run against production at any time. Changes nothing.
--
-- Reports which migrations are actually applied to THIS database, and whether
-- M5 (identity unification) would pass its preflight. Run it in the Supabase
-- SQL editor before `supabase db push`.
--
-- Read the M5_PREFLIGHT rows first: if any says BLOCKED, do not push.

with uuid_re as (select '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' as re),

migrations as (
  select 'M1 core schema'        as check_name,
         case when to_regclass('public.workspace_snapshots') is not null then 'APPLIED' else 'MISSING' end as status,
         'workspace_snapshots' as detail
  union all
  select 'M2 class master',
         case when exists (select 1 from information_schema.columns
                            where table_schema='public' and table_name='classes' and column_name='class_name')
              then 'APPLIED' else 'MISSING' end,
         'classes.class_name'
  union all
  select 'M3 credits/RBAC',
         case when to_regclass('public.credit_transactions') is not null then 'APPLIED' else 'MISSING' end,
         'credit_transactions + invitations'
  union all
  select 'M4 evaluator grading',
         case when to_regclass('public.evaluation_versions') is not null then 'APPLIED' else 'MISSING' end,
         'evaluation_versions'
  union all
  select 'M5 identity uuid',
         case when (select data_type from information_schema.columns
                     where table_schema='public' and table_name='users' and column_name='id') = 'uuid'
              then 'APPLIED' else 'PENDING' end,
         'public.users.id type = ' || coalesce((select data_type from information_schema.columns
                     where table_schema='public' and table_name='users' and column_name='id'), 'TABLE MISSING')
  union all
  select 'M6 credit repair',
         case when exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='consume_credit'
             and pg_get_function_identity_arguments(p.oid) like 'uuid,%'
         ) then 'APPLIED' else 'PENDING' end,
         coalesce((select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ' | ')
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname='public' and p.proname in ('consume_credit','refund_credit')),
                  'neither function exists')
),

-- Does any value fail the UUID shape M5 requires?
preflight as (
  select 'M5_PREFLIGHT public.users.id' as check_name,
         case when to_regclass('public.users') is null then 'N/A'
              when (select data_type from information_schema.columns
                     where table_schema='public' and table_name='users' and column_name='id') = 'uuid' then 'ALREADY UUID'
              when (select count(*) from public.users, uuid_re where id is not null and id !~ re) > 0 then 'BLOCKED'
              else 'READY' end as status,
         coalesce((select count(*)::text from public.users, uuid_re where id is not null and id !~ re), '0')
           || ' non-UUID row(s) of '
           || coalesce((select count(*)::text from public.users), '0') as detail
),

-- Columns that will be converted alongside users.id.
dependents as (
  select 'M5_DEPENDENT ' || con.conrelid::regclass::text || '.' || att.attname as check_name,
         case when att.atttypid = 'uuid'::regtype then 'ALREADY UUID' else 'WILL CONVERT' end as status,
         'via constraint ' || con.conname as detail
  from pg_constraint con
  join lateral unnest(con.conkey) as k(attnum) on true
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
  where con.contype = 'f' and con.confrelid = 'public.users'::regclass
),

-- Who can currently execute the credit functions. After M6 this must be
-- service_role only; `authenticated` appearing here is a privilege-escalation risk.
grants as (
  select 'GRANTS ' || p.proname as check_name,
         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'RISK: authenticated can execute' else 'service_role only' end as status,
         pg_get_function_identity_arguments(p.oid) as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('consume_credit','refund_credit')
),

-- Rows that would fail M5's auth.users cross-check (warning, not fatal).
orphans as (
  select 'ORPHAN users without auth record' as check_name,
         case when to_regclass('public.users') is null then 'N/A'
              when (select count(*) from public.users u
                     left join auth.users a on a.id::text = u.id::text where a.id is null) > 0
              then 'REVIEW' else 'OK' end as status,
         coalesce((select count(*)::text from public.users u
                    left join auth.users a on a.id::text = u.id::text where a.id is null), '0')
           || ' orphan row(s)' as detail
)

select * from migrations
union all select * from preflight
union all select * from dependents
union all select * from grants
union all select * from orphans
order by check_name;
