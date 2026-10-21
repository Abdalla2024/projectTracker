import { describe, expect, it } from "vitest";
import { buildWeeklySummary, stateAt, type EventRow, type ProjectRow } from "@/lib/summary";

const Z = "America/New_York";
// Window: Mon Oct 19 2026 00:00 EDT -> Fri Oct 23 2026 12:00 EDT
const START = new Date("2026-10-19T04:00:00Z");
const END = new Date("2026-10-23T16:00:00Z");
const before = (h: number) => new Date(START.getTime() - h * 3600_000);
const after = (h: number) => new Date(START.getTime() + h * 3600_000);

let seq = 0;
const ev = (project_id: string, at: Date, event_type: string, extra: Partial<EventRow> = {}): EventRow => ({
  id: ++seq, project_id, event_type, field: null, old_value: null, new_value: null, subject_id: null, occurred_at: at, ...extra,
});
const proj = (id: string, name: string, extra: Partial<ProjectRow> = {}): ProjectRow => ({
  id, name, status: "not_started", priority: "normal", deadline: null, next_step: "", description: "", phase: "", progress: 0,
  archived_at: null, created_at: before(48), created_by: "creator", creator_name: "Creator", assignees: [], ...extra,
});
const upd = (pid: string, at: Date, field: string, o: string | null, n: string | null) =>
  ev(pid, at, "updated", { field, old_value: o, new_value: n });

describe("stateAt", () => {
  it("is null before the project was created", () => {
    expect(stateAt(proj("a", "A", { created_at: after(1) }), [], START)).toBeNull();
  });

  it("undoes only the events after the instant, newest first", () => {
    const p = proj("a", "A", { status: "done", next_step: "c" });
    const events = [
      upd("a", before(10), "status", "not_started", "in_progress"), // before START: stays applied
      upd("a", after(5), "status", "in_progress", "blocked"),
      upd("a", after(9), "status", "blocked", "done"),
      upd("a", after(6), "next_step", "a", "b"),
      upd("a", after(8), "next_step", "b", "c"),
    ];
    const s = stateAt(p, events, START)!;
    expect(s.status).toBe("in_progress");
    expect(s.next_step).toBe("a");
    expect(stateAt(p, events, after(7))!.status).toBe("blocked");
  });

  it("rebuilds assignee and archive state", () => {
    const p = proj("a", "A", {
      assignees: [{ id: "u1", name: "One" }, { id: "u3", name: "Three" }],
      archived_at: after(20),
    });
    const events = [
      ev("a", after(1), "assignee_added", { subject_id: "u1", new_value: "One" }),
      ev("a", after(2), "assignee_removed", { subject_id: "u2", old_value: "Two" }),
      ev("a", after(20), "archived"),
    ];
    const s = stateAt(p, events, START)!;
    expect([...s.assignees.values()].sort()).toEqual(["Three", "Two"]);
    expect(s.archived).toBe(false);
  });
});

describe("buildWeeklySummary", () => {
  const run = (projects: ProjectRow[], events: EventRow[]) => buildWeeklySummary({ projects, events, start: START, end: END, zone: Z });

  it("compares Monday 00:00 with now and reports each kind of change", () => {
    const projects = [
      proj("new", "New one", { created_at: after(2), status: "in_progress", assignees: [{ id: "u1", name: "One" }] }),
      proj("blk", "Became blocked", { status: "blocked" }),
      proj("done", "Finished", { status: "done" }),
      proj("quiet", "Quiet"),
      proj("moved", "Reassigned", { assignees: [{ id: "u2", name: "Two" }, { id: "u3", name: "Three" }], deadline: "2026-11-30" }),
      proj("late", "Past due", { deadline: "2026-10-20", status: "in_progress" }),
      proj("soon", "Due soon", { deadline: "2026-10-28" }),
      proj("far", "Due far out", { deadline: "2026-12-31" }),
      proj("fin", "Finished late", { deadline: "2026-10-01", status: "done" }),
    ];
    const events = [
      ev("new", after(2), "created", { field: "name", new_value: "New one" }),
      upd("blk", after(10), "status", "in_progress", "blocked"),
      upd("done", after(11), "status", "in_progress", "done"),
      ev("moved", after(12), "assignee_added", { subject_id: "u3", new_value: "Three" }),
      ev("moved", after(13), "assignee_removed", { subject_id: "u1", old_value: "One" }),
      upd("moved", after(14), "deadline", "2026-11-15", "2026-11-30"),
      ev("moved", after(15), "commented", { field: "comment" }),
      ev("moved", before(5), "commented", { field: "comment" }), // before the window: not counted
    ];
    // "blk" and "done" must have been in_progress at the start
    const s = run(projects, events);
    const get = (id: string) => s.projects.find((p) => p.id === id)!;

    expect(get("new").isNew).toBe(true);
    expect(get("blk")).toMatchObject({ newlyBlocked: true, statusChange: { from: "in_progress", to: "blocked" } });
    expect(get("done")).toMatchObject({ completed: true });
    expect(get("moved")).toMatchObject({
      assigneesAdded: ["Three"], assigneesRemoved: ["One"],
      deadlineChange: { from: "2026-11-15", to: "2026-11-30" }, comments: 1,
    });
    expect(get("late").deadlineFlag).toBe("missed");
    expect(get("soon").deadlineFlag).toBe("approaching");
    expect(s.projects.find((p) => p.id === "far")).toBeUndefined(); // unchanged, no flag: not reported
    expect(s.projects.find((p) => p.id === "quiet")).toBeUndefined();
    expect(s.projects.find((p) => p.id === "fin")).toBeUndefined(); // done: deadline no longer matters
    expect(s.totals).toMatchObject({ created: 1, completed: 1, newlyBlocked: 1, blockedAtEnd: 1, missedDeadlines: 1, approachingDeadlines: 1 });
    expect(s.totals.withChanges + s.totals.unchanged).toBe(projects.length);
  });

  it("puts urgent items first", () => {
    const s = run(
      [proj("a", "Alpha", { deadline: "2026-10-20" }), proj("b", "Beta", { status: "blocked" })],
      [upd("b", after(5), "status", "in_progress", "blocked")],
    );
    expect(s.projects.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("evaluates a deadline against the local date, not UTC", () => {
    // END = Fri Oct 23 12:00 EDT. A deadline of Oct 22 is already missed; Oct 23 (today) is approaching.
    const s = run([proj("x", "X", { deadline: "2026-10-22" }), proj("y", "Y", { deadline: "2026-10-23" })], []);
    expect(s.projects.find((p) => p.id === "x")!.deadlineFlag).toBe("missed");
    expect(s.projects.find((p) => p.id === "y")!.deadlineFlag).toBe("approaching");
  });

  it("reports a project created and finished inside the window as new and completed", () => {
    const s = run(
      [proj("n", "N", { created_at: after(2), status: "done" })],
      [ev("n", after(2), "created"), upd("n", after(3), "status", "not_started", "done")],
    );
    expect(s.projects[0]).toMatchObject({ isNew: true, completed: true });
  });

  it("ignores projects created after the window ends", () => {
    const s = run([proj("late", "Later", { created_at: new Date(END.getTime() + 1000) })], []);
    expect(s.projects).toEqual([]);
    expect(s.totals.activeAtEnd).toBe(0);
  });

  it("is empty-safe", () => {
    expect(run([], []).totals.activeAtEnd).toBe(0);
  });
});
