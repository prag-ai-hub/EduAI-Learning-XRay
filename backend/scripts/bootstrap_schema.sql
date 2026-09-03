-- Run ONCE per database, before the first `manage.py migrate`.
--
-- Django needs somewhere to keep its own bookkeeping tables
-- (django_migrations, django_content_type, auth_*). Those belong to the
-- framework, not to the product, and must not land beside the application
-- tables that ../../supabase/migrations owns.
--
--   psql "$DATABASE_URL" -f backend/scripts/bootstrap_schema.sql
--
-- settings.base then sets `search_path = django,public`, so Django creates
-- into `django` and still reads the existing `public` tables unqualified.

CREATE SCHEMA IF NOT EXISTS django;

COMMENT ON SCHEMA django IS
  'Django framework bookkeeping only. Application tables live in public and '
  'are owned by supabase/migrations.';
