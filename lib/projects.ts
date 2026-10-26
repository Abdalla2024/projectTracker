import "server-only";
import type pg from "pg";
import { withUser } from "./db";
import type { EventRow, ProjectRow } from "./summary";
import type { SummaryComment, SummaryTask } from "./narrative";

// Note: none of these functions filter by "who may see this". The database does that (row-level
// security). They are plain queries; a bug here can show less, never more, than the user may see.

export interface ProjectListItem {
  id: string;
  name: string;
  status: string;
  priority: string;
  deadline: string | null;
  next_step: string;
  phase: string;
  progress: number;
  archived_at: Date | null;
  updated_at: Date;
  created_by: string;
  creator_name: string;
  assignees: string[];
  location_id: string | null;
  location_name: string | null;
  location_color: string | null;
  team_id: string | null;
  team_name: string | null;
  team_color: string | null;
  tasks_total: number;
  tasks_done: number;
}

export interface Person { id: string; name: string; email?: string }

export interface CommentRow {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  parent_id: string | null;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
}

export interface ProjectDetail {
  id: string;
  name: string;
  description: string;
  status: string;
  priority: string;
  deadline: string | null;
  next_step: string;
  phase: string;
  progress: number;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  creator_name: string;
  location_id: string | null;
  team_id: string | null;
  assignees: Person[];
  comments: CommentRow[];
  events: (EventRow & { actor_name: string })[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

export class NotAllowedError extends Error {}

export async function listProjects(userId: string, includeArchived: boolean): Promise<ProjectListItem[]> {
  return withUser(userId, async (c) => {
    const r = await c.query(
      `select p.id, p.name, p.status, p.priority, p.deadline::text as deadline, p.next_step, p.phase, p.progress, p.archived_at,
              p.updated_at, p.created_by, cr.display_name as creator_name,
              coalesce((select json_agg(pr.display_name order by pr.display_name)
                        from project_assignees a join profiles pr on pr.id = a.user_id
                        where a.project_id = p.id), '[]') as assignees,
              p.location_id, l.name as location_name, l.color as location_color,
              p.team_id, t.name as team_name, t.color as team_color,
              (select count(*)::int from tasks k where k.project_id = p.id and k.parent_id is null) as tasks_total,
              (select count(*)::int from tasks k where k.project_id = p.id and k.parent_id is null and k.completed_at is not null) as tasks_done
       from projects p join profiles cr on cr.id = p.created_by
       left join locations l on l.id = p.location_id
       left join teams t on t.id = p.team_id
       where ($1 or p.archived_at is null)
       order by (p.status in ('done','cancelled')), (p.priority = 'critical') desc, p.deadline nulls last, p.updated_at desc`,
      [includeArchived],
    );
    return r.rows;
  });
}

export async function getProjectDetail(userId: string, id: string): Promise<ProjectDetail | null> {
  if (!isUuid(id)) return null;
  return withUser(userId, async (c) => {
    const p = (
      await c.query(
        `select p.id, p.name, p.description, p.status, p.priority, p.deadline::text as deadline, p.next_step,
                p.phase, p.progress, p.archived_at, p.created_at, p.updated_at, p.created_by, cr.display_name as creator_name,
                p.location_id, p.team_id
         from projects p join profiles cr on cr.id = p.created_by where p.id = $1`,
        [id],
      )
    ).rows[0];
    if (!p) return null;
    // One connection runs one query at a time (pg deprecates overlapping queries), so these are sequential.
    const assignees = await c.query(
      `select pr.id, pr.display_name as name, pr.email from project_assignees a join profiles pr on pr.id = a.user_id
       where a.project_id = $1 order by pr.display_name`, [id]);
    const comments = await c.query(
      `select c.id, c.author_id, pr.display_name as author_name, c.body, c.parent_id, c.created_at, c.edited_at, c.deleted_at from comments c
       join profiles pr on pr.id = c.author_id where c.project_id = $1 order by c.created_at, c.id`, [id]);
    const events = await c.query(
      `select e.id, e.project_id, e.event_type, e.field, e.old_value, e.new_value, e.subject_id, e.occurred_at,
              pr.display_name as actor_name
       from project_events e join profiles pr on pr.id = e.actor_id
       where e.project_id = $1 order by e.occurred_at desc, e.id desc`, [id]);
    return { ...p, assignees: assignees.rows, comments: comments.rows, events: events.rows };
  });
}

/** Everyone who can be assigned work (all enabled accounts). */
export async function listPeople(userId: string): Promise<Person[]> {
  return withUser(userId, async (c) =>
    (await c.query("select id, display_name as name, email from profiles where not disabled order by display_name")).rows,
  );
}

export interface NewProject {
  name: string;
  description: string;
  status: string;
  priority: string;
  deadline: string | null;
  next_step: string;
  phase: string;
  progress: number;
  location_id: string | null;
  team_id: string | null;
  assigneeIds: string[];
  /** Tasks to create with the project, in order; progress then follows them. */
  taskTitles?: string[];
}

export async function createProject(user: { id: string }, input: NewProject): Promise<string> {
  return withUser(user.id, async (c) => {
    const r = await c.query(
      `insert into projects (name, description, status, priority, deadline, next_step, phase, progress, location_id, team_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [input.name, input.description, input.status, input.priority, input.deadline, input.next_step, input.phase, input.progress,
       input.location_id, input.team_id, user.id],
    );
    const id: string = r.rows[0].id;
    await replaceAssignees(c, id, input.assigneeIds, user.id);
    // Tasks created with the project go to the people the project is assigned to.
    const people = [...new Set(input.assigneeIds)];
    for (const [i, title] of (input.taskTitles ?? []).entries()) {
      const taskId = (await c.query("insert into tasks (project_id, title, created_by, sort_order) values ($1,$2,$3,$4) returning id", [id, title, user.id, i])).rows[0].id as string;
      for (const uid of people) {
        await c.query("insert into task_assignees (task_id, user_id, assigned_by) values ($1,$2,$3)", [taskId, uid, user.id]);
      }
    }
    return id;
  });
}

const EDITABLE = ["name", "description", "status", "priority", "deadline", "next_step", "phase", "progress", "location_id", "team_id"] as const;
export type ProjectPatch = Partial<Record<(typeof EDITABLE)[number], string | number | null>>;

export async function updateProject(userId: string, id: string, patch: ProjectPatch): Promise<void> {
  await withUser(userId, async (c) => {
    const keys = EDITABLE.filter((k) => k in patch); // fixed allow-list: user input never becomes a column name
    if (keys.length === 0) return;
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const r = await c.query(`update projects set ${sets} where id = $1`, [id, ...keys.map((k) => patch[k])]);
    if (r.rowCount === 0) throw new NotAllowedError("Project not found or not editable");
  });
}

export async function setArchived(userId: string, id: string, archived: boolean): Promise<void> {
  await withUser(userId, async (c) => {
    const r = await c.query(`update projects set archived_at = ${archived ? "now()" : "null"} where id = $1`, [id]);
    if (r.rowCount === 0) throw new NotAllowedError("Project not found or not editable");
  });
}

async function replaceAssignees(c: pg.PoolClient, projectId: string, wanted: string[], actorId: string) {
  const current = (await c.query("select user_id from project_assignees where project_id = $1", [projectId])).rows.map((r) => r.user_id as string);
  const want = new Set(wanted);
  for (const uid of current.filter((u) => !want.has(u))) {
    await c.query("delete from project_assignees where project_id = $1 and user_id = $2", [projectId, uid]);
  }
  for (const uid of wanted.filter((u) => !current.includes(u))) {
    await c.query("insert into project_assignees (project_id, user_id, assigned_by) values ($1,$2,$3)", [projectId, uid, actorId]);
  }
}

export async function setAssignees(userId: string, id: string, assigneeIds: string[]): Promise<void> {
  await withUser(userId, (c) => replaceAssignees(c, id, assigneeIds, userId));
}

export async function addComment(userId: string, id: string, body: string, parentId: string | null = null): Promise<void> {
  await withUser(userId, (c) =>
    c.query("insert into comments (project_id, author_id, body, parent_id) values ($1,$2,$3,$4)", [id, userId, body, parentId]),
  );
}

/** Only the author can change a comment; the database returns no row for anyone else. */
export async function editComment(userId: string, projectId: string, commentId: string, body: string): Promise<void> {
  await withUser(userId, async (c) => {
    const r = await c.query("update comments set body = $3 where id = $2 and project_id = $1 and deleted_at is null", [projectId, commentId, body]);
    if (r.rowCount === 0) throw new NotAllowedError("Comment not found or not yours");
  });
}

export async function deleteComment(userId: string, projectId: string, commentId: string): Promise<void> {
  await withUser(userId, async (c) => {
    const r = await c.query("update comments set deleted_at = now() where id = $2 and project_id = $1 and deleted_at is null", [projectId, commentId]);
    if (r.rowCount === 0) throw new NotAllowedError("Comment not found or not yours");
  });
}

/** Everything the weekly summary needs, already limited to what this user may see. */
export async function loadSummaryData(userId: string, since: Date): Promise<{ projects: ProjectRow[]; events: EventRow[]; comments: SummaryComment[]; tasks: SummaryTask[] }> {
  return withUser(userId, async (c) => {
    const projects = (
      await c.query(
        `select p.id, p.name, p.status, p.priority, p.deadline::text as deadline, p.next_step, p.description, p.phase, p.progress,
                p.archived_at, p.created_at, p.created_by, cr.display_name as creator_name, p.location_id, p.team_id,
                coalesce((select json_agg(json_build_object('id', pr.id, 'name', pr.display_name))
                          from project_assignees a join profiles pr on pr.id = a.user_id where a.project_id = p.id), '[]') as assignees
         from projects p join profiles cr on cr.id = p.created_by`,
      )
    ).rows as ProjectRow[];
    const events = (
      await c.query(
        `select id, project_id, event_type, field, old_value, new_value, subject_id, occurred_at
         from project_events where occurred_at > $1 order by occurred_at, id`,
        [since],
      )
    ).rows as EventRow[];
    const tasks = (
      await c.query(
        `select k.id, k.project_id, k.title, k.parent_id, k.due_date::text as due_date, k.completed_at,
                (select string_agg(pr.display_name, ', ' order by pr.display_name) from task_assignees ta join profiles pr on pr.id = ta.user_id where ta.task_id = k.id) as assignee_name
         from tasks k`,
      )
    ).rows as SummaryTask[];
    const comments = (
      await c.query(
        `select c.id, c.project_id, pr.display_name as author_name, c.body, c.parent_id, c.created_at, c.deleted_at
         from comments c join profiles pr on pr.id = c.author_id
         where c.created_at > $1 order by c.created_at, c.id`,
        [since],
      )
    ).rows as SummaryComment[];
    return { projects, events, comments, tasks };
  });
}
