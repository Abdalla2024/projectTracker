-- 1) A short "current phase" label and a 0-100 progress value on each project.
--    Assigned members may update both (like status and next step); the existing guard only
--    restricts name, description, priority, deadline and archiving to creators and admins.
-- 2) Comments become editable and deletable by their own author, and can have replies.
--    A deleted comment keeps its row (so replies stay attached) but its text is erased;
--    edits and deletions are recorded in the append-only history without the text.

alter table projects add column phase    text    not null default '' check (char_length(phase) <= 24);
alter table projects add column progress integer not null default 0  check (progress between 0 and 100);
grant insert (phase, progress) on projects to tracker_app;
grant update (phase, progress) on projects to tracker_app;

create or replace function projects_log() returns trigger
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
  if new.phase is distinct from old.phase then
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value)
    values (new.id, actor, 'updated', 'phase', old.phase, new.phase);
  end if;
  if new.progress is distinct from old.progress then
    insert into project_events (project_id, actor_id, event_type, field, old_value, new_value)
    values (new.id, actor, 'updated', 'progress', old.progress::text, new.progress::text);
  end if;
  if old.archived_at is null and new.archived_at is not null then
    insert into project_events (project_id, actor_id, event_type) values (new.id, actor, 'archived');
  elsif old.archived_at is not null and new.archived_at is null then
    insert into project_events (project_id, actor_id, event_type) values (new.id, actor, 'unarchived');
  end if;
  return new;
end $$;

-- Comments: replies, edits, deletion.
alter table comments add column parent_id  uuid references comments (id);
alter table comments add column edited_at  timestamptz;
alter table comments add column deleted_at timestamptz;
alter table comments drop constraint comments_body_check;
alter table comments add constraint comments_body_check
  check ((deleted_at is not null and body = '') or char_length(btrim(body)) between 1 and 4000);
create index comments_parent_idx on comments (parent_id);

alter table project_events drop constraint project_events_event_type_check;
alter table project_events add constraint project_events_event_type_check
  check (event_type in (
    'created', 'updated', 'archived', 'unarchived',
    'assignee_added', 'assignee_removed', 'commented', 'comment_edited', 'comment_deleted'))
  not valid;

create function comments_guard() returns trigger
language plpgsql as $$
declare
  v_parent comments;
begin
  if app_user_id() is null then
    raise exception 'no acting user set; change refused' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.edited_at := null;
    new.deleted_at := null;
    if new.parent_id is not null then
      -- A reply goes under a visible top-level comment of the same project (one level of nesting).
      select * into v_parent from comments where id = new.parent_id;
      if not found or v_parent.project_id <> new.project_id or v_parent.parent_id is not null or v_parent.deleted_at is not null then
        raise exception 'a reply must answer a top-level comment on the same project' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if (new.id, new.project_id, new.author_id, new.parent_id, new.created_at)
     is distinct from (old.id, old.project_id, old.author_id, old.parent_id, old.created_at) then
    raise exception 'only the text of a comment can change' using errcode = '42501';
  end if;
  if old.deleted_at is not null then
    raise exception 'a deleted comment cannot change' using errcode = '42501';
  end if;
  if new.deleted_at is not null then
    new.deleted_at := now();
    new.body := '';
    new.edited_at := old.edited_at;
  elsif new.body is distinct from old.body then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end $$;
create trigger comments_guard_trg before insert or update on comments
  for each row execute function comments_guard();

create function comments_edit_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    insert into project_events (project_id, actor_id, event_type, field)
    values (new.project_id, app_user_id(), 'comment_deleted', 'comment');
  elsif new.body is distinct from old.body then
    insert into project_events (project_id, actor_id, event_type, field)
    values (new.project_id, app_user_id(), 'comment_edited', 'comment');
  else
    return new;
  end if;
  perform touch_project(new.project_id);
  return new;
end $$;
create trigger comments_edit_log_trg after update on comments
  for each row execute function comments_edit_log();

-- Only the author can change their own comment, and only while they can still see the project.
create policy comments_update on comments for update to tracker_app
  using (author_id = app_user_id() and app_can_see_project(project_id))
  with check (author_id = app_user_id() and app_can_see_project(project_id));
grant insert (parent_id) on comments to tracker_app;
grant update (body, deleted_at) on comments to tracker_app;
