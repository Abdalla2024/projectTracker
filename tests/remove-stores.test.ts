// Upgrade path for migration 003 (store selection removed): build a database as it was at
// migration 002 with real store data and history, upgrade it, and check what was kept and removed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser, asOwnerActing, asUser, closePools, migrateToLatest, owner, resetDatabase } from "./helpers/db";

let admin: string, member: string, projectId: string;

beforeAll(async () => {
  await resetDatabase({ upTo: "002_security.sql" });
  await owner.query("insert into admin_emails (email) values ('admin@tracker.test')");
  admin = (await addUser("admin@tracker.test", "Test Admin")).id;
  member = (await addUser("member@tracker.test", "Test Member")).id;
  projectId = await asOwnerActing(admin, async (c) => {
    const r = await c.query("insert into projects (name, created_by) values ('Had a store', $1) returning id", [admin]);
    await c.query("insert into project_stores (project_id, store_id) select $1, id from stores limit 1", [r.rows[0].id]);
    return r.rows[0].id as string;
  });
});
afterAll(closePools);

describe("migration 003: remove stores", () => {
  it("starts from a database that has store data and store history", async () => {
    expect((await owner.query("select count(*)::int n from project_stores")).rows[0].n).toBe(1);
    expect((await owner.query("select count(*)::int n from project_events where event_type = 'store_added'")).rows[0].n).toBe(1);
  });

  it("applies cleanly to that database, and a second run does nothing", async () => {
    await migrateToLatest();
    await migrateToLatest();
    expect((await owner.query("select name from schema_migrations order by name")).rows.map((r) => r.name)).toEqual([
      "001_schema.sql", "002_security.sql", "003_remove_stores.sql",
    ]);
  });

  it("removes the store tables and functions", async () => {
    const r = await owner.query(
      "select to_regclass('public.stores') s, to_regclass('public.project_stores') ps, to_regproc('project_stores_log') f1, to_regproc('project_stores_guard') f2",
    );
    expect(r.rows[0]).toEqual({ s: null, ps: null, f1: null, f2: null });
  });

  it("keeps the existing history rows (append-only is not rewritten)", async () => {
    const r = await owner.query("select count(*)::int n from project_events where project_id = $1 and event_type = 'store_added'", [projectId]);
    expect(r.rows[0].n).toBe(1);
    await expect(owner.query("delete from project_events where project_id = $1", [projectId])).rejects.toThrow(/append-only/);
  });

  it("refuses any new store event", async () => {
    await expect(
      owner.query("insert into project_events (project_id, actor_id, event_type) values ($1, $2, 'store_added')", [projectId, admin]),
    ).rejects.toThrow(/event_type_check/);
  });

  it("leaves the rest of the app working after the upgrade", async () => {
    const id = await asUser(member, async (c) =>
      (await c.query("insert into projects (name, created_by) values ('After upgrade', $1) returning id", [member])).rows[0].id,
    );
    const ev = await asUser(member, async (c) => (await c.query("select event_type from project_events where project_id = $1", [id])).rows);
    expect(ev).toEqual([{ event_type: "created" }]);
    const other = await asUser(member, async (c) => (await c.query("select name from projects")).rows.map((r) => r.name));
    expect(other).toEqual(["After upgrade"]); // still can't see the admin's project
  });
});
