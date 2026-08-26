-- Server routes authenticate users with the Supabase secret key and must retain
-- database privileges after the baseline schema's anon/authenticated revocations.
-- This is intentionally service-role only; browser clients remain RLS-restricted.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
