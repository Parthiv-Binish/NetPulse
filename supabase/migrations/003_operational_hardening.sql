-- Operational hardening: avoid duplicate active incidents and speed up queues/history.
-- Apply after 001_initial_schema.sql and 002_security_and_dynamic_setup.sql.

create unique index if not exists incidents_one_active_per_device_idx
  on public.incidents(device_id)
  where status in ('open', 'acknowledged');

create index if not exists ping_jobs_running_claimed_idx
  on public.ping_jobs(claimed_at)
  where status = 'running';

create index if not exists maintenance_windows_active_idx
  on public.maintenance_windows(starts_at, ends_at);

alter table public.ping_results
  add constraint ping_results_latency_nonnegative
  check (latency_ms is null or latency_ms >= 0) not valid;
alter table public.ping_results
  validate constraint ping_results_latency_nonnegative;

-- Record incident lifecycle changes for operator auditability. Worker-originated
-- transitions have a NULL actor_id; authenticated operator actions retain auth.uid().
create or replace function private.audit_incident_state_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $fn$
begin
  if old.status is distinct from new.status then
    insert into public.audit_log(actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      'incident.status_changed',
      'incident',
      new.id::text,
      jsonb_build_object(
        'from', old.status::text,
        'to', new.status::text,
        'device_id', new.device_id::text
      )
    );
  end if;
  return new;
end;
$fn$;

revoke all on function private.audit_incident_state_change() from public;
drop trigger if exists incidents_audit_status_change on public.incidents;
create trigger incidents_audit_status_change
  after update of status on public.incidents
  for each row execute function private.audit_incident_state_change();
