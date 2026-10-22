// Plain-language weekly write-up, built from project details and the recorded history. Deterministic
// (no AI): every sentence is a template filled from stored fields. Pure, like summary.ts.
//
// Layout: one entry per person. It says how many projects they started in the period, then, for each
// project they are on (assigned, or the creator when nobody is assigned), what it is, where it
// stands, and what changed. Names are used instead of pronouns because the app does not store them.
import { CLOSED_STATUSES, DEADLINE_SOON_DAYS, STATUS_LABELS } from "./constants";
import { DateTime } from "luxon";
import { stateAt, type EventRow, type ProjectRow, type ProjectState } from "./summary";

export interface NarrativeProject {
  id: string;
  name: string;
  /** Text before the linked project name, e.g. "Sam is working on ". */
  prefix: string;
  /** Text after the project name (ends the first sentence). */
  suffix: string;
  /** The remaining sentences, in order. */
  sentences: string[];
}

export interface NarrativePerson {
  id: string;
  name: string;
  /** e.g. "Sam started 2 projects this week: A and B." Empty when they started none. */
  started: string;
  projects: NarrativeProject[];
}

const MAX_DESCRIPTION = 220;
const MAX_COMMENT = 200;
const MAX_COMMENTS_SHOWN = 3;

export interface SummaryTask {
  id: string;
  project_id: string;
  title: string;
  parent_id: string | null;
  due_date: string | null;
  completed_at: Date | null;
  assignee_name: string | null;
}

export interface SummaryComment {
  id: string;
  project_id: string;
  author_name: string;
  body: string;
  parent_id: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

/** A comment, on one line, shortened at a word, in curly quotes. */
export function quoteText(body: string): string {
  let text = body.replace(/\s+/g, " ").trim().replace(/[“”]/g, '"');
  if (text.length > MAX_COMMENT) text = `${text.slice(0, text.lastIndexOf(" ", MAX_COMMENT) > 60 ? text.lastIndexOf(" ", MAX_COMMENT) : MAX_COMMENT).replace(/[\s,;:]+$/, "")}…`;
  return `“${text}”`;
}

/** People's own curly quotes would unbalance the quotes the write-up adds itself. */
const plain = (s: string) => s.replace(/[“”]/g, '"');

const endSentence = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/** First part of a description that reads as a sentence fragment after "In this project, ". */
export function describeInline(description: string): string {
  const text = plain(description).replace(/\s+/g, " ").trim();
  if (!text) return "";
  let cut = text;
  if (text.length > MAX_DESCRIPTION) {
    const head = text.slice(0, MAX_DESCRIPTION);
    const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
    cut = stop > 80 ? head.slice(0, stop + 1) : `${head.slice(0, head.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
  }
  // Lower-case the first letter unless it looks like a name or acronym.
  const lowered = /^[A-Z][a-z]/.test(cut) && !/^(I|I'm|I'll)\b/.test(cut) ? cut[0].toLowerCase() + cut.slice(1) : cut;
  return endSentence(lowered);
}

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const label = (status: string) => STATUS_LABELS[status] ?? status;
const date = (iso: string, zone: string) => DateTime.fromISO(iso, { zone }).toFormat("LLL d");

/** Who is on a project: its assignees, or its creator when there are none. */
function peopleOn(project: ProjectRow, state: ProjectState): { id: string; name: string }[] {
  const assigned = [...state.assignees].map(([id, name]) => ({ id, name }));
  return assigned.length ? assigned : [{ id: project.created_by, name: project.creator_name }];
}

export function buildNarrative(input: {
  projects: ProjectRow[];
  events: EventRow[];
  start: Date;
  end: Date;
  zone: string;
  /** "this week" for the current week, "that week" for earlier ones. */
  period: string;
  comments?: SummaryComment[];
  tasks?: SummaryTask[];
}): NarrativePerson[] {
  const { start, end, zone, period } = input;
  const commentsByProject = new Map<string, SummaryComment[]>();
  for (const c of input.comments ?? []) {
    if (c.deleted_at || !c.body.trim() || c.created_at <= start || c.created_at > end) continue;
    const list = commentsByProject.get(c.project_id) ?? [];
    list.push(c);
    commentsByProject.set(c.project_id, list);
  }
  const eventsByProject = new Map<string, EventRow[]>();
  for (const e of input.events) {
    const list = eventsByProject.get(e.project_id) ?? [];
    list.push(e);
    eventsByProject.set(e.project_id, list);
  }
  const endDay = DateTime.fromJSDate(end, { zone }).startOf("day");

  const people = new Map<string, NarrativePerson & { startedTitles: string[]; rank: Map<string, number> }>();
  const person = (id: string, name: string) => {
    let p = people.get(id);
    if (!p) {
      p = { id, name, started: "", projects: [], startedTitles: [], rank: new Map() };
      people.set(id, p);
    }
    return p;
  };

  for (const project of input.projects) {
    const events = eventsByProject.get(project.id) ?? [];
    const s1 = stateAt(project, events, end);
    if (!s1 || s1.archived) continue;
    const s0 = stateAt(project, events, start);
    const inWindow = events.filter((e) => e.occurred_at > start && e.occurred_at <= end);

    if (s0 === null) person(project.created_by, project.creator_name).startedTitles.push(plain(s1.name));

    const completed = s1.status === "done" && s0?.status !== "done";
    const open = !CLOSED_STATUSES.includes(s1.status);
    if (!open && !completed) continue;

    const team = peopleOn(project, s1);
    for (const member of team) {
      const others = team.filter((t) => t.id !== member.id).map((t) => t.name);
      const withText = others.length ? ` with ${list(others)}` : "";
      const sentences: string[] = [];

      const about = describeInline(s1.description);
      if (about) sentences.push(`In this project, ${about}`);

      if (completed) {
        sentences.push(`It was finished ${period}.`);
      } else {
        if (s1.phase) sentences.push(`${firstName(member.name)} is currently working on "${plain(s1.phase)}" (${s1.progress}% complete).`);
        else if (s1.progress > 0) sentences.push(`The project is ${s1.progress}% complete.`);
        if (s1.status === "blocked") sentences.push("The project is currently stuck.");
        else if (s1.status === "not_started" && !s1.phase && s1.progress === 0) sentences.push("It has not started yet.");
      }

      const moved: string[] = [];
      if (s0 && s0.status !== s1.status && !completed) moved.push(`the status changed from ${label(s0.status)} to ${label(s1.status)}`);
      if (s0 && s0.phase !== s1.phase && s1.phase) moved.push(`the current task moved ${s0.phase ? `from "${plain(s0.phase)}" ` : ""}to "${plain(s1.phase)}"`);
      if (s0 && s0.progress !== s1.progress) moved.push(`progress went from ${s0.progress}% to ${s1.progress}%`);
      if (s0 === null) moved.unshift("the project was created");
      if (moved.length) sentences.push(`${period[0].toUpperCase()}${period.slice(1)}, ${list(moved)}.`);

      const projectTasks = (input.tasks ?? []).filter((t) => t.project_id === project.id && !t.parent_id);
      const finished = projectTasks.filter((t) => t.completed_at && t.completed_at > start && t.completed_at <= end);
      if (finished.length) {
        const names = finished.slice(0, 5).map((t) => `“${plain(t.title).trim()}”`);
        const more = finished.length > 5 ? ` and ${finished.length - 5} more` : "";
        sentences.push(`${period[0].toUpperCase()}${period.slice(1)}, ${plural(finished.length, "task")} ${finished.length === 1 ? "was" : "were"} completed: ${list(names)}${more}.`);
      }
      const endDate = DateTime.fromJSDate(end, { zone }).toISODate()!;
      const overdue = projectTasks.filter((t) => !t.completed_at && t.due_date && t.due_date < endDate);
      if (open && overdue.length) {
        const names = overdue.slice(0, 3).map((t) => `“${plain(t.title).trim()}”${t.assignee_name ? ` (${t.assignee_name})` : ""}`);
        const more = overdue.length > 3 ? ` and ${overdue.length - 3} more` : "";
        sentences.push(`${plural(overdue.length, "task")} ${overdue.length === 1 ? "is" : "are"} overdue: ${list(names)}${more}.`);
      }

      const said = (commentsByProject.get(project.id) ?? []).slice().sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
      const shown = said.slice(-MAX_COMMENTS_SHOWN);
      if (said.length > shown.length) {
        const n = said.length - shown.length;
        sentences.push(`${plural(n, "earlier comment")} ${n === 1 ? "is" : "are"} not shown here.`);
      }
      for (const c of shown) sentences.push(`${c.author_name} ${c.parent_id ? "replied" : "commented"}: ${quoteText(c.body)}.`);

      if (open && s1.deadline) {
        const days = Math.round(DateTime.fromISO(s1.deadline, { zone }).startOf("day").diff(endDay, "days").days);
        if (days < 0) sentences.push(`The deadline (${date(s1.deadline, zone)}) has passed.`);
        else if (days <= DEADLINE_SOON_DAYS) sentences.push(`It is due ${days === 0 ? "today" : `on ${date(s1.deadline, zone)}`}.`);
      }

      const p = person(member.id, member.name);
      p.projects.push({
        id: project.id,
        name: s1.name,
        prefix: completed ? `${member.name} finished ` : `${member.name} is working on `,
        suffix: `${withText}.`,
        sentences,
      });
      p.rank.set(project.id, s1.status === "blocked" ? 0 : completed ? 2 : 1);
    }
  }

  const out: NarrativePerson[] = [];
  for (const p of people.values()) {
    if (p.startedTitles.length) {
      p.started = `${p.name} started ${plural(p.startedTitles.length, "project")} ${period}: ${list(p.startedTitles.sort())}.`;
    }
    p.projects.sort((a, b) => (p.rank.get(a.id)! - p.rank.get(b.id)!) || a.name.localeCompare(b.name));
    if (p.started || p.projects.length) out.push({ id: p.id, name: p.name, started: p.started, projects: p.projects });
  }
  return finish(out.sort((a, b) => a.name.localeCompare(b.name)));
}

// ---- Quality check -------------------------------------------------------------------------------
// The template sentences are fixed, but they contain project titles, descriptions, next steps and comments
// typed by people. This check runs on everything the summary shows: each sentence must start like a
// sentence, end like one, have balanced quotes, and contain no leftover placeholder text. A sentence
// that fails is repaired when that is safe (spacing, capital letter, final period) and otherwise left out,
// so the page never shows a fragment. It cannot judge whether the wording is *sensible*: that depends on what
// people wrote.

/** What is wrong with one sentence, or null when it is well formed. */
export function sentenceProblem(sentence: string): string | null {
  const s = sentence;
  if (!s.trim()) return "empty";
  if (/\s{2,}/.test(s) || s !== s.trim()) return "extra spaces";
  if (!/^[\p{Lu}\p{N}“"'(]/u.test(s)) return "does not start with a capital letter";
  if (!/[.!?…][”"')]*$/.test(s)) return "does not end with punctuation";
  if (/NaN%|\[object |"undefined"|“undefined”|\bundefined%|\(undefined\)|\{\{|\}\}/.test(s)) return "contains placeholder text";
  if ((s.match(/“/g)?.length ?? 0) !== (s.match(/”/g)?.length ?? 0)) return "unbalanced quotes";
  if (/“\s*”|""/.test(s)) return "empty quotes";
  if (/\.\.(?!\.)/.test(s) || /,\./.test(s)) return "doubled punctuation";
  return null;
}

/** Repairs spacing, the first letter and the final period; does not change wording. */
export function tidySentence(sentence: string): string {
  let s = sentence.replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = s.replace(/^([\p{Ll}])/u, (c) => c.toUpperCase());
  s = s.replace(/\.{2}(?!\.)/g, ".").replace(/,\./g, ".");
  if (!/[.!?…][”"')]*$/.test(s)) s += ".";
  return s;
}

function finish(people: NarrativePerson[]): NarrativePerson[] {
  return people.map((p) => ({
    ...p,
    started: p.started ? tidySentence(p.started) : "",
    projects: p.projects.map((pr) => {
      // A title that ends in punctuation would collide with the full stop that closes the sentence.
      const name = pr.name.replace(/[“”]/g, "\"").replace(/[\s,;:–-]+$/u, "") || pr.name;
      const suffix = /[.!?…]$/.test(name) ? pr.suffix.replace(/^\./, "") : pr.suffix;
      return { ...pr, name, suffix };
    }).map((pr) => ({
      ...pr,
      prefix: pr.prefix.replace(/^\p{Ll}/u, (c) => c.toUpperCase()),
      sentences: pr.sentences.map(tidySentence).filter((s) => sentenceProblem(s) === null),
    })),
  }));
}

/** Every problem left in the finished write-up (used by tests and available for monitoring). */
export function narrativeProblems(people: NarrativePerson[]): string[] {
  const out: string[] = [];
  for (const p of people) {
    if (p.started) { const x = sentenceProblem(p.started); if (x) out.push(`${p.name} (started): ${x}`); }
    for (const pr of p.projects) {
      const lead = sentenceProblem(`${pr.prefix}${pr.name}${pr.suffix}`.replace(/\s+/g, " ").trim());
      if (lead) out.push(`${p.name} / ${pr.name} (lead): ${lead}`);
      for (const s of pr.sentences) { const x = sentenceProblem(s); if (x) out.push(`${p.name} / ${pr.name}: ${x} — ${s}`); }
    }
  }
  return out;
}
