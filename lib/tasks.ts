import "server-only";
import { withUser } from "./db";
import { NotAllowedError } from "./projects";

export interface Section { id: string; name: string; sort_order: number }
export interface Task {
  id: string;
  project_id: string;
  section_id: string | null;
  parent_id: string | null;
  title: string;
  notes: string;
  assignees: { id: string; name: string }[];
  due_date: string | null;
  completed_at: Date | null;
  sort_order: number;
}

const TASK_COLUMNS = `k.id, k.project_id, k.section_id, k.parent_id, k.title, k.notes,
  coalesce((select json_agg(json_build_object('id', pr.id, 'name', pr.display_name) order by pr.display_name)
            from task_assignees ta join profiles pr on pr.id = ta.user_id where ta.task_id = k.id), '[]') as assignees,
  k.due_date::text as due_date, k.completed_at, k.sort_order`;

export async function getProjectTasks(userId: string, projectId: string): Promise<{ sections: Section[]; tasks: Task[] }> {
  return withUser(userId, async (c) => {
    const sections = (await c.query("select id, name, sort_order from sections where project_id = $1 order by sort_order, created_at", [projectId])).rows;
    const tasks = (await c.query(
      `select ${TASK_COLUMNS} from tasks k
       where k.project_id = $1 order by k.sort_order, k.created_at`, [projectId])).rows;
    return { sections, tasks };
  });
}

export interface NewTask { title: string; section_id: string | null; parent_id: string | null; assigneeIds: string[]; due_date: string | null }

async function replaceTaskAssignees(c: import("pg").PoolClient, taskId: string, wanted: string[], actor: string) {
  const current = (await c.query("select user_id from task_assignees where task_id = $1", [taskId])).rows.map((r) => r.user_id as string);
  for (const uid of current.filter((u) => !wanted.includes(u))) await c.query("delete from task_assignees where task_id = $1 and user_id = $2", [taskId, uid]);
  for (const uid of wanted.filter((u) => !current.includes(u))) await c.query("insert into task_assignees (task_id, user_id, assigned_by) values ($1,$2,$3)", [taskId, uid, actor]);
}

export async function createTask(userId: string, projectId: string, t: NewTask): Promise<string> {
  return withUser(userId, async (c) => {
    // A new task goes to the end of its section (or of its parent's subtasks).
    const id = (await c.query(
      `insert into tasks (project_id, section_id, parent_id, title, due_date, created_by, sort_order)
       values ($1,$2,$3,$4,$5,$6, coalesce((select max(sort_order) + 1 from tasks where project_id = $1), 0)) returning id`,
      [projectId, t.section_id, t.parent_id, t.title, t.due_date, userId],
    )).rows[0].id as string;
    await replaceTaskAssignees(c, id, [...new Set(t.assigneeIds)], userId);
    return id;
  });
}

const TASK_EDITABLE = ["title", "notes", "due_date"] as const;
export type TaskPatch = Partial<Record<(typeof TASK_EDITABLE)[number], string | null>> & { assigneeIds?: string[] };

export async function updateTask(userId: string, projectId: string, taskId: string, patch: TaskPatch): Promise<void> {
  await withUser(userId, async (c) => {
    const keys = TASK_EDITABLE.filter((k) => k in patch); // fixed allow-list
    const exists = await c.query("select 1 from tasks where id = $1 and project_id = $2", [taskId, projectId]);
    if (exists.rowCount === 0) throw new NotAllowedError("Task not found");
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(", ");
      await c.query(`update tasks set ${sets} where id = $1 and project_id = $2`, [taskId, projectId, ...keys.map((k) => patch[k] ?? null)]);
    }
    if (patch.assigneeIds) await replaceTaskAssignees(c, taskId, [...new Set(patch.assigneeIds)], userId);
  });
}

/**
 * Drag and drop: put a top-level task into a section (null = no section), before another task, or at
 * the end. Renumbers that section so the order is exactly what the person sees.
 */
export async function moveTask(userId: string, projectId: string, taskId: string, sectionId: string | null, beforeId: string | null): Promise<void> {
  await withUser(userId, async (c) => {
    const ids = (await c.query(
      `select id from tasks where project_id = $1 and parent_id is null and section_id is not distinct from $2 and id <> $3 order by sort_order, created_at`,
      [projectId, sectionId, taskId])).rows.map((r) => r.id as string);
    const at = beforeId ? ids.indexOf(beforeId) : -1;
    ids.splice(at < 0 ? ids.length : at, 0, taskId);
    const r = await c.query("update tasks set section_id = $3 where id = $1 and project_id = $2 and parent_id is null", [taskId, projectId, sectionId]);
    if (r.rowCount === 0) throw new NotAllowedError("Task not found");
    for (const [i, id] of ids.entries()) await c.query("update tasks set sort_order = $2 where id = $1", [id, i]);
  });
}

export async function setTaskDone(userId: string, taskId: string, done: boolean): Promise<void> {
  await withUser(userId, async (c) => {
    const r = await c.query(`update tasks set completed_at = ${done ? "now()" : "null"} where id = $1`, [taskId]);
    if (r.rowCount === 0) throw new NotAllowedError("Task not found");
  });
}

export async function deleteTask(userId: string, projectId: string, taskId: string): Promise<void> {
  await withUser(userId, async (c) => {
    const r = await c.query("delete from tasks where id = $1 and project_id = $2", [taskId, projectId]);
    if (r.rowCount === 0) throw new NotAllowedError("Task not found");
  });
}

export async function createSection(userId: string, projectId: string, name: string): Promise<void> {
  await withUser(userId, (c) =>
    c.query(
      "insert into sections (project_id, name, sort_order) values ($1, $2, coalesce((select max(sort_order) + 1 from sections where project_id = $1), 0))",
      [projectId, name],
    ),
  );
}

export async function renameSection(userId: string, projectId: string, sectionId: string, name: string): Promise<void> {
  await withUser(userId, async (c) => {
    const r = await c.query("update sections set name = $3 where id = $1 and project_id = $2", [sectionId, projectId, name]);
    if (r.rowCount === 0) throw new NotAllowedError("Section not found");
  });
}

/** Removing a section keeps its tasks; they move to "No section". */
export async function deleteSection(userId: string, projectId: string, sectionId: string): Promise<void> {
  await withUser(userId, async (c) => {
    const r = await c.query("delete from sections where id = $1 and project_id = $2", [sectionId, projectId]);
    if (r.rowCount === 0) throw new NotAllowedError("Section not found");
  });
}

export interface TaskWithProject extends Task { project_name: string; project_archived: boolean; location_name: string | null; team_name: string | null }

export interface MyProject {
  id: string; name: string; status: string; progress: number; phase: string; priority: string;
  location_name: string | null; location_color: string | null; team_name: string | null; team_color: string | null;
  tasks_total: number; tasks_done: number;
  tasks: Task[];
}

/**
 * The projects this person has tasks in, each with just their tasks (open ones, plus ones finished in the
 * last 7 days). Projects with something overdue come first, then by the nearest due date.
 */
export async function listMyProjects(userId: string, today: string): Promise<MyProject[]> {
  const rows = await listMyTasks(userId);
  const ids = [...new Set(rows.map((r) => r.project_id))];
  if (!ids.length) return [];
  const meta = await withUser(userId, async (c) =>
    (await c.query(
      `select p.id, p.name, p.status, p.progress, p.phase, p.priority,
              l.name as location_name, l.color as location_color, t.name as team_name, t.color as team_color,
              (select count(*)::int from tasks k where k.project_id = p.id and k.parent_id is null) as tasks_total,
              (select count(*)::int from tasks k where k.project_id = p.id and k.parent_id is null and k.completed_at is not null) as tasks_done
       from projects p left join locations l on l.id = p.location_id left join teams t on t.id = p.team_id
       where p.id = any($1)`, [ids])).rows as Omit<MyProject, "tasks">[],
  );
  const projects: MyProject[] = meta.map((m) => ({ ...m, tasks: rows.filter((r) => r.project_id === m.id) }));
  const urgency = (p: MyProject) => {
    const open = p.tasks.filter((t) => !t.completed_at);
    const late = open.some((t) => t.due_date && t.due_date < today) ? 0 : 1;
    const next = open.map((t) => t.due_date).filter((d): d is string => !!d).sort()[0] ?? "9999-12-31";
    return [open.length ? 0 : 1, late, next] as const;
  };
  return projects.sort((a, b) => {
    const [ao, al, an] = urgency(a), [bo, bl, bn] = urgency(b);
    return ao - bo || al - bl || an.localeCompare(bn) || a.name.localeCompare(b.name);
  });
}

/** Open (and recently finished) tasks assigned to this person, across all projects. */
export async function listMyTasks(userId: string): Promise<TaskWithProject[]> {
  return withUser(userId, async (c) =>
    (await c.query(
      `select ${TASK_COLUMNS}, p.name as project_name, p.archived_at is not null as project_archived,
              l.name as location_name, t.name as team_name
       from tasks k
       join projects p on p.id = k.project_id
       left join locations l on l.id = p.location_id left join teams t on t.id = p.team_id
       where exists (select 1 from task_assignees ta where ta.task_id = k.id and ta.user_id = $1) and p.archived_at is null
         and (k.completed_at is null or k.completed_at > now() - interval '7 days')
       order by k.completed_at is not null, k.due_date nulls last, k.created_at`,
      [userId],
    )).rows,
  );
}

export interface CalendarItem {
  kind: "task" | "project";
  id: string;
  project_id: string;
  title: string;
  date: string;
  done: boolean;
  assignee_name: string | null;
  location_color: string | null;
}

/** Task due dates and project deadlines in [from, to], optionally narrowed to one location or team. */
export async function listCalendar(
  userId: string, from: string, to: string, filter: { location?: string | null; team?: string | null; mine?: boolean },
): Promise<CalendarItem[]> {
  return withUser(userId, async (c) => {
    const params: unknown[] = [from, to, filter.location ?? null, filter.team ?? null, filter.mine ? userId : null];
    const scope = `p.archived_at is null and ($3::uuid is null or p.location_id = $3) and ($4::uuid is null or p.team_id = $4)`;
    const tasks = (await c.query(
      `select 'task' as kind, k.id, k.project_id, k.title, k.due_date::text as date, k.completed_at is not null as done,
              (select string_agg(pr.display_name, ', ' order by pr.display_name) from task_assignees ta join profiles pr on pr.id = ta.user_id where ta.task_id = k.id) as assignee_name,
              l.color as location_color
       from tasks k join projects p on p.id = k.project_id
       left join locations l on l.id = p.location_id
       where k.due_date between $1 and $2 and ${scope}
         and ($5::uuid is null or exists (select 1 from task_assignees ta where ta.task_id = k.id and ta.user_id = $5))`, params)).rows;
    const projects = (await c.query(
      `select 'project' as kind, p.id, p.id as project_id, p.name as title, p.deadline::text as date,
              p.status in ('done','cancelled') as done, null as assignee_name, l.color as location_color
       from projects p left join locations l on l.id = p.location_id
       where p.deadline between $1 and $2 and ${scope}
         and ($5::uuid is null or p.created_by = $5 or exists (select 1 from project_assignees a where a.project_id = p.id and a.user_id = $5))`,
      params)).rows;
    return [...projects, ...tasks].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "project" ? -1 : 1));
  });
}
