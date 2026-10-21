import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser, asOwnerActing, asUser, closePools, createProject, names, owner, resetDatabase } from "./helpers/db";

// All users here are synthetic and use the reserved .test TLD.
let admin: string, m1: string, m2: string, m3: string, disabledUser: string;
let p1: string, p2: string, p3: string; // p1 by m1, p2 by m2, p3 by admin (assigned to m1 and m3)

beforeAll(async () => {
  await resetDatabase();
  await owner.query("insert into admin_emails (email) values ('admin@tracker.test')");
  admin = (await addUser("admin@tracker.test", "Test Admin")).id;
  m1 = (await addUser("one@tracker.test", "Member One")).id;
  m2 = (await addUser("two@tracker.test", "Member Two")).id;
  m3 = (await addUser("three@tracker.test", "Member Three")).id;
  disabledUser = (await addUser("gone@tracker.test", "Gone Person")).id;

  p1 = await createProject(m1, "P1 by member one");
  p2 = await createProject(m2, "P2 by member two");
  p3 = await createProject(admin, "P3 by admin");
  await asUser(admin, async (c) => {
    await c.query("insert into project_assignees (project_id, user_id, assigned_by) values ($1,$2,$3),($1,$4,$3)", [
      p3,
      m1,
      admin,
      m3,
    ]);
  });
  await asUser(m1, (c) => c.query("insert into comments (project_id, author_id, body) values ($1,$2,'hello')", [p1, m1]));
  await owner.query("update profiles set disabled = true where id = $1", [disabledUser]);
});
afterAll(closePools);

const visible = (uid: string | null) => asUser(uid, async (c) => names((await c.query("select name from projects")).rows));

describe("roles", () => {
  it("every new account is a member unless its email is allowlisted", async () => {
    const roles = await owner.query("select email, role from profiles order by email");
    const byEmail = Object.fromEntries(roles.rows.map((r) => [r.email, r.role]));
    expect(byEmail["admin@tracker.test"]).toBe("admin");
    expect(byEmail["one@tracker.test"]).toBe("member");
  });

  it("cannot be set by inserting a profile with role=admin", async () => {
    const r = await owner.query("insert into profiles (email, display_name, role) values ('sneaky@tracker.test','Sneaky','admin') returning role");
    expect(r.rows[0].role).toBe("member");
  });

  it("the app role cannot write profiles at all (no self-promotion)", async () => {
    await expect(asUser(m1, (c) => c.query("update profiles set role = 'admin' where id = $1", [m1]))).rejects.toThrow(/permission denied/);
    await expect(asUser(m1, (c) => c.query("insert into profiles (email, display_name) values ('x@tracker.test','X')"))).rejects.toThrow(/permission denied/);
    expect((await owner.query("select role from profiles where id = $1", [m1])).rows[0].role).toBe("member");
  });

  it("allowlist changes sync existing accounts and are audited", async () => {
    await owner.query("insert into admin_emails (email) values ('two@tracker.test')");
    expect((await owner.query("select role from profiles where id = $1", [m2])).rows[0].role).toBe("admin");
    await owner.query("delete from admin_emails where email = 'two@tracker.test'");
    expect((await owner.query("select role from profiles where id = $1", [m2])).rows[0].role).toBe("member");
    const log = await owner.query("select old_role, new_role from role_changes where user_id = $1 order by id", [m2]);
    expect(log.rows.map((r) => `${r.old_role}>${r.new_role}`)).toEqual(["null>member", "member>admin", "admin>member"]);
  });
});

// Shared workspace (migration 008): every active account sees and works on every project.
describe("project visibility (shared workspace)", () => {
  it("every active member and admin sees every project", async () => {
    const all = ["P1 by member one", "P2 by member two", "P3 by admin"];
    for (const uid of [m1, m2, m3, admin]) expect(await visible(uid), uid).toEqual(all);
  });

  it("no user context, or a disabled user, sees nothing", async () => {
    expect(await visible(null)).toEqual([]);
    expect(await visible(disabledUser)).toEqual([]);
  });

  it("comments, events and assignees are shared too, but not with a disabled user", async () => {
    for (const table of ["comments", "project_events", "project_assignees"]) {
      const r = await asUser(m2, (c) => c.query(`select * from ${table} where project_id = $1`, [table === "project_assignees" ? p3 : p1]));
      expect(r.rowCount, table).toBeGreaterThan(0);
      const d = await asUser(disabledUser, (c) => c.query(`select * from ${table}`));
      expect(d.rowCount, `${table} for a disabled user`).toBe(0);
    }
  });

  it("everyone active can see everyone's profile (to assign work); a disabled user sees none", async () => {
    const seen = await asUser(m2, async (c) => (await c.query("select email from profiles")).rows.length);
    expect(seen).toBeGreaterThanOrEqual(5);
    expect((await asUser(disabledUser, (c) => c.query("select email from profiles"))).rowCount).toBe(0);
  });
});

describe("who may change what (shared workspace)", () => {
  it("a member cannot create a project in someone else's name", async () => {
    await expect(
      asUser(m1, (c) => c.query("insert into projects (name, created_by) values ('forged', $1)", [m2])),
    ).rejects.toThrow(/row-level security/);
  });

  it("a member cannot comment as someone else", async () => {
    await expect(
      asUser(m1, (c) => c.query("insert into comments (project_id, author_id, body) values ($1,$2,'fake')", [p1, admin])),
    ).rejects.toThrow(/row-level security/);
  });

  it("any member can assign and unassign people, and the history records it", async () => {
    const tmp = await createProject(m1, "Temp");
    await asUser(m2, (c) => c.query("insert into project_assignees (project_id, user_id, assigned_by) values ($1,$2,$3)", [tmp, m3, m2]));
    const by = await owner.query("select assigned_by from project_assignees where project_id = $1", [tmp]);
    expect(by.rows[0].assigned_by).toBe(m2);
    await asUser(m3, (c) => c.query("delete from project_assignees where project_id = $1 and user_id = $2", [tmp, m3]));
    const ev = await owner.query("select event_type, old_value from project_events where project_id = $1 and event_type like 'assignee_%' order by id", [tmp]);
    expect(ev.rows).toEqual([
      { event_type: "assignee_added", old_value: null },
      { event_type: "assignee_removed", old_value: "Member Three" },
    ]);
  });

  it("nobody can assign a disabled user", async () => {
    await expect(
      asUser(m1, (c) => c.query("insert into project_assignees (project_id, user_id, assigned_by) values ($1,$2,$3)", [p3, disabledUser, m1])),
    ).rejects.toThrow(/disabled/);
  });

  it("any member can edit any project's details", async () => {
    await asUser(m3, (c) => c.query("update projects set status = 'in_progress', next_step = 'call vendor' where id = $1", [p3]));
    await asUser(m2, (c) => c.query("update projects set name = 'P1 renamed', priority = 'high' where id = $1", [p1]));
    expect((await owner.query("select name, priority from projects where id = $1", [p1])).rows[0]).toEqual({ name: "P1 renamed", priority: "high" });
    await asUser(m1, (c) => c.query("update projects set name = 'P1 by member one', priority = 'normal' where id = $1", [p1]));
  });

  it("only the creator or an admin can archive or restore a project", async () => {
    await expect(asUser(m2, (c) => c.query("update projects set archived_at = now() where id = $1", [p1]))).rejects.toThrow(/only the creator or an admin/);
    await asUser(m1, (c) => c.query("update projects set archived_at = now() where id = $1", [p1]));
    await expect(asUser(m2, (c) => c.query("update projects set archived_at = null where id = $1", [p1]))).rejects.toThrow(/only the creator or an admin/);
    await asUser(admin, (c) => c.query("update projects set archived_at = null where id = $1", [p1]));
  });

  it("a disabled user cannot change anything", async () => {
    const r = await asUser(disabledUser, (c) => c.query("update projects set name = 'x' where id = $1", [p1]));
    expect(r.rowCount).toBe(0);
    await expect(asUser(disabledUser, (c) => c.query("insert into comments (project_id, author_id, body) values ($1,$2,'hi')", [p1, disabledUser]))).rejects.toThrow(/row-level security/);
  });

  it("creator, id and creation time can never change, even for an admin", async () => {
    await expect(asUser(admin, (c) => c.query("update projects set created_by = $2 where id = $1", [p1, admin]))).rejects.toThrow(/permission denied/);
    await expect(
      asOwnerActing(admin, (c) => c.query("update projects set created_by = $2 where id = $1", [p1, admin])),
    ).rejects.toThrow(/cannot change/);
  });

  it("nobody can delete a project", async () => {
    await expect(asUser(admin, (c) => c.query("delete from projects where id = $1", [p2]))).rejects.toThrow(/permission denied/);
  });

  it("a change without an acting user is refused", async () => {
    await expect(owner.query("update projects set next_step = 'no actor' where id = $1", [p1])).rejects.toThrow(/no acting user/);
  });
});

describe("history", () => {
  it("records each meaningful change with actor, old and new value", async () => {
    const ev = await asUser(admin, async (c) =>
      (await c.query(
        `select event_type, field, old_value, new_value, actor_id from project_events
         where project_id = $1 order by id`, [p3])).rows);
    const types = ev.map((e) => `${e.event_type}:${e.field}`);
    expect(types).toEqual([
      "created:name",
      "assignee_added:assignee",
      "assignee_added:assignee",
      "updated:status",
      "updated:next_step",
    ]);
    const status = ev.find((e) => e.field === "status");
    expect(status).toMatchObject({ old_value: "not_started", new_value: "in_progress", actor_id: m3 });
    expect(ev.filter((e) => e.event_type === "assignee_added").map((e) => e.new_value).sort()).toEqual(["Member One", "Member Three"]);
  });

  it("records comment and archive events", async () => {
    await asUser(admin, async (c) => {
      await c.query("insert into comments (project_id, author_id, body) values ($1,$2,'feedback')", [p3, admin]);
      await c.query("update projects set archived_at = now() where id = $1", [p3]);
      await c.query("update projects set archived_at = null where id = $1", [p3]);
    });
    const ev = await owner.query("select event_type from project_events where project_id = $1 order by id desc limit 3", [p3]);
    expect(ev.rows.map((e) => e.event_type).reverse()).toEqual(["commented", "archived", "unarchived"]);
  });

  it("is append-only for the app role and for the owner", async () => {
    for (const sql of ["insert into project_events (project_id, actor_id, event_type) values ($1, $2, 'created')"]) {
      await expect(asUser(admin, (c) => c.query(sql, [p3, admin]))).rejects.toThrow(/permission denied/);
    }
    await expect(asUser(admin, (c) => c.query("update project_events set new_value = 'x'"))).rejects.toThrow(/permission denied/);
    await expect(asUser(admin, (c) => c.query("delete from project_events"))).rejects.toThrow(/permission denied/);
    await expect(owner.query("update project_events set new_value = 'x'")).rejects.toThrow(/append-only/);
    await expect(owner.query("delete from project_events")).rejects.toThrow(/append-only/);
    await expect(owner.query("truncate project_events")).rejects.toThrow(/append-only/);
  });

  it("a failed change leaves no history behind (same transaction)", async () => {
    const before = (await owner.query("select count(*)::int n from project_events")).rows[0].n;
    await expect(
      asUser(m1, async (c) => {
        await c.query("update projects set name = 'will roll back' where id = $1", [p1]);
        await c.query("update projects set status = 'bogus' where id = $1", [p1]);
      }),
    ).rejects.toThrow();
    expect((await owner.query("select count(*)::int n from project_events")).rows[0].n).toBe(before);
  });

  it("bumps updated_at when assignees or comments change", async () => {
    const t0 = (await owner.query("select updated_at from projects where id = $1", [p1])).rows[0].updated_at;
    await new Promise((r) => setTimeout(r, 20));
    await asUser(m1, (c) => c.query("insert into comments (project_id, author_id, body) values ($1,$2,'again')", [p1, m1]));
    const t1 = (await owner.query("select updated_at from projects where id = $1", [p1])).rows[0].updated_at;
    expect(t1.getTime()).toBeGreaterThan(t0.getTime());
  });
});
