import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser, asUser, closePools, createProject, owner, resetDatabase } from "./helpers/db";

// Synthetic users and organisation names only.
let admin: string, m1: string, m2: string, gone: string, p1: string, p2: string;

beforeAll(async () => {
  await resetDatabase();
  await owner.query("insert into admin_emails (email) values ('admin@tracker.test')");
  admin = (await addUser("admin@tracker.test", "Test Admin")).id;
  m1 = (await addUser("one@tracker.test", "Member One")).id;
  m2 = (await addUser("two@tracker.test", "Member Two")).id;
  gone = (await addUser("gone@tracker.test", "Gone Person")).id;
  await owner.query("update profiles set disabled = true where id = $1", [gone]);
  p1 = await createProject(m1, "P1");
  p2 = await createProject(m2, "P2");
});
afterAll(closePools);

const types = async (project: string) =>
  (await owner.query("select event_type, field, old_value, new_value from project_events where project_id = $1 order by id", [project])).rows;

describe("locations and teams", () => {
  let loc: string, team: string;
  it("only an admin can create, rename or archive them; everyone active can read them", async () => {
    await expect(asUser(m1, (c) => c.query("insert into locations (name) values ('Demo Store X')"))).rejects.toThrow(/row-level security/);
    loc = await asUser(admin, async (c) => (await c.query("insert into locations (name, color) values ('Demo Store A', '#2a78d6') returning id")).rows[0].id);
    team = await asUser(admin, async (c) => (await c.query("insert into teams (name) values ('Demo HR') returning id")).rows[0].id);
    const renamed = await asUser(m1, (c) => c.query("update locations set name = 'Hijack' where id = $1", [loc]));
    expect(renamed.rowCount).toBe(0);
    expect((await asUser(m2, (c) => c.query("select name from locations"))).rows).toEqual([{ name: "Demo Store A" }]);
    expect((await asUser(gone, (c) => c.query("select name from teams"))).rowCount).toBe(0);
    await expect(asUser(admin, (c) => c.query("delete from teams where id = $1", [team]))).rejects.toThrow(/permission denied/);
  });

  it("refuses bad names and colours", async () => {
    await expect(asUser(admin, (c) => c.query("insert into teams (name) values ('  ')"))).rejects.toThrow(/teams_name_check/);
    await expect(asUser(admin, (c) => c.query("insert into teams (name, color) values ('X', 'red')"))).rejects.toThrow(/teams_color_check/);
    await expect(asUser(admin, (c) => c.query("insert into locations (name) values ('Demo Store A')"))).rejects.toThrow(/duplicate/);
  });

  it("any member can file a project under a location and team, and the history keeps the names", async () => {
    await asUser(m2, (c) => c.query("update projects set location_id = $2, team_id = $3 where id = $1", [p1, loc, team]));
    const ev = (await types(p1)).filter((e) => e.event_type === "updated");
    expect(ev).toEqual([
      { event_type: "updated", field: "location", old_value: null, new_value: "Demo Store A" },
      { event_type: "updated", field: "team", old_value: null, new_value: "Demo HR" },
    ]);
  });
});

describe("sections and tasks", () => {
  let s1: string, s2other: string, t1: string;

  it("any member can add sections and tasks; the creator is the acting user", async () => {
    s1 = await asUser(m2, async (c) => (await c.query("insert into sections (project_id, name) values ($1, 'To do') returning id", [p1])).rows[0].id);
    s2other = await asUser(m1, async (c) => (await c.query("insert into sections (project_id, name) values ($1, 'Elsewhere') returning id", [p2])).rows[0].id);
    t1 = await asUser(m2, async (c) =>
      (await c.query("insert into tasks (project_id, section_id, title, assignee_id, due_date, created_by) values ($1,$2,'Order signs',$3,'2026-11-01',$4) returning id", [p1, s1, m1, m2])).rows[0].id);
    await expect(asUser(m2, (c) => c.query("insert into tasks (project_id, title, created_by) values ($1,'forged',$2)", [p1, m1]))).rejects.toThrow(/row-level security/);
    expect((await types(p1)).at(-1)).toMatchObject({ event_type: "task_added", new_value: "Order signs" });
  });

  it("a task cannot point at another project's section, a disabled assignee, or move projects", async () => {
    await expect(asUser(m1, (c) => c.query("update tasks set section_id = $2 where id = $1", [t1, s2other]))).rejects.toThrow(/another project/);
    await expect(asUser(m1, (c) => c.query("update tasks set assignee_id = $2 where id = $1", [t1, gone]))).rejects.toThrow(/disabled/);
    await expect(asUser(m1, (c) => c.query("update tasks set project_id = $2 where id = $1", [t1, p2]))).rejects.toThrow(/permission denied/);
  });

  it("subtasks go one level deep, inside the same project", async () => {
    const sub = await asUser(m1, async (c) => (await c.query("insert into tasks (project_id, parent_id, title, created_by) values ($1,$2,'Measure wall',$3) returning id", [p1, t1, m1])).rows[0].id);
    await expect(asUser(m1, (c) => c.query("insert into tasks (project_id, parent_id, title, created_by) values ($1,$2,'Too deep',$3)", [p1, sub, m1]))).rejects.toThrow(/top-level task/);
    await expect(asUser(m1, (c) => c.query("insert into tasks (project_id, parent_id, title, created_by) values ($1,$2,'Wrong project',$3)", [p2, t1, m1]))).rejects.toThrow(/top-level task/);
  });

  it("completing stamps who and when in the database; reopening clears it; both are logged", async () => {
    await asUser(m1, (c) => c.query("update tasks set completed_at = '2000-01-01' where id = $1", [t1]));
    const done = (await owner.query("select completed_at, completed_by from tasks where id = $1", [t1])).rows[0];
    expect(done.completed_by).toBe(m1);
    expect(done.completed_at.getFullYear()).toBeGreaterThan(2020); // the database time, not the one sent
    await asUser(m2, (c) => c.query("update tasks set completed_at = null where id = $1", [t1]));
    expect((await owner.query("select completed_by from tasks where id = $1", [t1])).rows[0].completed_by).toBeNull();
    const ev = (await types(p1)).map((e) => e.event_type);
    expect(ev).toContain("task_completed");
    expect(ev).toContain("task_reopened");
  });

  it("reassigning is logged with the new person's name", async () => {
    await asUser(m2, (c) => c.query("update tasks set assignee_id = $2 where id = $1", [t1, m2]));
    expect((await types(p1)).at(-1)).toMatchObject({ event_type: "task_assigned", old_value: "Order signs", new_value: "Member Two" });
  });

  it("deleting a task removes its subtasks and leaves a history entry", async () => {
    await asUser(m2, (c) => c.query("delete from tasks where id = $1", [t1]));
    expect((await owner.query("select count(*)::int n from tasks where project_id = $1", [p1])).rows[0].n).toBe(0);
    expect((await types(p1)).filter((e) => e.event_type === "task_deleted").map((e) => e.old_value).sort()).toEqual(["Measure wall", "Order signs"]);
  });

  it("a disabled user cannot see or change tasks; a task change without an acting user is refused", async () => {
    expect((await asUser(gone, (c) => c.query("select * from tasks"))).rowCount).toBe(0);
    await expect(owner.query("insert into tasks (project_id, title, created_by) values ($1,'x',$2)", [p1, m1])).rejects.toThrow(/no acting user/);
  });
});
