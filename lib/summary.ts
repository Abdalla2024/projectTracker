// Deterministic weekly summary. Pure functions: no database or clock access, so it is easy to test.
//
// How it works: project_events is an append-only log of every meaningful change, each with old and
// new values. The state of a project at any past instant T is rebuilt by taking its current state
// and undoing every event that happened after T, newest first. Comparing stateAt(Monday 00:00) with
// stateAt(end of window) gives a start-versus-now view that does not depend on snapshots being taken.
import { DateTime } from "luxon";
import { CLOSED_STATUSES, DEADLINE_SOON_DAYS } from "./constants";

export interface Person { id: string; name: string }

export interface ProjectRow {
  id: string;
  name: string;
  status: string;
  priority: string;
  deadline: string | null; // YYYY-MM-DD
  next_step: string;
  archived_at: Date | null;
  created_at: Date;
  assignees: Person[];
  stores: Person[];
}

export interface EventRow {
  id: number | string;
  project_id: string;
  event_type: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  subject_id: string | null;
  occurred_at: Date;
}

export interface ProjectState {
  name: string;
  status: string;
  priority: string;
  deadline: string | null;
  next_step: string;
  archived: boolean;
  assignees: Map<string, string>;
  stores: Map<string, string>;
}

const byTimeDesc = (a: EventRow, b: EventRow) =>
  b.occurred_at.getTime() - a.occurred_at.getTime() || Number(b.id) - Number(a.id);

/** State of one project at instant `at`, or null if it did not exist yet. `events` must be that project's events. */
export function stateAt(project: ProjectRow, events: EventRow[], at: Date): ProjectState | null {
  if (project.created_at.getTime() > at.getTime()) return null;

  const state: ProjectState = {
    name: project.name,
    status: project.status,
    priority: project.priority,
    deadline: project.deadline,
    next_step: project.next_step,
    archived: project.archived_at !== null,
    assignees: new Map(project.assignees.map((p) => [p.id, p.name])),
    stores: new Map(project.stores.map((s) => [s.id, s.name])),
  };

  const after = events.filter((e) => e.occurred_at.getTime() > at.getTime()).sort(byTimeDesc);
  for (const e of after) {
    switch (e.event_type) {
      case "updated":
        if (e.field === "name") state.name = e.old_value ?? state.name;
        if (e.field === "status") state.status = e.old_value ?? state.status;
        if (e.field === "priority") state.priority = e.old_value ?? state.priority;
        if (e.field === "deadline") state.deadline = e.old_value;
        if (e.field === "next_step") state.next_step = e.old_value ?? "";
        break;
      case "assignee_added":
        if (e.subject_id) state.assignees.delete(e.subject_id);
        break;
      case "assignee_removed":
        if (e.subject_id) state.assignees.set(e.subject_id, e.old_value ?? "Unknown");
        break;
      case "store_added":
        if (e.subject_id) state.stores.delete(e.subject_id);
        break;
      case "store_removed":
        if (e.subject_id) state.stores.set(e.subject_id, e.old_value ?? "Unknown");
        break;
      case "archived":
        state.archived = false;
        break;
      case "unarchived":
        state.archived = true;
        break;
    }
  }
  return state;
}

export interface Change<T = string | null> { from: T; to: T }

export type DeadlineFlag = "missed" | "approaching";

export interface ProjectSummary {
  id: string;
  name: string;
  isNew: boolean;
  statusChange: Change<string> | null;
  priorityChange: Change<string> | null;
  deadlineChange: Change | null;
  nextStepChange: Change<string> | null;
  assigneesAdded: string[];
  assigneesRemoved: string[];
  storesAdded: string[];
  storesRemoved: string[];
  archivedChange: "archived" | "unarchived" | null;
  comments: number;
  newlyBlocked: boolean;
  completed: boolean;
  cancelled: boolean;
  /** Evaluated at the end of the window. */
  deadlineFlag: DeadlineFlag | null;
  deadline: string | null;
  endStatus: string;
  endArchived: boolean;
  /** True when anything above (other than a deadline flag) changed. */
  changed: boolean;
}

export interface WeeklySummary {
  windowStart: Date;
  windowEnd: Date;
  totals: {
    activeAtEnd: number;
    created: number;
    completed: number;
    newlyBlocked: number;
    blockedAtEnd: number;
    withChanges: number;
    unchanged: number;
    missedDeadlines: number;
    approachingDeadlines: number;
  };
  /** Projects with something to report, most notable first. */
  projects: ProjectSummary[];
}

const diff = (a: Map<string, string>, b: Map<string, string>) =>
  [...b].filter(([id]) => !a.has(id)).map(([, name]) => name).sort();

export function buildWeeklySummary(input: {
  projects: ProjectRow[];
  events: EventRow[];
  start: Date;
  end: Date;
  zone: string;
}): WeeklySummary {
  const { start, end, zone } = input;
  const eventsByProject = new Map<string, EventRow[]>();
  for (const e of input.events) {
    const list = eventsByProject.get(e.project_id) ?? [];
    list.push(e);
    eventsByProject.set(e.project_id, list);
  }

  const endLocalDate = DateTime.fromJSDate(end, { zone }).startOf("day");
  const items: ProjectSummary[] = [];

  for (const project of input.projects) {
    const events = eventsByProject.get(project.id) ?? [];
    const s0 = stateAt(project, events, start);
    const s1 = stateAt(project, events, end);
    if (!s1) continue; // created after the window

    const inWindow = events.filter((e) => e.occurred_at > start && e.occurred_at <= end);
    const isNew = s0 === null;
    const statusChange = !isNew && s0!.status !== s1.status ? { from: s0!.status, to: s1.status } : null;
    const changeOf = <K extends "priority" | "next_step">(k: K) =>
      !isNew && s0![k] !== s1[k] ? { from: s0![k], to: s1[k] } : null;
    const deadlineChange = !isNew && s0!.deadline !== s1.deadline ? { from: s0!.deadline, to: s1.deadline } : null;
    const emptyAssignees = new Map<string, string>();
    const a0 = s0?.assignees ?? emptyAssignees;
    const t0 = s0?.stores ?? emptyAssignees;

    const open = !CLOSED_STATUSES.includes(s1.status) && !s1.archived;
    let deadlineFlag: DeadlineFlag | null = null;
    if (open && s1.deadline) {
      const days = Math.round(DateTime.fromISO(s1.deadline, { zone }).startOf("day").diff(endLocalDate, "days").days);
      if (days < 0) deadlineFlag = "missed";
      else if (days <= DEADLINE_SOON_DAYS) deadlineFlag = "approaching";
    }

    const summary: ProjectSummary = {
      id: project.id,
      name: s1.name,
      isNew,
      statusChange,
      priorityChange: changeOf("priority"),
      deadlineChange,
      nextStepChange: changeOf("next_step"),
      assigneesAdded: diff(a0, s1.assignees),
      assigneesRemoved: diff(s1.assignees, a0),
      storesAdded: diff(t0, s1.stores),
      storesRemoved: diff(s1.stores, t0),
      archivedChange: s0 && s0.archived !== s1.archived ? (s1.archived ? "archived" : "unarchived") : null,
      comments: inWindow.filter((e) => e.event_type === "commented").length,
      newlyBlocked: s1.status === "blocked" && s0?.status !== "blocked",
      completed: s1.status === "done" && s0?.status !== "done",
      cancelled: s1.status === "cancelled" && s0?.status !== "cancelled",
      deadlineFlag,
      deadline: s1.deadline,
      endStatus: s1.status,
      endArchived: s1.archived,
      changed: false,
    };
    summary.changed =
      isNew ||
      !!(summary.statusChange || summary.priorityChange || summary.deadlineChange || summary.nextStepChange) ||
      summary.assigneesAdded.length + summary.assigneesRemoved.length + summary.storesAdded.length + summary.storesRemoved.length > 0 ||
      !!summary.archivedChange ||
      summary.comments > 0;
    items.push(summary);
  }

  const rank = (p: ProjectSummary) =>
    (p.newlyBlocked ? 0 : p.deadlineFlag === "missed" ? 1 : p.completed ? 2 : p.isNew ? 3 : p.deadlineFlag ? 4 : 5);
  const notable = items
    .filter((p) => p.changed || p.deadlineFlag)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const activeAtEnd = items.filter((p) => !CLOSED_STATUSES.includes(p.endStatus) && !p.endArchived).length;
  return {
    windowStart: start,
    windowEnd: end,
    totals: {
      activeAtEnd,
      created: items.filter((p) => p.isNew).length,
      completed: items.filter((p) => p.completed).length,
      newlyBlocked: items.filter((p) => p.newlyBlocked).length,
      blockedAtEnd: items.filter((p) => p.endStatus === "blocked").length,
      withChanges: items.filter((p) => p.changed).length,
      unchanged: items.filter((p) => !p.changed).length,
      missedDeadlines: items.filter((p) => p.deadlineFlag === "missed").length,
      approachingDeadlines: items.filter((p) => p.deadlineFlag === "approaching").length,
    },
    projects: notable,
  };
}
