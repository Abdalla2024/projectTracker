-- Nightly reports: one per location per night, filled in by the manager.
--
-- Who sees what (a default to confirm with Ekiben, because reports contain sales):
--   * any active account can submit a report and see and correct the reports it submitted;
--   * admins see and correct every report, and are the only ones who see the dashboard data.
-- Reports are never deleted by the app; a wrong one is corrected.

create table nightly_reports (
  id                     uuid primary key default gen_random_uuid(),
  location_id            uuid not null references locations (id),
  report_date            date not null,
  sales                  numeric(12, 2) not null check (sales >= 0 and sales < 10000000),
  manager_on_duty        text not null check (char_length(btrim(manager_on_duty)) between 1 and 100),
  weather                text not null check (weather in ('sunny', 'partly_cloudy', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'windy')),
  temperature_f          integer not null check (temperature_f between -40 and 130),
  longest_ticket_minutes numeric(5, 1) check (longest_ticket_minutes between 0 and 600),
  general_notes          text not null default '' check (char_length(general_notes) <= 4000),
  customer_feedback      text not null default '' check (char_length(customer_feedback) <= 4000),
  staffing_issues        text not null default '' check (char_length(staffing_issues) <= 4000),
  waste_log              text not null default '' check (char_length(waste_log) <= 4000),
  upcoming_events        text not null default '' check (char_length(upcoming_events) <= 4000),
  submitted_by           uuid not null references profiles (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references profiles (id),
  unique (location_id, report_date)
);
create index nightly_reports_date_idx on nightly_reports (report_date);

alter table nightly_reports enable row level security;
create policy reports_select on nightly_reports for select to tracker_app
  using (app_is_admin() or (submitted_by = app_user_id() and app_is_active()));
create policy reports_insert on nightly_reports for insert to tracker_app
  with check (submitted_by = app_user_id() and app_is_active());
create policy reports_update on nightly_reports for update to tracker_app
  using (app_is_admin() or (submitted_by = app_user_id() and app_is_active()))
  with check (app_is_admin() or (submitted_by = app_user_id() and app_is_active()));

grant select on nightly_reports to tracker_app;
grant insert (location_id, report_date, sales, manager_on_duty, weather, temperature_f, longest_ticket_minutes,
              general_notes, customer_feedback, staffing_issues, waste_log, upcoming_events, submitted_by)
  on nightly_reports to tracker_app;
grant update (location_id, report_date, sales, manager_on_duty, weather, temperature_f, longest_ticket_minutes,
              general_notes, customer_feedback, staffing_issues, waste_log, upcoming_events)
  on nightly_reports to tracker_app;

create function nightly_reports_guard() returns trigger
language plpgsql as $$
begin
  if app_user_id() is null then
    raise exception 'no acting user set; change refused' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.updated_by := null;
    if exists (select 1 from locations where id = new.location_id and archived_at is not null) then
      raise exception 'that location is archived' using errcode = '23514';
    end if;
    return new;
  end if;
  if (new.id, new.submitted_by, new.created_at) is distinct from (old.id, old.submitted_by, old.created_at) then
    raise exception 'the submitter and creation time cannot change' using errcode = '42501';
  end if;
  new.updated_at := now();
  new.updated_by := app_user_id();
  return new;
end $$;
create trigger nightly_reports_guard_trg before insert or update on nightly_reports
  for each row execute function nightly_reports_guard();
