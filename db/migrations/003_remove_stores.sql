-- Store selection was removed from the product (decision by the project owner).
-- 001 and 002 are already applied and stay as written; this migration retires the feature.
--
-- Data note: dropping the tables deletes any project-to-store links. History is NOT rewritten:
-- project_events is append-only, so any existing 'store_added' / 'store_removed' rows are kept.
-- The event-type rule below is added NOT VALID, which enforces it for every new row while
-- leaving those legacy rows in place.

drop table project_stores;   -- takes its triggers and row-level security policies with it
drop table stores;
drop function project_stores_guard();
drop function project_stores_log();

alter table project_events drop constraint project_events_event_type_check;
alter table project_events add constraint project_events_event_type_check
  check (event_type in (
    'created', 'updated', 'archived', 'unarchived',
    'assignee_added', 'assignee_removed', 'commented'))
  not valid;
