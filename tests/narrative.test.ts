import { describe, expect, it } from "vitest";
import { buildNarrative, describeInline } from "@/lib/narrative";
import type { EventRow, ProjectRow } from "@/lib/summary";

const Z = "America/New_York";
const START = new Date("2026-10-19T04:00:00Z"); // Mon Oct 19 00:00 EDT
const END = new Date("2026-10-21T16:00:00Z"); // Wed Oct 21 12:00 EDT
const at = (h: number) => new Date(START.getTime() + h * 3600_000);
const before = (h: number) => new Date(START.getTime() - h * 3600_000);

let seq = 0;
const ev = (project_id: string, when: Date, event_type: string, extra: Partial<EventRow> = {}): EventRow => ({
  id: ++seq, project_id, event_type, field: null, old_value: null, new_value: null, subject_id: null, occurred_at: when, ...extra,
});
const upd = (pid: string, when: Date, field: string, o: string | null, n: string | null) => ev(pid, when, "updated", { field, old_value: o, new_value: n });

const proj = (id: string, name: string, extra: Partial<ProjectRow> = {}): ProjectRow => ({
  id, name, status: "in_progress", priority: "normal", deadline: null, next_step: "", description: "", phase: "", progress: 0,
  archived_at: null, created_at: before(72), created_by: "u1", creator_name: "Sam Rivera", assignees: [], ...extra,
});
const run = (projects: ProjectRow[], events: EventRow[] = [], period = "this week") =>
  buildNarrative({ projects, events, start: START, end: END, zone: Z, period });
const text = (p: { prefix: string; name: string; suffix: string; sentences: string[] }) => `${p.prefix}${p.name}${p.suffix} ${p.sentences.join(" ")}`;

describe("describeInline", () => {
  it("reads after 'In this project,': lower-cases a normal first word, keeps names and acronyms", () => {
    expect(describeInline("We are rebuilding the menu")).toBe("we are rebuilding the menu.");
    expect(describeInline("Refresh the menu.")).toBe("refresh the menu.");
    expect(describeInline("POS terminals get new labels")).toBe("POS terminals get new labels.");
    expect(describeInline("  ")).toBe("");
  });
  it("shortens a long description at a sentence end, or at a word with an ellipsis", () => {
    const long = `${"Word ".repeat(30)}end. Second sentence that should be dropped because the text is too long. ${"More ".repeat(40)}`;
    const out = describeInline(long);
    expect(out.length).toBeLessThanOrEqual(225);
    expect(out).toMatch(/[.…]$/);
    expect(describeInline("x".repeat(30) + " " + "y".repeat(300))).toMatch(/…$/);
  });
});

describe("buildNarrative", () => {
  it("says how many projects someone started this week and lists them", () => {
    const projects = [
      proj("a", "Menu refresh", { created_at: at(5) }),
      proj("b", "Patio plan", { created_at: at(9) }),
      proj("old", "Old one"),
    ];
    const out = run(projects, [ev("a", at(5), "created"), ev("b", at(9), "created")]);
    expect(out).toHaveLength(1);
    expect(out[0].started).toBe("Sam Rivera started 2 projects this week: Menu refresh and Patio plan.");
  });

  it("uses the singular for one project and 'that week' for an earlier period", () => {
    const out = run([proj("a", "Solo", { created_at: at(5) })], [ev("a", at(5), "created")], "that week");
    expect(out[0].started).toBe("Sam Rivera started 1 project that week: Solo.");
  });

  it("writes the working-on, description, phase, progress and next-step sentences from the project's fields", () => {
    const out = run([proj("a", "Menu refresh", { description: "Update the dinner menu layout", phase: "Drafting copy", progress: 40, next_step: "Send to print" })]);
    expect(out[0].projects).toHaveLength(1);
    expect(text(out[0].projects[0])).toBe(
      'Sam Rivera is working on Menu refresh. In this project, update the dinner menu layout. Sam is currently working on the "Drafting copy" phase (40% complete). Next step: Send to print.',
    );
  });

  it("falls back gracefully: no phase, no description, not started, stuck", () => {
    const [p1] = run([proj("a", "No phase", { progress: 25 })])[0].projects;
    expect(p1.sentences).toEqual(["The project is 25% complete."]);
    const [p2] = run([proj("b", "Fresh", { status: "not_started" })])[0].projects;
    expect(p2.sentences).toContain("It has not started yet.");
    const [p3] = run([proj("c", "Jam", { status: "blocked", phase: "Waiting", progress: 30 })])[0].projects;
    expect(p3.sentences).toContain("The project is currently stuck.");
  });

  it("describes what changed in the period, from the history", () => {
    const p = proj("a", "Menu refresh", { status: "blocked", phase: "Proofing", progress: 70 });
    const events = [
      upd("a", at(10), "status", "in_progress", "blocked"),
      upd("a", at(11), "phase", "Drafting", "Proofing"),
      upd("a", at(12), "progress", "40", "70"),
      ev("a", at(13), "commented", { field: "comment" }),
      ev("a", at(14), "commented", { field: "comment" }),
    ];
    const s = run([p], events)[0].projects[0].sentences.join(" ");
    expect(s).toContain("the status changed from In progress to Stuck");
    expect(s).toContain('the phase moved from "Drafting" to "Proofing"');
    expect(s).toContain("progress went from 40% to 70%");
    expect(s).toContain("2 new comments were added");
  });

  it("rebuilds the start of a past week, so it reports that week's changes rather than today's", () => {
    // Current state is later than the window: progress moved again after END.
    const p = proj("a", "Menu refresh", { phase: "Launch", progress: 90 });
    const events = [upd("a", at(10), "progress", "10", "50"), upd("a", new Date(END.getTime() + 3600_000), "progress", "50", "90"), upd("a", new Date(END.getTime() + 3600_000), "phase", "Proofing", "Launch")];
    const s = run([p], events, "that week")[0].projects[0].sentences.join(" ");
    expect(s).toContain("(50% complete)");
    expect(s).toContain('"Proofing" phase');
    expect(s).toContain("progress went from 10% to 50%");
  });

  it("lists a shared project under each assignee, naming the others", () => {
    const p = proj("a", "Shared", { assignees: [{ id: "u2", name: "Alex Kim" }, { id: "u3", name: "Jo Park" }] });
    const out = run([p]);
    expect(out.map((o) => o.name)).toEqual(["Alex Kim", "Jo Park"]);
    expect(out[0].projects[0].prefix + out[0].projects[0].name + out[0].projects[0].suffix).toBe("Alex Kim is working on Shared with Jo Park.");
  });

  it("puts a finished project under 'finished', and leaves out closed, archived and cancelled ones", () => {
    const done = proj("a", "Finished one", { status: "done", progress: 100 });
    const events = [upd("a", at(10), "status", "in_progress", "done")];
    const out = run([done, proj("b", "Long done", { status: "done" }), proj("c", "Dropped", { status: "cancelled" }), proj("d", "Archived", { archived_at: at(3) })], events);
    expect(out[0].projects.map((p) => p.name)).toEqual(["Finished one"]);
    expect(out[0].projects[0].prefix).toBe("Sam Rivera finished ");
    expect(out[0].projects[0].sentences).toContain("It was finished this week.");
  });

  it("mentions a passed or upcoming deadline, using the local date", () => {
    const late = run([proj("a", "Late", { deadline: "2026-10-20" })])[0].projects[0].sentences.join(" ");
    expect(late).toContain("The deadline (Oct 20) has passed.");
    const soon = run([proj("b", "Soon", { deadline: "2026-10-23" })])[0].projects[0].sentences.join(" ");
    expect(soon).toContain("It is due on Oct 23.");
    const far = run([proj("c", "Far", { deadline: "2026-12-31" })])[0].projects[0].sentences.join(" ");
    expect(far).not.toMatch(/deadline|due/i);
  });

  it("puts stuck projects first and people in name order; empty when there is nothing", () => {
    const out = run([proj("a", "Alpha"), proj("b", "Beta", { status: "blocked" })]);
    expect(out[0].projects.map((p) => p.name)).toEqual(["Beta", "Alpha"]);
    expect(run([])).toEqual([]);
  });
});
