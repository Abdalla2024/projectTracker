-- Access rules, history triggers, and auth functions.
--
-- Model: the web app connects as the restricted role `tracker_app` (not superuser, no BYPASSRLS)
-- and, for every request, sets `app.user_id` inside a transaction. Row Level Security policies and
-- triggers below decide what that user may read and change. Hiding UI elements is never the control.

-- ---------------------------------------------------------------------------------------------
-- Identity helpers. SECURITY DEFINER lets them read tables the caller cannot, without recursing
-- into row-level security. They only ever answer questions about the current app.user_id.
-- ---------------------------------------------------------------------------------------------

create function app_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create function app_is_active() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles where id = app_user_id() and not disabled)
$$;

create function app_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles where id = app_user_id() and not disabled and role = 'admin')
$$;

-- Used by the projects policies, where the row's own columns are passed in so a freshly inserted
-- row is visible to its creator without a table lookup.
create function app_project_visible(p_id uuid, p_creator uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from profiles u
    where u.id = app_user_id() and not u.disabled
      and (u.role = 'admin'
           or u.id = p_creator
           or exists (select 1 from project_assignees a where a.project_id = p_id and a.user_id = u.id))
  )
$$;

-- Used by child tables (assignees, stores, comments, events).
create function app_can_see_project(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from projects p
    where p.id = p_id and app_project_visible(p.id, p.created_by)
  )
$$;

-- A member may see their own profile and people who appear on projects they can see.
create function app_can_see_profile(p_uid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app_is_active() and (
    app_is_admin()
    or p_uid = app_user_id()
    or exists (
      select 1 from projects p
      where app_project_visible(p.id, p.created_by)
        and (p.created_by = p_uid
             or exists (select 1 from project_assignees a where a.project_id = p.id and a.user_id = p_uid)
             or exists (select 1 from comments c where c.project_id = p.id and c.author_id = p_uid)
             or exists (select 1 from project_events e where e.project_id = p.id and e.actor_id = p_uid))
    )
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Profiles and roles. Role is decided only here, from admin_emails. No application role can write
-- profiles at all (no INSERT/UPDATE grant), so there is no path to self-promote.
-- ---------------------------------------------------------------------------------------------

create function profiles_assign_role() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.role := case when exists (select 1 from admin_emails a where a.email = new.email)
                   then 'admin' else 'member' end;
  return new;
end $$;
create trigger profiles_assign_role_trg before insert on profiles
  for each row execute function profiles_assign_role();

create function profiles_log_role() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into role_changes (user_id, old_role, new_role) values (new.id, null, new.role);
  elsif new.role is distinct from old.role then
    insert into role_changes (user_id, old_role, new_role) values (new.id, old.role, new.role);
  end if;
  return new;
end $$;
create trigger profiles_log_role_trg after insert or update of role on profiles
  for each row execute function profiles_log_role();

-- Keep existing accounts in sync when the admin allowlist changes (out-of-band SQL / scripts/admin.mjs).
create function admin_emails_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update profiles set role = 'admin' where email = new.email and role <> 'admin';
  else
    update profiles set role = 'member' where email = old.email and role <> 'member';
  end if;
  return null;
end $$;
create trigger admin_emails_sync_trg after insert or delete on admin_emails
  for each row execute function admin_emails_sync();

-- ---------------------------------------------------------------------------------------------
-- Project guards: who may change which column. RLS cannot restrict columns, so a trigger does.
-- ---------------------------------------------------------------------------------------------

create function projects_guard() returns trigger
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

  -- Someone who can see the project but is neither admin nor creator is an assignee:
  -- they may only update status and next step.
  if not app_is_admin() and old.created_by <> app_user_id() then
    if (new.name, new.description, new.priority, new.deadline, new.archived_at)
       is distinct from (old.name, old.description, old.priority, old.deadline, old.archived_at) then
      raise exception 'assigned members may only change status and next step' using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;
create trigger projects_guard_trg before insert or update on projects
  for each row execute function projects_guard();

-- ---------------------------------------------------------------------------------------------
-- History. Every meaningful change writes an event in the same transaction as the change, so a
-- change cannot commit without its record. Only these definer functions can insert events.
-- ---------------------------------------------------------------------------------------------

create function touch_project(p_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update projects set updated_at = now() where id = p_id
$$;

create function projects_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := app_user_id();
begin
  if tg_op = 'INSERT' then
    insert into project_events (project_id, actor_id, event_type, field, new_value)
    values (new.id, actor, 'created', 'name', new.name);
    return new;
  end if;

  if new.name is distinct from old.name then
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value)
    values (new.id, actor, 'updated', 'name', old.name, new.name);
  end if;
  if new.description is distinct from old.description then
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value)
    values (new.id, actor, 'updated', 'description', old.description, new.description);
  end if;
  if new.status is distinct from old.status then
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value)
    values (new.id, actor, 'updated', 'status', old.status, new.status);
  end if;
  if new.priority is distinct from old.priority then
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value)
    values (new.id, actor, 'updated', 'priority', old.priority, new.priority);
  end if;
  if new.deadline is distinct from old.deadline then
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value)
    values (new.id, actor, 'updated', 'deadline', old.deadline::text, new.deadline::text);
  end if;
  if new.next_step is distinct from old.next_step then
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value)
    values (new.id, actor, 'updated', 'next_step', old.next_step, new.next_step);
  end if;
  if old.archived_at is null and new.archived_at is not null then
    insert into project_events (project_id, actor_id, event_type) values (new.id, actor, 'archived');
  elsif old.archived_at is not null and new.archived_at is null then
    insert into project_events (project_id, actor_id, event_type) values (new.id, actor, 'unarchived');
  end if;
  return new;
end $$;
create trigger projects_log_trg after insert or update on projects
  for each row execute function projects_log();

-- Assignees: admin only, active users only, history recorded.
create function project_assignees_guard() returns trigger
language plpgsql as $$
begin
  if not app_is_admin() then
    raise exception 'only an admin can assign projects' using errcode = '42501';
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
create trigger project_assignees_guard_trg before insert or delete on project_assignees
  for each row execute function project_assignees_guard();

create function project_assignees_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := app_user_id();
  who text;
begin
  if tg_op = 'INSERT' then
    select display_name into who from profiles where id = new.user_id;
    insert into project_events (project_id, actor_id, event_type, field, new_value, subject_id)
    values (new.project_id, actor, 'assignee_added', 'assignee', who, new.user_id);
    perform touch_project(new.project_id);
    return new;
  end if;
  select display_name into who from profiles where id = old.user_id;
  insert into project_events (project_id, actor_id, event_type, field, old_value, subject_id)
  values (old.project_id, actor, 'assignee_removed', 'assignee', who, old.user_id);
  perform touch_project(old.project_id);
  return old;
end $$;
create trigger project_assignees_log_trg after insert or delete on project_assignees
  for each row execute function project_assignees_log();

-- Stores: admin only, history recorded.
create function project_stores_guard() returns trigger
language plpgsql as $$
begin
  if not app_is_admin() then
    raise exception 'only an admin can change project stores' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger project_stores_guard_trg before insert or delete on project_stores
  for each row execute function project_stores_guard();

create function project_stores_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := app_user_id();
  sname text;
begin
  if tg_op = 'INSERT' then
    select name into sname from stores where id = new.store_id;
    insert into project_events (project_id, actor_id, event_type, field, new_value, subject_id)
    values (new.project_id, actor, 'store_added', 'store', sname, new.store_id);
    perform touch_project(new.project_id);
    return new;
  end if;
  select name into sname from stores where id = old.store_id;
  insert into project_events (project_id, actor_id, event_type, field, old_value, subject_id)
  values (old.project_id, actor, 'store_removed', 'store', sname, old.store_id);
  perform touch_project(old.project_id);
  return old;
end $$;
create trigger project_stores_log_trg after insert or delete on project_stores
  for each row execute function project_stores_log();

-- Comments: immutable once written (no UPDATE/DELETE grant); recorded as an event.
create function comments_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into project_events (project_id, actor_id, event_type, field)
  values (new.project_id, new.author_id, 'commented', 'comment');
  perform touch_project(new.project_id);
  return new;
end $$;
create trigger comments_log_trg after insert on comments
  for each row execute function comments_log();

-- Append-only: nobody (including the owner) can edit or remove history without deliberately
-- disabling these triggers.
create function project_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'project_events is append-only' using errcode = '42501';
end $$;
create trigger project_events_no_change_trg before update or delete on project_events
  for each row execute function project_events_immutable();
create trigger project_events_no_truncate_trg before truncate on project_events
  for each statement execute function project_events_immutable();

-- ---------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------

alter table profiles          enable row level security;
alter table stores            enable row level security;
alter table projects          enable row level security;
alter table project_assignees enable row level security;
alter table project_stores    enable row level security;
alter table comments          enable row level security;
alter table project_events    enable row level security;
-- No policies and no grants: only reachable through the definer functions / owner scripts.
alter table admin_emails      enable row level security;
alter table role_changes      enable row level security;
alter table login_codes       enable row level security;
alter table sessions          enable row level security;

create policy profiles_select on profiles for select to tracker_app
  using (app_can_see_profile(id));

create policy stores_select on stores for select to tracker_app
  using (app_is_active());

create policy projects_select on projects for select to tracker_app
  using (app_project_visible(id, created_by));
create policy projects_insert on projects for insert to tracker_app
  with check (created_by = app_user_id() and app_is_active());
create policy projects_update on projects for update to tracker_app
  using (app_project_visible(id, created_by))
  with check (app_project_visible(id, created_by));

create policy assignees_select on project_assignees for select to tracker_app
  using (app_can_see_project(project_id));
create policy assignees_insert on project_assignees for insert to tracker_app
  with check (app_is_admin());
create policy assignees_delete on project_assignees for delete to tracker_app
  using (app_is_admin());

create policy project_stores_select on project_stores for select to tracker_app
  using (app_can_see_project(project_id));
create policy project_stores_insert on project_stores for insert to tracker_app
  with check (app_is_admin());
create policy project_stores_delete on project_stores for delete to tracker_app
  using (app_is_admin());

create policy comments_select on comments for select to tracker_app
  using (app_can_see_project(project_id));
create policy comments_insert on comments for insert to tracker_app
  with check (author_id = app_user_id() and app_can_see_project(project_id));

create policy events_select on project_events for select to tracker_app
  using (app_can_see_project(project_id));

-- ---------------------------------------------------------------------------------------------
-- Privileges for the runtime role. Deliberately narrow: no DELETE on projects/comments/events,
-- no write access to profiles, and column-level limits on projects.
-- ---------------------------------------------------------------------------------------------

grant usage on schema public to tracker_app;

grant select on profiles, stores, project_assignees, project_stores, comments, project_events, projects
  to tracker_app;
grant insert (name, description, status, priority, deadline, next_step, created_by) on projects to tracker_app;
grant update (name, description, status, priority, deadline, next_step, archived_at) on projects to tracker_app;
grant insert (project_id, user_id, assigned_by) on project_assignees to tracker_app;
grant delete on project_assignees to tracker_app;
grant insert (project_id, store_id) on project_stores to tracker_app;
grant delete on project_stores to tracker_app;
grant insert (project_id, author_id, body) on comments to tracker_app;

-- ---------------------------------------------------------------------------------------------
-- Login (passwordless email code). All of this runs through definer functions so the runtime role
-- never touches login_codes / sessions / profiles writes directly.
-- ---------------------------------------------------------------------------------------------

-- Returns 'ok' or 'throttled'. The caller has already checked the email domain.
create function auth_request_login_code(p_email text, p_code_hash text, p_ttl_seconds integer)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(btrim(p_email));
begin
  delete from login_codes where created_at < now() - interval '1 day';
  delete from sessions where expires_at < now();

  if exists (select 1 from login_codes where email = v_email and created_at > now() - interval '30 seconds')
     or (select count(*) from login_codes where email = v_email and created_at > now() - interval '1 hour') >= 5 then
    return 'throttled';
  end if;

  insert into login_codes (email, code_hash, expires_at)
  values (v_email, p_code_hash, now() + make_interval(secs => p_ttl_seconds));
  return 'ok';
end $$;

-- Checks the code (max 5 wrong attempts per code), enforces the allowed domains, creates the
-- profile on first login (always 'member' unless the email is in admin_emails), and starts a
-- session. Returns the user id, or null on any failure.
create function auth_verify_and_login(
  p_email text, p_code_hash text, p_allowed_domains text[], p_session_hash text, p_session_ttl_seconds integer)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email  text := lower(btrim(p_email));
  v_local  text := split_part(lower(btrim(p_email)), '@', 1);
  v_domain text := split_part(lower(btrim(p_email)), '@', 2);
  v_code   login_codes;
  v_user   profiles;
begin
  if v_local = '' or v_local like '%+%' or v_email like '%@%@%'
     or not (v_domain = any (array(select lower(btrim(d)) from unnest(p_allowed_domains) d))) then
    return null;
  end if;

  select * into v_code from login_codes
  where email = v_email and consumed_at is null and expires_at > now()
  order by created_at desc, id desc limit 1
  for update;
  if not found or v_code.attempts >= 5 then
    return null;
  end if;

  if v_code.code_hash <> p_code_hash then
    update login_codes set attempts = attempts + 1 where id = v_code.id;
    return null;
  end if;
  update login_codes set consumed_at = now() where id = v_code.id;

  select * into v_user from profiles where email = v_email;
  if not found then
    insert into profiles (email, display_name)
    values (v_email, left(initcap(regexp_replace(v_local, '[._-]+', ' ', 'g')), 100))
    returning * into v_user;
  end if;
  if v_user.disabled then
    return null;
  end if;

  insert into sessions (token_hash, user_id, expires_at)
  values (p_session_hash, v_user.id, now() + make_interval(secs => p_session_ttl_seconds));
  return v_user.id;
end $$;

create function auth_resolve_session(p_token_hash text)
returns table (id uuid, email text, display_name text, role text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.email, p.display_name, p.role
  from sessions s join profiles p on p.id = s.user_id
  where s.token_hash = p_token_hash and s.expires_at > now() and not p.disabled
$$;

create function auth_end_session(p_token_hash text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from sessions where token_hash = p_token_hash
$$;

-- ---------------------------------------------------------------------------------------------
-- Lock down function execution: only the runtime role may call the callable ones.
-- ---------------------------------------------------------------------------------------------

revoke execute on all functions in schema public from public;
grant execute on function
  app_user_id(), app_is_active(), app_is_admin(), app_project_visible(uuid, uuid),
  app_can_see_project(uuid), app_can_see_profile(uuid),
  auth_request_login_code(text, text, integer),
  auth_verify_and_login(text, text, text[], text, integer),
  auth_resolve_session(text), auth_end_session(text)
  to tracker_app;
