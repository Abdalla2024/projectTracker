import "server-only";
import type pg from "pg";
import { withUser } from "./db";
import type { EventRow, ProjectRow } from "./summary";

// Note: none of these functions filter by "who may see this". The database does that (row-level
// security). They are plain queries; a bug here can show less, never more, than the user may see.

export interface ProjectListItem {
  id: string;
  name: string;
  status: string;
  priority: string;
  deadline: string | null;
  next_step: string;
  archived_at: Date | null;
  updated_at: Date;
  created_by: string;
  creator_name: string;
  assignees: string[];
  stores: string[];
}

export interface Person { id: string; name: string; email?: string }

export interface ProjectDetail {
  id: string;
  name: string;
  description: string;
  status: string;
  priority: string;
  deadline: string | null;
  next_step: string;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  creator_name: string;
  assignees: Person[];
  stores: Person[];
  comments: { id: string; author_name: string; body: string; created_at: Date }[];
  events: (EventRow & { actor_name: string })[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

export class NotAllowedError extends Error {}

export async function listProjects(userId: string, includeArchived: boolean): Promise<ProjectListItem[]> {
  return withUser(userId, async (c) => {
    const r = await c.query(
      `select p.id, p.name, p.status, p.priority, p.deadline::text as deadline, p.next_step, p.archived_at,
              p.updated_at, p.created_by, cr.display_name as creator_name,
              coalesce((select json_agg(pr.display_name order by pr.display_name)
                        from project_assignees a join profiles pr on pr.id = a.user_id
                        where a.project_id = p.id), '[]') as assignees,
              coalesce((select json_agg(s.name order by s.sort_order)
                        from project_stores ps join stores s on s.id = ps.store_id
                        where ps.project_id = p.id), '[]') as stores
       from projects p join profiles cr on cr.id = p.created_by
       where ($1 or p.archived_at is null)
       order by (p.status in ('done','cancelled')), p.deadline nulls last, p.updated_at desc`,
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
                p.archived_at, p.created_at, p.updated_at, p.created_by, cr.display_name as creator_name
         from projects p join profiles cr on cr.id = p.created_by where p.id = $1`,
        [id],
      )
    ).rows[0];
    if (!p) return null;
    const [assignees, stores, comments, events] = await Promise.all([
      c.query(`select pr.id, pr.display_name as name, pr.email from project_assignees a join profiles pr on pr.id = a.user_id
               where a.project_id = $1 order by pr.display_name`, [id]),
      c.query(`select s.id, s.name from project_stores ps join stores s on s.id = ps.store_id
               where ps.project_id = $1 order by s.sort_order`, [id]),
      c.query(`select c.id, pr.display_name as author_name, c.body, c.created_at from comments c
               join profiles pr on pr.id = c.author_id where c.project_id = $1 order by c.created_at, c.id`, [id]),
      c.query(`select e.id, e.project_id, e.event_type, e.field, e.old_value, e.new_value, e.subject_id, e.occurred_at,
                      pr.display_name as actor_name
               from project_events e join profiles pr on pr.id = e.actor_id
               where e.project_id = $1 order by e.occurred_at desc, e.id desc`, [id]),
    ]);
    return { ...p, assignees: assignees.rows, stores: stores.rows, comments: comments.rows, events: events.rows };
  });
}

/** People an admin can assign (all enabled accounts). A member only gets themselves and project colleagues. */
export async function listPeople(userId: string): Promise<Person[]> {
  return withUser(userId, async (c) =>
    (await c.query("select id, display_name as name, email from profiles where not disabled order by display_name")).rows,
  );
}

export async function listStores(userId: string): Promise<Person[]> {
  return withUser(userId, async (c) =>
    (await c.query("select id, name from stores where active order by sort_order, name")).rows,
  );
}

export interface NewProject {
  name: string;
  description: string;
  status: string;
  priority: string;
  deadline: string | null;
  next_step: string;
  /** Honored only for admins; the database refuses it otherwise. */
  assigneeIds: string[];
  storeIds: string[];
}

export async function createProject(user: { id: string; role: string }, input: NewProject): Promise<string> {
  return withUser(user.id, async (c) => {
    const r = await c.query(
      `insert into projects (name, description, status, priority, deadline, next_step, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [input.name, input.description, input.status, input.priority, input.deadline, input.next_step, user.id],
    );
    const id: string = r.rows[0].id;
    if (user.role === "admin") {
      await replaceAssignees(c, id, input.assigneeIds, user.id);
      await replaceStores(c, id, input.storeIds);
    }
    return id;
  });
}

const EDITABLE = ["name", "description", "status", "priority", "deadline", "next_step"] as const;
export type ProjectPatch = Partial<Record<(typeof EDITABLE)[number], string | null>>;

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

async function replaceStores(c: pg.PoolClient, projectId: string, wanted: string[]) {
  const current = (await c.query("select store_id from project_stores where project_id = $1", [projectId])).rows.map((r) => r.store_id as string);
  const want = new Set(wanted);
  for (const sid of current.filter((s) => !want.has(s))) {
    await c.query("delete from project_stores where project_id = $1 and store_id = $2", [projectId, sid]);
  }
  for (const sid of wanted.filter((s) => !current.includes(s))) {
    await c.query("insert into project_stores (project_id, store_id) values ($1,$2)", [projectId, sid]);
  }
}

export async function setAssignmentsAndStores(userId: string, id: string, assigneeIds: string[], storeIds: string[]): Promise<void> {
  await withUser(userId, async (c) => {
    await replaceAssignees(c, id, assigneeIds, userId);
    await replaceStores(c, id, storeIds);
  });
}

export async function addComment(userId: string, id: string, body: string): Promise<void> {
  await withUser(userId, (c) =>
    c.query("insert into comments (project_id, author_id, body) values ($1,$2,$3)", [id, userId, body]),
  );
}

/** Everything the weekly summary needs, already limited to what this user may see. */
export async function loadSummaryData(userId: string, since: Date): Promise<{ projects: ProjectRow[]; events: EventRow[] }> {
  return withUser(userId, async (c) => {
    const projects = (
      await c.query(
        `select p.id, p.name, p.status, p.priority, p.deadline::text as deadline, p.next_step, p.archived_at, p.created_at,
                coalesce((select json_agg(json_build_object('id', pr.id, 'name', pr.display_name))
                          from project_assignees a join profiles pr on pr.id = a.user_id where a.project_id = p.id), '[]') as assignees,
                coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name))
                          from project_stores ps join stores s on s.id = ps.store_id where ps.project_id = p.id), '[]') as stores
         from projects p`,
      )
    ).rows as ProjectRow[];
    const events = (
      await c.query(
        `select id, project_id, event_type, field, old_value, new_value, subject_id, occurred_at
         from project_events where occurred_at > $1 order by occurred_at, id`,
        [since],
      )
    ).rows as EventRow[];
    return { projects, events };
  });
}
