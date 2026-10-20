-- Hosted-database hardening. Some providers (Supabase, for example) create "API roles" such as
-- anon, authenticated and service_role and give them default privileges on everything an owner
-- creates in the public schema, including EXECUTE on functions. Their public REST/GraphQL APIs run
-- as those roles. Our sign-in logic lives in SECURITY DEFINER functions and trusts its caller to be
-- the app's own restricted role, so none of those roles may reach any of our objects.
--
-- On a database without these roles (local development, plain managed Postgres) this does nothing.
-- It also changes the default privileges so objects created by later migrations are born closed.
-- scripts/lib/migrate.mjs re-checks the result after every setup and fails if anything remains.

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end $$;

-- New functions are executable by everyone (PUBLIC) unless that default is removed, and the API roles
-- inherit it. Make functions created from now on closed by default: a migration must GRANT EXECUTE
-- explicitly (as 002 and 004 do for tracker_app). This is the database-wide form on purpose: a
-- schema-scoped default cannot remove the PUBLIC default for functions.
alter default privileges revoke execute on functions from public;
