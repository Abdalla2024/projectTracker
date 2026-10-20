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

describe("project visibility", () => {
  it("member sees projects they created and projects an admin assigned to them", async () => {
    expect(await visible(m1)).toEqual(["P1 by member one", "P3 by admin"]);
    expect(await visible(m3)).toEqual(["P3 by admin"]);
  });

  it("member does not see another member's unassigned project", async () => {
    expect(await visible(m2)).toEqual(["P2 by member two"]);
    const direct = await asUser(m2, (c) => c.query("select * from projects where id = $1", [p1]));
    expect(direct.rowCount).toBe(0);
  });

  it("admin sees all projects", async () => {
    expect(await visible(admin)).toEqual(["P1 by member one", "P2 by member two", "P3 by admin"]);
  });

  it("no user context, or a disabled user, sees nothing", async () => {
    expect(await visible(null)).toEqual([]);
    expect(await visible(disabledUser)).toEqual([]);
  });

  it("comments, events, assignees and stores of an invisible project are invisible", async () => {
    for (const table of ["comments", "project_events", "project_assignees", "project_stores"]) {
      const r = await asUser(m2, (c) => c.query(`select * from ${table} where project_id = $1`, [p1]));
      expect(r.rowCount, table).toBe(0);
    }
  });

  it("profiles of strangers are hidden; people on shared projects are visible", async () => {
    const seenByM2 = await asUser(m2, async (c) => (await c.query("select email from profiles")).rows.map((r) => r.email));
    expect(seenByM2).toEqual(["two@tracker.test"]);
    const seenByM1 = await asUser(m1, async (c) => (await c.query("select email from profiles")).rows.map((r) => r.email).sort());
    expect(seenByM1).toEqual(["admin@tracker.test", "one@tracker.test", "three@tracker.test"]);
  });

  it("an assignment removal revokes access", async () => {
    const tmp = await createProject(admin, "Temp");
    await asUser(admin, (c) => c.query("insert into project_assignees (project_id, user_id, assigned_by) values ($1,$2,$3)", [tmp, m2, admin]));
    expect((await visible(m2)).includes("Temp")).toBe(true);
    await asUser(admin, (c) => c.query("delete from project_assignees where project_id = $1 and user_id = $2", [tmp, m2]));
    expect((await visible(m2)).includes("Temp")).toBe(false);
  });
});

describe("who may change what", () => {
  it("a member cannot create a project in someone else's name", async () => {
    await expect(
      asUser(m1, (c) => c.query("insert into projects (name, created_by) values ('forged', $1)", [m2])),
    ).rejects.toThrow(/row-level security/);
  });

  it("a member cannot edit or comment on a project they cannot see", async () => {
    const upd = await asUser(m2, (c) => c.query("update projects set name = 'hacked' where id = $1", [p1]));
    expect(upd.rowCount).toBe(0);
    await expect(
      asUser(m2, (c) => c.query("insert into comments (project_id, author_id, body) values ($1,$2,'hi')", [p1, m2])),
    ).rejects.toThrow(/row-level security/);
    expect((await owner.query("select name from projects where id = $1", [p1])).rows[0].name).toBe("P1 by member one");
  });

  it("a member cannot comment as someone else", async () => {
    await expect(
      asUser(m1, (c) => c.query("insert into comments (project_id, author_id, body) values ($1,$2,'fake')", [p1, admin])),
    ).rejects.toThrow(/row-level security/);
  });

  it("only an admin can assign, reassign or set stores", async () => {
    await expect(
      asUser(m1, (c) => c.query("insert into project_assignees (project_id, user_id, assigned_by) values ($1,$2,$3)", [p1, m1, m1])),
    ).rejects.toThrow(/row-level security|only an admin/);
    await expect(
      asUser(m1, (c) => c.query("insert into project_stores (project_id, store_id) select $1, id from stores limit 1", [p1])),
    ).rejects.toThrow(/row-level security|only an admin/);
    // Assignee (m3) of p3 cannot add or remove assignees either.
    await expect(
      asUser(m3, (c) => c.query("insert into project_assignees (project_id, user_id, assigned_by) values ($1,$2,$3)", [p3, m2, m3])),
    ).rejects.toThrow(/row-level security|only an admin/);
    const del = await asUser(m3, (c) => c.query("delete from project_assignees where project_id = $1 and user_id = $2", [p3, m1]));
    expect(del.rowCount).toBe(0);
  });

  it("an admin can assign a project to several members at once, and cannot assign a disabled user", async () => {
    const n = await asUser(admin, async (c) => (await c.query("select count(*)::int n from project_assignees where project_id = $1", [p3])).rows[0].n);
    expect(n).toBe(2);
    await expect(
      asUser(admin, (c) => c.query("insert into project_assignees (project_id, user_id, assigned_by) values ($1,$2,$3)", [p3, disabledUser, admin])),
    ).rejects.toThrow(/disabled/);
  });

  it("the creator can edit their own project", async () => {
    await asUser(m1, (c) => c.query("update projects set name = 'P1 renamed', priority = 'high' where id = $1", [p1]));
    expect((await owner.query("select name, priority from projects where id = $1", [p1])).rows[0]).toEqual({ name: "P1 renamed", priority: "high" });
    await asUser(m1, (c) => c.query("update projects set name = 'P1 by member one', priority = 'normal' where id = $1", [p1]));
  });

  it("an assigned member can change only status and next step", async () => {
    await asUser(m3, (c) => c.query("update projects set status = 'in_progress', next_step = 'call vendor' where id = $1", [p3]));
    for (const sql of [
      "update projects set name = 'x' where id = $1",
      "update projects set description = 'x' where id = $1",
      "update projects set priority = 'high' where id = $1",
      "update projects set deadline = '2030-01-01' where id = $1",
      "update projects set archived_at = now() where id = $1",
    ]) {
      await expect(asUser(m3, (c) => c.query(sql, [p3])), sql).rejects.toThrow(/only change status and next step/);
    }
  });

  it("creator, id and creation time can never change, even for an admin", async () => {
    await expect(asUser(admin, (c) => c.query("update projects set created_by = $2 where id = $1", [p1, admin]))).rejects.toThrow(/permission denied/);
    await expect(
      asOwnerActing(admin, (c) => c.query("update projects set created_by = $2 where id = $1", [p1, admin])),
    ).rejects.toThrow(/cannot change/);
  });

  it("an admin can edit any project and archive it; nobody can delete one", async () => {
    await asUser(admin, (c) => c.query("update projects set priority = 'low', archived_at = now() where id = $1", [p2]));
    await asUser(admin, (c) => c.query("update projects set archived_at = null where id = $1", [p2]));
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

  it("records comments, store changes, archive and removal events", async () => {
    await asUser(admin, async (c) => {
      await c.query("insert into project_stores (project_id, store_id) select $1, id from stores where name = 'Hampden'", [p3]);
      await c.query("delete from project_stores where project_id = $1", [p3]);
      await c.query("insert into comments (project_id, author_id, body) values ($1,$2,'feedback')", [p3, admin]);
      await c.query("update projects set archived_at = now() where id = $1", [p3]);
      await c.query("update projects set archived_at = null where id = $1", [p3]);
    });
    const ev = await owner.query("select event_type from project_events where project_id = $1 order by id desc limit 5", [p3]);
    expect(ev.rows.map((e) => e.event_type).reverse()).toEqual(["store_added", "store_removed", "commented", "archived", "unarchived"]);
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

  it("bumps updated_at when assignees, stores or comments change", async () => {
    const t0 = (await owner.query("select updated_at from projects where id = $1", [p1])).rows[0].updated_at;
    await new Promise((r) => setTimeout(r, 20));
    await asUser(m1, (c) => c.query("insert into comments (project_id, author_id, body) values ($1,$2,'again')", [p1, m1]));
    const t1 = (await owner.query("select updated_at from projects where id = $1", [p1])).rows[0].updated_at;
    expect(t1.getTime()).toBeGreaterThan(t0.getTime());
  });
});
