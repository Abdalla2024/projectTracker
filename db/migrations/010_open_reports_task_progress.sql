-- 1) Nightly reports: every active account can read every report (and so the dashboard built on
--    them). Correcting a report is still limited to its submitter or an admin; nobody deletes.
-- 2) Progress follows tasks: when a project has top-level tasks, its progress is the share of them
--    that are done, recalculated by the database on every project update. Task changes already
--    touch their project (tasks_log -> touch_project), so ticking a task off moves the ring.
--    Projects without tasks keep the manual slider value.

drop policy reports_select on nightly_reports;
create policy reports_select on nightly_reports for select to tracker_app using (app_is_active());

create or replace function projects_guard() returns trigger
language plpgsql as $$
declare
  v_total integer;
  v_done  integer;
begin
  if app_user_id() is null then
    raise exception 'no acting user set; change refused' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'id, creator and creation time cannot change' using errcode = '42501';
  end if;
  if new.archived_at is distinct from old.archived_at and not app_is_admin() and old.created_by <> app_user_id() then
    raise exception 'only the creator or an admin can archive a project' using errcode = '42501';
  end if;

  select count(*), count(*) filter (where completed_at is not null) into v_total, v_done
  from tasks where project_id = new.id and parent_id is null;
  if v_total > 0 then
    new.progress := round(100.0 * v_done / v_total)::integer;
  end if;

  new.updated_at := now();
  return new;
end $$;
