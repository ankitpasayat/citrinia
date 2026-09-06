-- The service role is Supabase's server-side key: it must bypass row-level
-- security, which it can only do if it also holds the table privileges. This
-- project's tables were granted only to anon and authenticated, so the seeding
-- importer (and any future server job using the secret key) got 42501.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Tables created by later migrations get the same grants automatically.
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
