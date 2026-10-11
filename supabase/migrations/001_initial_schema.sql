-- NetPulse V1 initial schema. Apply only to a dedicated NetPulse Supabase project.
create extension if not exists pgcrypto;

create type public.netpulse_target_type as enum ('public', 'private');
create type public.netpulse_status as enum ('up', 'down', 'unknown', 'maintenance');
create type public.netpulse_incident_status as enum ('open', 'acknowledged', 'resolved');

create table public.organization_settings (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Organization',
  timezone text not null default 'UTC',
  default_interval_seconds integer not null default 60 check (default_interval_seconds between 15 and 3600),
  ping_attempts integer not null default 3 check (ping_attempts between 1 and 5),
  ping_timeout_seconds integer not null default 2 check (ping_timeout_seconds between 1 and 5),
  history_retention_days integer not null default 30 check (history_retention_days between 1 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('admin','operator','viewer')),
  created_at timestamptz not null default now()
);
alter table public.organization_members enable row level security;
create policy "members can read own membership" on public.organization_members for select to authenticated using (user_id = auth.uid());

create or replace function public.is_netpulse_member()
returns boolean language sql stable security definer set search_path = public
as $fn$ select exists (select 1 from public.organization_members where user_id = auth.uid()) $fn$;
create or replace function public.is_netpulse_admin()
returns boolean language sql stable security definer set search_path = public
as $fn$ select exists (select 1 from public.organization_members where user_id = auth.uid() and role = 'admin') $fn$;

create or replace function public.is_netpulse_operator()
returns boolean language sql stable security definer set search_path = public
as $fn$ select exists (select 1 from public.organization_members where user_id = auth.uid() and role in ('admin','operator')) $fn$;

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  location_type text not null default 'other' check (length(location_type) <= 60),
  parent_id uuid references public.locations(id) on delete restrict,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index locations_parent_id_idx on public.locations(parent_id);

create table public.monitoring_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_id uuid references public.locations(id) on delete set null,
  token_hash text not null,
  version text,
  status text not null default 'unknown' check (status in ('online','offline','unknown')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  host text not null check (length(trim(host)) between 1 and 253),
  target_type public.netpulse_target_type not null default 'public',
  location_id uuid references public.locations(id) on delete set null,
  agent_id uuid references public.monitoring_agents(id) on delete set null,
  category text not null default 'Other',
  enabled boolean not null default true,
  interval_seconds integer not null default 60 check (interval_seconds between 15 and 3600),
  current_status public.netpulse_status not null default 'unknown',
  current_latency_ms numeric(10,2),
  current_packet_loss integer not null default 100 check (current_packet_loss between 0 and 100),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (host, location_id)
);
create index devices_enabled_type_idx on public.devices(enabled, target_type);
create index devices_location_id_idx on public.devices(location_id);
create index devices_agent_id_idx on public.devices(agent_id);

create table public.ping_results (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  checked_at timestamptz not null default now(),
  success boolean not null,
  latency_ms numeric(10,2),
  packet_loss integer not null default 100 check (packet_loss between 0 and 100),
  error text,
  source text not null default 'render' check (source in ('render','agent','manual')),
  agent_id uuid references public.monitoring_agents(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ping_results_device_time_idx on public.ping_results(device_id, checked_at desc);
create index ping_results_checked_at_idx on public.ping_results(checked_at desc);

create table public.ping_jobs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  requested_by text,
  status text not null default 'queued' check (status in ('queued','running','complete','failed')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  error text
);
create index ping_jobs_queue_idx on public.ping_jobs(status, created_at) where status = 'queued';

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  title text not null,
  severity text not null default 'critical' check (severity in ('critical','warning')),
  status public.netpulse_incident_status not null default 'open',
  started_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index incidents_status_started_idx on public.incidents(status, started_at desc);

create table public.maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location_id uuid references public.locations(id) on delete cascade,
  device_id uuid references public.devices(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (location_id is not null or device_id is not null)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_at_idx on public.audit_log(created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger locations_set_updated_at before update on public.locations for each row execute function public.set_updated_at();
create trigger devices_set_updated_at before update on public.devices for each row execute function public.set_updated_at();
create trigger settings_set_updated_at before update on public.organization_settings for each row execute function public.set_updated_at();

-- Single-organization V1: authenticated members can use the application.
-- Service role is reserved for trusted server workers; never expose it in browser code.
alter table public.organization_settings enable row level security;
alter table public.locations enable row level security;
alter table public.monitoring_agents enable row level security;
alter table public.devices enable row level security;
alter table public.ping_results enable row level security;
alter table public.ping_jobs enable row level security;
alter table public.incidents enable row level security;
alter table public.maintenance_windows enable row level security;
alter table public.audit_log enable row level security;

create policy "authenticated read settings" on public.organization_settings for select to authenticated using (public.is_netpulse_member());
create policy "authenticated update settings" on public.organization_settings for update to authenticated using (public.is_netpulse_admin()) with check (public.is_netpulse_admin());
create policy "authenticated read locations" on public.locations for select to authenticated using (public.is_netpulse_member());
create policy "authenticated manage locations" on public.locations for all to authenticated using (public.is_netpulse_operator()) with check (public.is_netpulse_operator());
create policy "authenticated read agents" on public.monitoring_agents for select to authenticated using (public.is_netpulse_member());
create policy "authenticated read devices" on public.devices for select to authenticated using (public.is_netpulse_member());
create policy "authenticated manage devices" on public.devices for all to authenticated using (public.is_netpulse_operator()) with check (public.is_netpulse_operator());
create policy "authenticated read results" on public.ping_results for select to authenticated using (public.is_netpulse_member());
create policy "authenticated read jobs" on public.ping_jobs for select to authenticated using (public.is_netpulse_member());
create policy "authenticated create jobs" on public.ping_jobs for insert to authenticated with check (public.is_netpulse_operator());
create policy "authenticated read incidents" on public.incidents for select to authenticated using (public.is_netpulse_member());
create policy "authenticated update incidents" on public.incidents for update to authenticated using (public.is_netpulse_operator()) with check (public.is_netpulse_operator());
create policy "authenticated read maintenance" on public.maintenance_windows for select to authenticated using (public.is_netpulse_member());
create policy "authenticated manage maintenance" on public.maintenance_windows for all to authenticated using (public.is_netpulse_operator()) with check (public.is_netpulse_operator());
create policy "authenticated read audit log" on public.audit_log for select to authenticated using (public.is_netpulse_member());

-- The organization has one default settings row. Adjust the name after provisioning.
insert into public.organization_settings(name) values ('My Organization');

-- V1 uses an explicit membership allowlist. Add each trusted Auth user to organization_members.
-- Disable public sign-ups. Admins can manage inventory; operators can edit inventory and incidents;
-- viewers have read-only access. Service-role workers bypass RLS and must keep secrets server-side.
