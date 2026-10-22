-- One-time catch-up: bring every existing project's status, current phase and progress in line with
-- its tasks, as migration 011 does on every change from now on. Run with the project triggers off so
-- it adds no history entries credited to anyone; Stuck and Cancelled flags are kept.
alter table projects disable trigger user;

update projects p set
  progress = coalesce((select round(100.0 * count(*) filter (where t.completed_at is not null) / nullif(count(*), 0))::integer
                       from tasks t where t.project_id = p.id and t.parent_id is null), 0),
  phase = coalesce((select t.title from tasks t left join sections s on s.id = t.section_id
                    where t.project_id = p.id and t.parent_id is null and t.completed_at is null
                    order by (t.section_id is not null), s.sort_order, t.sort_order, t.created_at limit 1), ''),
  status = case
    when p.status in ('blocked', 'cancelled') then p.status
    else (select case when count(*) > 0 and count(*) = count(*) filter (where t.completed_at is not null) then 'done'
                      when count(*) filter (where t.completed_at is not null) > 0 then 'in_progress'
                      else 'not_started' end
          from tasks t where t.project_id = p.id and t.parent_id is null)
  end;

alter table projects enable trigger user;
