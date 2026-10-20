-- Core tables. Access rules live in 002_security.sql.
-- The runtime role `tracker_app` is created by scripts/db-setup.mjs before migrations run.

create table profiles (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  display_name text not null check (char_length(display_name) between 1 and 100),
  role         text not null default 'member' check (role in ('member', 'admin')),
  disabled     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Emails that become admin when their account exists / is created. Written only out of band (see docs/ADMIN.md).
create table admin_emails (
  email    text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

-- Audit trail of role changes, written by trigger.
create table role_changes (
  id         bigserial primary key,
  user_id    uuid not null references profiles (id),
  old_role   text,
  new_role   text not null,
  changed_at timestamptz not null default now(),
  changed_by text not null default current_user
);

create table stores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order integer not null default 0
);

create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  status      text not null default 'not_started'
              check (status in ('not_started', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority    text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  deadline    date,
  next_step   text not null default '' check (char_length(next_step) <= 500),
  created_by  uuid not null references profiles (id),
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index projects_created_by_idx on projects (created_by);

create table project_assignees (
  project_id  uuid not null references projects (id),
  user_id     uuid not null references profiles (id),
  assigned_by uuid not null references profiles (id),
  assigned_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_assignees_user_idx on project_assignees (user_id);

create table project_stores (
  project_id uuid not null references projects (id),
  store_id   uuid not null references stores (id),
  primary key (project_id, store_id)
);

create table comments (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  author_id  uuid not null references profiles (id),
  body       text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index comments_project_idx on comments (project_id, created_at);

-- Append-only history. Rows are written only by triggers (see 002_security.sql).
create table project_events (
  id          bigserial primary key,
  project_id  uuid not null references projects (id),
  actor_id    uuid not null references profiles (id),
  event_type  text not null check (event_type in (
                'created', 'updated', 'archived', 'unarchived',
                'assignee_added', 'assignee_removed',
                'store_added', 'store_removed', 'commented')),
  field       text,
  old_value   text,
  new_value   text,
  subject_id  uuid,
  occurred_at timestamptz not null default now()
);
create index project_events_project_idx on project_events (project_id, occurred_at, id);
create index project_events_time_idx on project_events (occurred_at);

-- Passwordless login. Only reachable through the auth_* functions.
create table login_codes (
  id          bigserial primary key,
  email       text not null,
  code_hash   text not null,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index login_codes_email_idx on login_codes (email, created_at);

create table sessions (
  token_hash text primary key,
  user_id    uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions (user_id);

-- Reference data. PROVISIONAL list based on public information; confirm with Ekiben and edit with SQL.
insert into stores (name, sort_order) values
  ('Fells Point', 10),
  ('Hampden', 20),
  ('South Baltimore', 30),
  ('Catering', 40);
