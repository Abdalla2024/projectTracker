-- Shared workspace, Asana-style.
--
-- 1) Visibility: every active (not disabled) account sees every project, its comments, tasks and
--    history. Anyone active can create projects, edit them, and assign people. Archiving stays with
--    the project's creator or an admin. Roles still come only from admin_emails.
-- 2) Organisation: admin-managed locations (stores) and teams (positions/departments). A project can
--    belong to one of each.
-- 3) Work inside a project: sections and tasks, with one level of subtasks. Task changes that matter
--    (added, completed, reopened, deleted, assigned) are recorded in the project's append-only history.

-- ---- 1. Visibility -----------------------------------------------------------------------------

create or replace function app_project_visible(p_id uuid, p_creator uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app_is_active()
$$;

create or replace function app_can_see_profile(p_uid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app_is_active()
$$;

-- Anyone active may assign; disabled people cannot be assigned.
create or replace function project_assignees_guard() returns trigger
language plpgsql as $$
begin
  if not app_is_active() then
    raise exception 'no active user; change refused' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from profiles where id = new.user_id and disabled) then
      raise exception 'cannot assign a disabled user' using errcode = '23514';
    end if;
    new.assigned_by := app_user_id();
    new.assigned_at := now();
    return new;
  end if;
  return old;
end $$;

drop policy assignees_insert on project_assignees;
drop policy assignees_delete on project_assignees;
create policy assignees_insert on project_assignees for insert to tracker_app
  with check (app_can_see_project(project_id));
create policy assignees_delete on project_assignees for delete to tracker_app
  using (app_can_see_project(project_id));

-- ---- 2. Locations and teams --------------------------------------------------------------------

create table locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(btrim(name)) between 1 and 60),
  color       text not null default '#2a78d6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order  integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(btrim(name)) between 1 and 60),
  color       text not null default '#6250d6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order  integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
alter table locations enable row level security;
alter table teams enable row level security;
create policy locations_select on locations for select to tracker_app using (app_is_active());
create policy locations_insert on locations for insert to tracker_app with check (app_is_admin());
create policy locations_update on locations for update to tracker_app using (app_is_admin()) with check (app_is_admin());
create policy teams_select on teams for select to tracker_app using (app_is_active());
create policy teams_insert on teams for insert to tracker_app with check (app_is_admin());
create policy teams_update on teams for update to tracker_app using (app_is_admin()) with check (app_is_admin());
grant select on locations, teams to tracker_app;
grant insert (name, color, sort_order) on locations, teams to tracker_app;
grant update (name, color, sort_order, archived_at) on locations, teams to tracker_app;

alter table projects add column location_id uuid references locations (id);
alter table projects add column team_id     uuid references teams (id);
create index projects_location_idx on projects (location_id);
create index projects_team_idx on projects (team_id);
grant insert (location_id, team_id) on projects to tracker_app;
grant update (location_id, team_id) on projects to tracker_app;

-- Anyone active may edit a project; only its creator or an admin may archive or restore it.
create or replace function projects_guard() returns trigger
language plpgsql as $$
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

  new.updated_at := now();
  return new;
end $$;

-- History for location and team changes (names, so the log stays readable after a rename).
create function projects_org_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := app_user_id();
begin
  if new.location_id is distinct from old.location_id then
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value)
    values (new.id, actor, 'updated', 'location',
            (select name from locations where id = old.location_id), (select name from locations where id = new.location_id));
  end if;
  if new.team_id is distinct from old.team_id then
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value)
    values (new.id, actor, 'updated', 'team',
            (select name from teams where id = old.team_id), (select name from teams where id = new.team_id));
  end if;
  return new;
end $$;
create trigger projects_org_log_trg after update on projects
  for each row execute function projects_org_log();

-- ---- 3. Sections and tasks ---------------------------------------------------------------------

create table sections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  sort_order  double precision not null default 0,
  created_at  timestamptz not null default now()
);
create index sections_project_idx on sections (project_id, sort_order);

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects (id),
  section_id   uuid references sections (id) on delete set null,
  parent_id    uuid references tasks (id) on delete cascade,
  title        text not null check (char_length(btrim(title)) between 1 and 300),
  notes        text not null default '' check (char_length(notes) <= 5000),
  assignee_id  uuid references profiles (id),
  due_date     date,
  completed_at timestamptz,
  completed_by uuid references profiles (id),
  sort_order   double precision not null default 0,
  created_by   uuid not null references profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index tasks_project_idx on tasks (project_id, section_id, sort_order);
create index tasks_assignee_idx on tasks (assignee_id) where completed_at is null;
create index tasks_parent_idx on tasks (parent_id);
create index tasks_due_idx on tasks (due_date);

alter table sections enable row level security;
alter table tasks enable row level security;
create policy sections_select on sections for select to tracker_app using (app_can_see_project(project_id));
create policy sections_insert on sections for insert to tracker_app with check (app_can_see_project(project_id));
create policy sections_update on sections for update to tracker_app using (app_can_see_project(project_id)) with check (app_can_see_project(project_id));
create policy sections_delete on sections for delete to tracker_app using (app_can_see_project(project_id));
create policy tasks_select on tasks for select to tracker_app using (app_can_see_project(project_id));
create policy tasks_insert on tasks for insert to tracker_app with check (created_by = app_user_id() and app_can_see_project(project_id));
create policy tasks_update on tasks for update to tracker_app using (app_can_see_project(project_id)) with check (app_can_see_project(project_id));
create policy tasks_delete on tasks for delete to tracker_app using (app_can_see_project(project_id));
grant select, delete on sections, tasks to tracker_app;
grant insert (project_id, name, sort_order) on sections to tracker_app;
grant update (name, sort_order) on sections to tracker_app;
grant insert (project_id, section_id, parent_id, title, notes, assignee_id, due_date, sort_order, created_by) on tasks to tracker_app;
grant update (section_id, title, notes, assignee_id, due_date, completed_at, sort_order) on tasks to tracker_app;

create function tasks_guard() returns trigger
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
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and exists (select 1 from profiles where id = new.assignee_id and disabled) then
    raise exception 'cannot assign a disabled user' using errcode = '23514';
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
create trigger tasks_guard_trg before insert or update on tasks
  for each row execute function tasks_guard();

create function sections_guard() returns trigger
language plpgsql as $$
begin
  if app_user_id() is null then
    raise exception 'no acting user set; change refused' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'a section cannot move to another project' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger sections_guard_trg before insert or update on sections
  for each row execute function sections_guard();

alter table project_events drop constraint project_events_event_type_check;
alter table project_events add constraint project_events_event_type_check
  check (event_type in (
    'created', 'updated', 'archived', 'unarchived',
    'assignee_added', 'assignee_removed', 'commented', 'comment_edited', 'comment_deleted',
    'task_added', 'task_completed', 'task_reopened', 'task_deleted', 'task_assigned'))
  not valid;

create function tasks_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := app_user_id();
  who text;
begin
  if tg_op = 'INSERT' then
    insert into project_events (project_id, actor_id, event_type, field, new_value, subject_id)
    values (new.project_id, actor, 'task_added', 'task', new.title, new.id);
    perform touch_project(new.project_id);
    return new;
  elsif tg_op = 'DELETE' then
    -- A project being removed by the owner (never by the app) takes its tasks with it; skip then.
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
  if new.assignee_id is distinct from old.assignee_id then
    select display_name into who from profiles where id = new.assignee_id;
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value, subject_id)
    values (new.project_id, actor, 'task_assigned', 'task', new.title, coalesce(who, ''), new.id);
  end if;
  perform touch_project(new.project_id);
  return new;
end $$;
create trigger tasks_log_trg after insert or update or delete on tasks
  for each row execute function tasks_log();
