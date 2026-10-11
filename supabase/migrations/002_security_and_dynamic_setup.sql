-- NetPulse V1 hardening: keep authorization helpers out of the exposed API schema,
-- lock their search paths, and avoid a hardcoded tenant/org display name.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

alter function public.is_netpulse_member() set schema private;
alter function public.is_netpulse_admin() set schema private;
alter function public.is_netpulse_operator() set schema private;

alter function private.is_netpulse_member() set search_path = pg_catalog;
alter function private.is_netpulse_admin() set search_path = pg_catalog;
alter function private.is_netpulse_operator() set search_path = pg_catalog;

revoke all on function private.is_netpulse_member() from public;
revoke all on function private.is_netpulse_admin() from public;
revoke all on function private.is_netpulse_operator() from public;
grant execute on function private.is_netpulse_member() to authenticated;
grant execute on function private.is_netpulse_admin() to authenticated;
grant execute on function private.is_netpulse_operator() to authenticated;

-- Existing policies depend on function OIDs and follow the functions when moved.
alter function public.set_updated_at() set search_path = pg_catalog;

alter table public.organization_settings alter column name drop default;
