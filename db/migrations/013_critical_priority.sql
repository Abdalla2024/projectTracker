-- Adds a "critical" priority above high.
alter table projects drop constraint projects_priority_check;
alter table projects add constraint projects_priority_check check (priority in ('low', 'normal', 'high', 'critical'));
