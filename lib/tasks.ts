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
  assignee_id: string | null;
  assignee_name: string | null;
  due_date: string | null;
  completed_at: Date | null;
  sort_order: number;
}

const TASK_COLUMNS = `k.id, k.project_id, k.section_id, k.parent_id, k.title, k.notes, k.assignee_id, pr.display_name as assignee_name,
  k.due_date::text as due_date, k.completed_at, k.sort_order`;

export async function getProjectTasks(userId: string, projectId: string): Promise<{ sections: Section[]; tasks: Task[] }> {
  return withUser(userId, async (c) => {
    const sections = (await c.query("select id, name, sort_order from sections where project_id = $1 order by sort_order, created_at", [projectId])).rows;
    const tasks = (await c.query(
      `select ${TASK_COLUMNS} from tasks k left join profiles pr on pr.id = k.assignee_id
       where k.project_id = $1 order by k.sort_order, k.created_at`, [projectId])).rows;
    return { sections, tasks };
  });
}

export interface NewTask { title: string; section_id: string | null; parent_id: string | null; assignee_id: string | null; due_date: string | null }

export async function createTask(userId: string, projectId: string, t: NewTask): Promise<void> {
  await withUser(userId, (c) =>
    c.query(
      `insert into tasks (project_id, section_id, parent_id, title, assignee_id, due_date, created_by, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7, coalesce((select max(sort_order) + 1 from tasks where project_id = $1), 0))`,
      [projectId, t.section_id, t.parent_id, t.title, t.assignee_id, t.due_date, userId],
    ),
  );
}

const TASK_EDITABLE = ["title", "notes", "assignee_id", "due_date", "section_id"] as const;
export type TaskPatch = Partial<Record<(typeof TASK_EDITABLE)[number], string | null>>;

export async function updateTask(userId: string, projectId: string, taskId: string, patch: TaskPatch): Promise<void> {
  await withUser(userId, async (c) => {
    const keys = TASK_EDITABLE.filter((k) => k in patch); // fixed allow-list
    if (!keys.length) return;
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(", ");
    const r = await c.query(`update tasks set ${sets} where id = $1 and project_id = $2`, [taskId, projectId, ...keys.map((k) => patch[k])]);
    if (r.rowCount === 0) throw new NotAllowedError("Task not found");
  });
}

export async function setTaskDone(userId: string, taskId: string, done: boolean): Promise<string> {
  return withUser(userId, async (c) => {
    const r = await c.query(`update tasks set completed_at = ${done ? "now()" : "null"} where id = $1 returning project_id`, [taskId]);
    if (r.rowCount === 0) throw new NotAllowedError("Task not found");
    return r.rows[0].project_id as string;
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

/** Open (and recently finished) tasks assigned to this person, across all projects. */
export async function listMyTasks(userId: string): Promise<TaskWithProject[]> {
  return withUser(userId, async (c) =>
    (await c.query(
      `select ${TASK_COLUMNS}, p.name as project_name, p.archived_at is not null as project_archived,
              l.name as location_name, t.name as team_name
       from tasks k left join profiles pr on pr.id = k.assignee_id
       join projects p on p.id = k.project_id
       left join locations l on l.id = p.location_id left join teams t on t.id = p.team_id
       where k.assignee_id = $1 and p.archived_at is null
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
              pr.display_name as assignee_name, l.color as location_color
       from tasks k join projects p on p.id = k.project_id left join profiles pr on pr.id = k.assignee_id
       left join locations l on l.id = p.location_id
       where k.due_date between $1 and $2 and ${scope} and ($5::uuid is null or k.assignee_id = $5)`, params)).rows;
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
