import "server-only";
import { withUser } from "./db";
import { NotAllowedError } from "./projects";

export interface OrgUnit { id: string; name: string; color: string; sort_order: number; archived_at: Date | null }
export type OrgKind = "locations" | "teams";

/** Locations or teams, active first then archived. Readable by everyone active. */
export async function listOrg(userId: string, kind: OrgKind): Promise<OrgUnit[]> {
  const table = kind === "locations" ? "locations" : "teams"; // fixed names, never user input
  return withUser(userId, async (c) =>
    (await c.query(`select id, name, color, sort_order, archived_at from ${table} order by (archived_at is not null), sort_order, name`)).rows,
  );
}

/** Admin only; the database refuses anyone else. */
export async function createOrg(userId: string, kind: OrgKind, name: string, color: string): Promise<void> {
  const table = kind === "locations" ? "locations" : "teams";
  await withUser(userId, (c) =>
    c.query(`insert into ${table} (name, color, sort_order) values ($1, $2, coalesce((select max(sort_order) + 1 from ${table}), 0))`, [name, color]),
  );
}

export async function updateOrg(userId: string, kind: OrgKind, id: string, patch: { name?: string; color?: string; archived?: boolean }): Promise<void> {
  const table = kind === "locations" ? "locations" : "teams";
  await withUser(userId, async (c) => {
    const sets: string[] = [];
    const vals: unknown[] = [id];
    if (patch.name !== undefined) { vals.push(patch.name); sets.push(`name = $${vals.length}`); }
    if (patch.color !== undefined) { vals.push(patch.color); sets.push(`color = $${vals.length}`); }
    if (patch.archived !== undefined) sets.push(`archived_at = ${patch.archived ? "now()" : "null"}`);
    if (!sets.length) return;
    const r = await c.query(`update ${table} set ${sets.join(", ")} where id = $1`, vals);
    if (r.rowCount === 0) throw new NotAllowedError("Not allowed");
  });
}
