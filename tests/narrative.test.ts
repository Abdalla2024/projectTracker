import { describe, expect, it } from "vitest";
import { buildNarrative, describeInline, narrativeProblems, quoteText, sentenceProblem, tidySentence, type SummaryComment } from "@/lib/narrative";
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
const run = (projects: ProjectRow[], events: EventRow[] = [], period = "this week", comments: SummaryComment[] = []) =>
  buildNarrative({ projects, events, comments, start: START, end: END, zone: Z, period });
let cseq = 0;
const cm = (project_id: string, author_name: string, body: string, when: Date, extra: Partial<SummaryComment> = {}): SummaryComment => ({
  id: `c${++cseq}`, project_id, author_name, body, parent_id: null, created_at: when, deleted_at: null, ...extra,
});
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
      'Sam Rivera is working on Menu refresh. In this project, update the dinner menu layout. Sam is currently working on "Drafting copy" (40% complete).',
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
    ];
    const s = run([p], events)[0].projects[0].sentences.join(" ");
    expect(s).toContain("the status changed from In progress to Stuck");
    expect(s).toContain('the current task moved from "Drafting" to "Proofing"');
    expect(s).toContain("progress went from 40% to 70%");
  });

  it("rebuilds the start of a past week, so it reports that week's changes rather than today's", () => {
    // Current state is later than the window: progress moved again after END.
    const p = proj("a", "Menu refresh", { phase: "Launch", progress: 90 });
    const events = [upd("a", at(10), "progress", "10", "50"), upd("a", new Date(END.getTime() + 3600_000), "progress", "50", "90"), upd("a", new Date(END.getTime() + 3600_000), "phase", "Proofing", "Launch")];
    const s = run([p], events, "that week")[0].projects[0].sentences.join(" ");
    expect(s).toContain("(50% complete)");
    expect(s).toContain('working on "Proofing"');
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

describe("comments in the write-up", () => {
  const p = () => proj("a", "Menu refresh");
  it("quotes what a comment said, with who said it; replies say 'replied'", () => {
    const out = run([p()], [], "this week", [
      cm("a", "Alex Kim", "Proofs arrive Friday", at(10)),
      cm("a", "Sam Rivera", "Great, thanks", at(11), { parent_id: "c1" }),
    ]);
    const s = out[0].projects[0].sentences;
    expect(s).toContain("Alex Kim commented: “Proofs arrive Friday”.");
    expect(s).toContain("Sam Rivera replied: “Great, thanks”.");
  });

  it("shows only the three latest, and says how many earlier ones are left out", () => {
    const many = [1, 2, 3, 4, 5].map((i) => cm("a", "Alex Kim", `Note ${i}`, at(i)));
    const s = run([p()], [], "this week", many)[0].projects[0].sentences.join(" ");
    expect(s).toContain("2 earlier comments are not shown here.");
    expect(s).toContain("“Note 3”");
    expect(s).toContain("“Note 5”");
    expect(s).not.toContain("“Note 2”");
  });

  it("leaves out deleted comments, blank ones, and ones outside the period", () => {
    const s = run([p()], [], "this week", [
      cm("a", "Alex Kim", "", at(3), { deleted_at: at(4) }),
      cm("a", "Alex Kim", "   ", at(5)),
      cm("a", "Alex Kim", "Too early", before(5)),
      cm("a", "Alex Kim", "Too late", new Date(END.getTime() + 3600_000)),
    ])[0].projects[0].sentences.join(" ");
    expect(s).not.toMatch(/commented|replied|earlier comment/);
  });

  it("puts one comment on one line and shortens a long one at a word", () => {
    expect(quoteText("line one\n\nline   two")).toBe("“line one line two”");
    expect(quoteText("He said “hello” to them")).toBe('“He said "hello" to them”');
    const long = quoteText(`${"word ".repeat(80)}`);
    expect(long.length).toBeLessThanOrEqual(206);
    expect(long).toMatch(/…”$/);
  });
});

describe("sentence quality check", () => {
  it("accepts well-formed sentences and flags broken ones", () => {
    for (const ok of ["Sam is working on Menu.", "Next step: Send it.", "Alex Kim commented: “Looks good”.", "Is it ready?", "It was finished this week."]) {
      expect(sentenceProblem(ok), ok).toBeNull();
    }
    expect(sentenceProblem("")).toBe("empty");
    expect(sentenceProblem("lowercase start.")).toMatch(/capital/);
    expect(sentenceProblem("No ending")).toMatch(/punctuation/);
    expect(sentenceProblem("Progress is NaN% done.")).toMatch(/placeholder/);
    expect(sentenceProblem("The phase is \"undefined\".")).toMatch(/placeholder/);
    expect(sentenceProblem("Progress is undefined%.")).toMatch(/placeholder/);
    expect(sentenceProblem("Shows [object Object].")).toMatch(/placeholder/);
    expect(sentenceProblem("Said: “open quote.")).toMatch(/quotes/);
    expect(sentenceProblem("Said: “”.")).toMatch(/empty quotes/);
    expect(sentenceProblem("Two  spaces.")).toMatch(/spaces/);
  });

  it("repairs spacing, the first letter and the final period without changing the words", () => {
    expect(tidySentence("  next   step: send it ")).toBe("Next step: send it.");
    expect(tidySentence("Done..")).toBe("Done.");
    expect(tidySentence("Done?")).toBe("Done?");
  });

  // Generated projects with awkward text: empty and odd values, quotes, newlines, long text, other scripts.
  it("never produces a broken sentence, whatever people typed (generated cases)", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const texts = ["", " ", "plain words", "ends with period.", "Ends with question?", "lowercase start", "UPPER CASE", "has “curly” quotes", 'has "straight" quotes', "unbalanced “quote",
      "line one\nline two", "tabs\tand   spaces", "trailing comma,", "semi;", "ellipsis…", "x".repeat(400), "word ".repeat(120), "Ünïcödé テスト", "😀 emoji", "(parenthetical)", "-- dashes --", "12345", "null", "undefined?", "a"];
    const statuses = ["not_started", "in_progress", "blocked", "done", "cancelled"];
    const names = ["Sam Rivera", "alex kim", "Jo", "Demo Admin (synthetic)", "Zoë Müller"];
    for (let round = 0; round < 40; round++) {
      const projects: ProjectRow[] = [];
      const events: EventRow[] = [];
      const comments: SummaryComment[] = [];
      for (let i = 0; i < 6; i++) {
        const id = `p${round}-${i}`;
        const status = pick(statuses);
        const assignees = rnd() < 0.5 ? [] : [{ id: `u${Math.floor(rnd() * 3)}`, name: pick(names) }];
        projects.push(proj(id, pick(texts) || "Untitled", {
          status, description: pick(texts), phase: pick(texts).slice(0, 24), progress: Math.floor(rnd() * 101), next_step: pick(texts),
          deadline: rnd() < 0.5 ? null : pick(["2026-10-10", "2026-10-21", "2026-10-23", "2026-12-01"]),
          created_at: rnd() < 0.3 ? at(Math.floor(rnd() * 50)) : before(100), created_by: `c${i % 2}`, creator_name: pick(names), assignees,
          archived_at: rnd() < 0.1 ? at(1) : null,
        }));
        if (rnd() < 0.5) events.push(upd(id, at(20), "status", pick(statuses), status));
        if (rnd() < 0.5) events.push(upd(id, at(21), "progress", String(Math.floor(rnd() * 100)), "50"));
        if (rnd() < 0.5) events.push(upd(id, at(22), "phase", pick(texts).slice(0, 24), pick(texts).slice(0, 24)));
        for (let k = 0; k < Math.floor(rnd() * 6); k++) comments.push(cm(id, pick(names), pick(texts), at(Math.floor(rnd() * 60)), { parent_id: rnd() < 0.3 ? "x" : null }));
      }
      const out = run(projects, events, pick(["this week", "that week"]), comments);
      expect(narrativeProblems(out), `round ${round}`).toEqual([]);
      for (const person of out) for (const pr of person.projects) expect(`${pr.prefix}${pr.name}${pr.suffix}`.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("tasks in the write-up", () => {
  const t = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id, project_id: "a", title, parent_id: null, due_date: null, completed_at: null, assignee_name: null, ...extra,
  });
  it("names tasks completed in the period, and overdue open tasks with who has them", () => {
    const tasks = [
      t("1", "Order signs", { completed_at: at(5) }),
      t("2", "Book painter", { completed_at: at(6) }),
      t("3", "Old task", { completed_at: before(30) }),
      t("4", "Call landlord", { due_date: "2026-10-20", assignee_name: "Alex Kim" }),
      t("5", "Sub task done", { completed_at: at(7), parent_id: "1" }),
      t("6", "Future task", { due_date: "2026-12-01" }),
    ];
    const s = buildNarrative({ projects: [proj("a", "Menu refresh")], events: [], tasks, start: START, end: END, zone: Z, period: "this week" })[0].projects[0].sentences;
    expect(s).toContain("This week, 2 tasks were completed: “Order signs” and “Book painter”.");
    expect(s).toContain("1 task is overdue: “Call landlord” (Alex Kim).");
  });
});
