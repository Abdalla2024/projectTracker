-- Tasks drive the project.
--
-- 1) Status, current phase and progress are computed by the database from the project's top-level
--    tasks on every project change (task changes touch their project):
--      no tasks, or none done      -> not started, 0%
--      some done                   -> in progress
--      all done                    -> done, 100%
--      current phase               -> the first unfinished task, in the order shown (tasks without a
--                                     section first, then each section in order)
--    "Stuck" and "Cancelled" stay manual flags: they cannot be read from tasks. Progress and phase are
--    still computed while a project is flagged.
-- 2) A task can be assigned to several people (task_assignees replaces tasks.assignee_id).
-- 3) Reordering or removing sections re-computes the project too (the current phase depends on it).

alter table projects drop constraint projects_phase_check;
alter table projects add constraint projects_phase_check check (char_length(phase) <= 300);

create or replace function projects_guard() returns trigger
language plpgsql as $$
declare
  v_total integer;
  v_done  integer;
  v_phase text;
begin
  if app_user_id() is null then
    raise exception 'no acting user set; change refused' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at then
      raise exception 'id, creator and creation time cannot change' using errcode = '42501';
    end if;
    if new.archived_at is distinct from old.archived_at and not app_is_admin() and old.created_by <> app_user_id() then
      raise exception 'only the creator or an admin can archive a project' using errcode = '42501';
    end if;
  else
    new.created_at := now();
  end if;

  select count(*), count(*) filter (where completed_at is not null) into v_total, v_done
  from tasks where project_id = new.id and parent_id is null;
  select t.title into v_phase
  from tasks t left join sections s on s.id = t.section_id
  where t.project_id = new.id and t.parent_id is null and t.completed_at is null
  order by (t.section_id is not null), s.sort_order, t.sort_order, t.created_at
  limit 1;

  new.progress := case when v_total = 0 then 0 else round(100.0 * v_done / v_total)::integer end;
  new.phase := coalesce(v_phase, '');
  if new.status not in ('blocked', 'cancelled') then
    new.status := case when v_total > 0 and v_done = v_total then 'done' when v_done > 0 then 'in_progress' else 'not_started' end;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- ---- Several people per task -------------------------------------------------------------------

create table task_assignees (
  task_id     uuid not null references tasks (id) on delete cascade,
  user_id     uuid not null references profiles (id),
  assigned_by uuid not null references profiles (id),
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_assignees_user_idx on task_assignees (user_id);

insert into task_assignees (task_id, user_id, assigned_by)
select id, assignee_id, created_by from tasks where assignee_id is not null;

create function app_can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from tasks t where t.id = p_task and app_can_see_project(t.project_id))
$$;
revoke execute on function app_can_see_task(uuid) from public;
grant execute on function app_can_see_task(uuid) to tracker_app;

alter table task_assignees enable row level security;
create policy task_assignees_select on task_assignees for select to tracker_app using (app_can_see_task(task_id));
create policy task_assignees_insert on task_assignees for insert to tracker_app with check (app_can_see_task(task_id));
create policy task_assignees_delete on task_assignees for delete to tracker_app using (app_can_see_task(task_id));
grant select, delete on task_assignees to tracker_app;
grant insert (task_id, user_id, assigned_by) on task_assignees to tracker_app;

create function task_assignees_guard() returns trigger
language plpgsql as $$
begin
  if app_user_id() is null then
    raise exception 'no acting user set; change refused' using errcode = '42501';
  end if;
  if exists (select 1 from profiles where id = new.user_id and disabled) then
    raise exception 'cannot assign a disabled user' using errcode = '23514';
  end if;
  new.assigned_by := app_user_id();
  new.assigned_at := now();
  return new;
end $$;
create trigger task_assignees_guard_trg before insert on task_assignees
  for each row execute function task_assignees_guard();

create function task_assignees_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_task tasks;
  who text;
begin
  select * into v_task from tasks where id = coalesce(new.task_id, old.task_id);
  if not found then
    return null; -- the task itself is being deleted; that is logged as task_deleted
  end if;
  select display_name into who from profiles where id = coalesce(new.user_id, old.user_id);
  if tg_op = 'INSERT' then
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value, subject_id)
    values (v_task.project_id, app_user_id(), 'task_assigned', 'task', v_task.title, who, v_task.id);
  else
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value, subject_id)
    values (v_task.project_id, app_user_id(), 'task_unassigned', 'task', v_task.title, who, v_task.id);
  end if;
  perform touch_project(v_task.project_id);
  return null;
end $$;
create trigger task_assignees_log_trg after insert or delete on task_assignees
  for each row execute function task_assignees_log();

-- tasks.assignee_id is replaced: guard and log functions no longer use it.
create or replace function tasks_guard() returns trigger
language plpgsql as $$
declare
  v_parent tasks;
begin
  if app_user_id() is null then
    raise exception 'no acting user set; change refused' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (new.id, new.project_id, new.parent_id, new.created_by, new.created_at)
     is distinct from (old.id, old.project_id, old.parent_id, old.created_by, old.created_at) then
    raise exception 'a task cannot move to another project or parent' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.completed_at := null;
    new.completed_by := null;
    if new.parent_id is not null then
      select * into v_parent from tasks where id = new.parent_id;
      if not found or v_parent.project_id <> new.project_id or v_parent.parent_id is not null then
        raise exception 'a subtask must belong to a top-level task of the same project' using errcode = '23514';
      end if;
    end if;
  end if;

  if new.section_id is not null and not exists (select 1 from sections s where s.id = new.section_id and s.project_id = new.project_id) then
    raise exception 'the section belongs to another project' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.completed_at is not null and old.completed_at is null then
      new.completed_at := now();
      new.completed_by := app_user_id();
    elsif new.completed_at is null then
      new.completed_by := null;
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function tasks_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := app_user_id();
begin
  if tg_op = 'INSERT' then
    insert into project_events (project_id, actor_id, event_type, field, new_value, subject_id)
    values (new.project_id, actor, 'task_added', 'task', new.title, new.id);
    perform touch_project(new.project_id);
    return new;
  elsif tg_op = 'DELETE' then
    if exists (select 1 from projects where id = old.project_id) and actor is not null then
      insert into project_events (project_id, actor_id, event_type, field, old_value, subject_id)
      values (old.project_id, actor, 'task_deleted', 'task', old.title, old.id);
      perform touch_project(old.project_id);
    end if;
    return old;
  end if;

  if new.completed_at is not null and old.completed_at is null then
    insert into project_events (project_id, actor_id, event_type, field, new_value, subject_id)
    values (new.project_id, actor, 'task_completed', 'task', new.title, new.id);
  elsif new.completed_at is null and old.completed_at is not null then
    insert into project_events (project_id, actor_id, event_type, field, new_value, subject_id)
    values (new.project_id, actor, 'task_reopened', 'task', new.title, new.id);
  end if;
  perform touch_project(new.project_id);
  return new;
end $$;

alter table tasks drop column assignee_id;

-- Sections: re-computing after a reorder, rename or removal keeps the current phase right.
create function sections_touch() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from projects where id = coalesce(new.project_id, old.project_id)) and app_user_id() is not null then
    perform touch_project(coalesce(new.project_id, old.project_id));
  end if;
  return null;
end $$;
create trigger sections_touch_trg after update or delete on sections
  for each row execute function sections_touch();

alter table project_events drop constraint project_events_event_type_check;
alter table project_events add constraint project_events_event_type_check
  check (event_type in (
    'created', 'updated', 'archived', 'unarchived',
    'assignee_added', 'assignee_removed', 'commented', 'comment_edited', 'comment_deleted',
    'task_added', 'task_completed', 'task_reopened', 'task_deleted', 'task_assigned', 'task_unassigned'))
  not valid;
