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
      (await c.query("insert into tasks (project_id, section_id, title, due_date, created_by) values ($1,$2,'Order signs','2026-11-01',$3) returning id", [p1, s1, m2])).rows[0].id);
    await expect(asUser(m2, (c) => c.query("insert into tasks (project_id, title, created_by) values ($1,'forged',$2)", [p1, m1]))).rejects.toThrow(/row-level security/);
    expect(await types(p1)).toContainEqual({ event_type: "task_added", field: "task", old_value: null, new_value: "Order signs" });
  });

  it("a task cannot point at another project's section, a disabled assignee, or move projects", async () => {
    await expect(asUser(m1, (c) => c.query("update tasks set section_id = $2 where id = $1", [t1, s2other]))).rejects.toThrow(/another project/);
    await expect(asUser(m1, (c) => c.query("insert into task_assignees (task_id, user_id, assigned_by) values ($1,$2,$3)", [t1, gone, m1]))).rejects.toThrow(/disabled/);
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

  it("a task can have several assignees; adding and removing them is logged with names", async () => {
    await asUser(m2, (c) => c.query("insert into task_assignees (task_id, user_id, assigned_by) values ($1,$2,$3), ($1,$4,$3)", [t1, m1, m2, m2]));
    const who = (await owner.query("select user_id, assigned_by from task_assignees where task_id = $1 order by user_id", [t1])).rows;
    expect(who.map((r) => r.user_id).sort()).toEqual([m1, m2].sort());
    expect(who.every((r) => r.assigned_by === m2)).toBe(true);
    await asUser(m1, (c) => c.query("delete from task_assignees where task_id = $1 and user_id = $2", [t1, m2]));
    const ev = (await types(p1)).filter((e) => e.event_type.startsWith("task_") && e.event_type.includes("assign"));
    expect(ev.map((e) => `${e.event_type}:${e.new_value}`)).toEqual(["task_assigned:Member One", "task_assigned:Member Two", "task_unassigned:Member Two"]);
    expect((await asUser(gone, (c) => c.query("select * from task_assignees"))).rowCount).toBe(0);
  });

  it("deleting a task removes its subtasks and assignees and leaves one history entry per task", async () => {
    await asUser(m2, (c) => c.query("delete from tasks where id = $1", [t1]));
    expect((await owner.query("select count(*)::int n from tasks where project_id = $1", [p1])).rows[0].n).toBe(0);
    expect((await types(p1)).filter((e) => e.event_type === "task_deleted").map((e) => e.old_value).sort()).toEqual(["Measure wall", "Order signs"]);
  });

  it("a disabled user cannot see or change tasks; a task change without an acting user is refused", async () => {
    expect((await asUser(gone, (c) => c.query("select * from tasks"))).rowCount).toBe(0);
    await expect(owner.query("insert into tasks (project_id, title, created_by) values ($1,'x',$2)", [p1, m1])).rejects.toThrow(/no acting user/);
  });
});

describe("tasks drive status, current phase and progress (migrations 010-011)", () => {
  let p: string;
  const state = async () => (await owner.query("select status, phase, progress from projects where id = $1", [p])).rows[0];
  const add = (title: string, extra: { section?: string; parent?: string } = {}) => asUser(m1, async (c) =>
    (await c.query("insert into tasks (project_id, title, section_id, parent_id, created_by, sort_order) values ($1,$2,$3,$4,$5, coalesce((select max(sort_order)+1 from tasks where project_id = $1), 0)) returning id",
      [p, title, extra.section ?? null, extra.parent ?? null, m1])).rows[0].id as string);
  const tick = (id: string, done = true) => asUser(m2, (c) => c.query(`update tasks set completed_at = ${done ? "now()" : "null"} where id = $1`, [id]));
  let a: string, b: string, c3: string, d: string;

  it("a project without tasks is not started at 0%, whatever is typed", async () => {
    p = await createProject(m1, "Auto");
    await asUser(m1, (c) => c.query("update projects set progress = 30, status = 'in_progress' where id = $1", [p]));
    expect(await state()).toEqual({ status: "not_started", phase: "", progress: 0 });
  });

  it("status, phase and progress follow the tasks as they are ticked off", async () => {
    a = await add("Plan"); b = await add("Build"); c3 = await add("Test"); d = await add("Launch");
    expect(await state()).toEqual({ status: "not_started", phase: "Plan", progress: 0 });
    await tick(a);
    expect(await state()).toEqual({ status: "in_progress", phase: "Build", progress: 25 });
    await tick(c3); // out of order: the phase is still the first unfinished task
    expect(await state()).toEqual({ status: "in_progress", phase: "Build", progress: 50 });
    await add("Measure", { parent: a }); // subtasks do not count
    expect((await state()).progress).toBe(50);
    await tick(b); await tick(d);
    expect(await state()).toEqual({ status: "done", phase: "", progress: 100 });
    await tick(d, false);
    expect(await state()).toEqual({ status: "in_progress", phase: "Launch", progress: 75 });
  });

  it("the phase follows the order shown: tasks without a section first, then sections in order", async () => {
    const s2 = await asUser(m1, async (c) => (await c.query("insert into sections (project_id, name, sort_order) values ($1, 'Later', 2) returning id", [p])).rows[0].id as string);
    const s1 = await asUser(m1, async (c) => (await c.query("insert into sections (project_id, name, sort_order) values ($1, 'Sooner', 1) returning id", [p])).rows[0].id as string);
    await asUser(m1, (c) => c.query("update tasks set section_id = $2 where id = $1", [d, s2]));
    await add("Prep", { section: s1 });
    expect((await state()).phase).toBe("Prep");
    // Reordering sections re-computes the phase.
    await asUser(m1, (c) => c.query("update sections set sort_order = 0 where id = $1", [s2]));
    expect((await state()).phase).toBe("Launch");
  });

  it("stuck and cancelled are manual flags that survive task changes; clearing them returns to automatic", async () => {
    await asUser(m1, (c) => c.query("update projects set status = 'blocked' where id = $1", [p]));
    await tick(d);
    expect((await state()).status).toBe("blocked");
    expect((await state()).progress).toBeGreaterThan(75);
    await asUser(m1, (c) => c.query("update projects set status = 'not_started' where id = $1", [p]));
    expect((await state()).status).toBe("in_progress");
  });

  it("every computed change is in the history", async () => {
    const ev = (await owner.query("select field from project_events where project_id = $1 and event_type = 'updated'", [p])).rows.map((r) => r.field);
    for (const f of ["status", "phase", "progress"]) expect(ev).toContain(f);
  });
});

describe("one-time catch-up (migration 012)", () => {
  it("re-applying it leaves computed values unchanged and adds no history", async () => {
    const before = (await owner.query("select id, status, phase, progress from projects order by id")).rows;
    const events = (await owner.query("select count(*)::int n from project_events")).rows[0].n;
    const fs = await import("node:fs");
    const sql = fs.readFileSync(new URL("../db/migrations/012_recompute_projects.sql", import.meta.url), "utf8");
    await owner.query(sql);
    expect((await owner.query("select id, status, phase, progress from projects order by id")).rows).toEqual(before);
    expect((await owner.query("select count(*)::int n from project_events")).rows[0].n).toBe(events);
  });
});

describe("critical priority (migration 013)", () => {
  it("accepts critical and still refuses unknown priorities", async () => {
    const p = await createProject(m1, "Urgent one");
    await asUser(m1, (c) => c.query("update projects set priority = 'critical' where id = $1", [p]));
    expect((await owner.query("select priority from projects where id = $1", [p])).rows[0].priority).toBe("critical");
    await expect(asUser(m1, (c) => c.query("update projects set priority = 'urgent' where id = $1", [p]))).rejects.toThrow(/priority_check/);
  });
});
