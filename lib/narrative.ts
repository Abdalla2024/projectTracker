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

const endSentence = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/** First part of a description that reads as a sentence fragment after "In this project, ". */
export function describeInline(description: string): string {
  const text = description.replace(/\s+/g, " ").trim();
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
}): NarrativePerson[] {
  const { start, end, zone, period } = input;
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

    if (s0 === null) person(project.created_by, project.creator_name).startedTitles.push(s1.name);

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
        if (s1.phase) sentences.push(`${firstName(member.name)} is currently working on the "${s1.phase}" phase (${s1.progress}% complete).`);
        else if (s1.progress > 0) sentences.push(`The project is ${s1.progress}% complete.`);
        if (s1.status === "blocked") sentences.push("The project is currently stuck.");
        else if (s1.status === "not_started" && !s1.phase && s1.progress === 0) sentences.push("It has not started yet.");
        if (s1.next_step) sentences.push(`Next step: ${endSentence(s1.next_step)}`);
      }

      const moved: string[] = [];
      if (s0 && s0.status !== s1.status && !completed) moved.push(`the status changed from ${label(s0.status)} to ${label(s1.status)}`);
      if (s0 && s0.phase !== s1.phase && s1.phase) moved.push(`the phase moved ${s0.phase ? `from "${s0.phase}" ` : ""}to "${s1.phase}"`);
      if (s0 && s0.progress !== s1.progress) moved.push(`progress went from ${s0.progress}% to ${s1.progress}%`);
      const comments = inWindow.filter((e) => e.event_type === "commented").length;
      if (comments) moved.push(`${plural(comments, "new comment")} ${comments === 1 ? "was" : "were"} added`);
      if (s0 === null) moved.unshift("the project was created");
      if (moved.length) sentences.push(`${period[0].toUpperCase()}${period.slice(1)}, ${list(moved)}.`);

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
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
