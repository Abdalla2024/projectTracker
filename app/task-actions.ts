"use server";

// Task changes called straight from the task list (no page navigation). Each returns an error
// message or null; the list then refreshes the page data so the project's ring, status and current
// phase (computed by the database) update immediately.
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { NotAllowedError, isUuid } from "@/lib/projects";
import { createSection, createTask, deleteSection, deleteTask, moveTask, renameSection, setTaskDone, updateTask } from "@/lib/tasks";

type Result = string | null;

function friendly(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (err instanceof NotAllowedError || code === "42501") return "You don't have permission to do that.";
  if (code === "23514" || code === "22P02" || code === "22007") return "One of the values isn't valid.";
  console.error(err);
  return "Something went wrong. Please try again.";
}

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); return null; } catch (e) { return friendly(e); }
}

const id = z.uuid();
const optId = z.union([z.uuid(), z.null()]);
const ids = z.array(z.uuid()).max(50);
const title = z.string().trim().min(1, "Give the task a name.").max(300);
const date = z.union([z.iso.date(), z.null()]);

export async function toggleTask(taskId: string, done: boolean): Promise<Result> {
  const user = await requireUser();
  if (!isUuid(taskId)) return "That task wasn't found.";
  return run(() => setTaskDone(user.id, taskId, done));
}

export async function addTask(input: { projectId: string; title: string; sectionId: string | null; parentId: string | null; assigneeIds: string[]; dueDate: string | null }): Promise<Result> {
  const user = await requireUser();
  const p = z.object({ projectId: id, title, sectionId: optId, parentId: optId, assigneeIds: ids, dueDate: date }).safeParse(input);
  if (!p.success) return p.error.issues[0].message;
  return run(() => createTask(user.id, p.data.projectId, {
    title: p.data.title, section_id: p.data.sectionId, parent_id: p.data.parentId, assigneeIds: p.data.assigneeIds, due_date: p.data.dueDate,
  }));
}

export async function saveTask(input: { projectId: string; taskId: string; title: string; notes: string; assigneeIds: string[]; dueDate: string | null }): Promise<Result> {
  const user = await requireUser();
  const p = z.object({ projectId: id, taskId: id, title, notes: z.string().max(5000), assigneeIds: ids, dueDate: date }).safeParse(input);
  if (!p.success) return p.error.issues[0].message;
  return run(() => updateTask(user.id, p.data.projectId, p.data.taskId, {
    title: p.data.title, notes: p.data.notes, due_date: p.data.dueDate, assigneeIds: p.data.assigneeIds,
  }));
}

export async function setTaskPeople(projectId: string, taskId: string, assigneeIds: string[]): Promise<Result> {
  const user = await requireUser();
  const p = z.object({ projectId: id, taskId: id, assigneeIds: ids }).safeParse({ projectId, taskId, assigneeIds });
  if (!p.success) return p.error.issues[0].message;
  return run(() => updateTask(user.id, p.data.projectId, p.data.taskId, { assigneeIds: p.data.assigneeIds }));
}

export async function removeTask(projectId: string, taskId: string): Promise<Result> {
  const user = await requireUser();
  if (!isUuid(projectId) || !isUuid(taskId)) return "That task wasn't found.";
  return run(() => deleteTask(user.id, projectId, taskId));
}

export async function placeTask(projectId: string, taskId: string, sectionId: string | null, beforeId: string | null): Promise<Result> {
  const user = await requireUser();
  const p = z.object({ projectId: id, taskId: id, sectionId: optId, beforeId: optId }).safeParse({ projectId, taskId, sectionId, beforeId });
  if (!p.success) return "That move isn't valid.";
  return run(() => moveTask(user.id, p.data.projectId, p.data.taskId, p.data.sectionId, p.data.beforeId));
}

export async function addSection(projectId: string, name: string): Promise<Result> {
  const user = await requireUser();
  const p = z.object({ projectId: id, name: z.string().trim().min(1, "Give the section a name.").max(80) }).safeParse({ projectId, name });
  if (!p.success) return p.error.issues[0].message;
  return run(() => createSection(user.id, p.data.projectId, p.data.name));
}

export async function renameSectionTo(projectId: string, sectionId: string, name: string): Promise<Result> {
  const user = await requireUser();
  const p = z.object({ projectId: id, sectionId: id, name: z.string().trim().min(1, "Give the section a name.").max(80) }).safeParse({ projectId, sectionId, name });
  if (!p.success) return p.error.issues[0].message;
  return run(() => renameSection(user.id, p.data.projectId, p.data.sectionId, p.data.name));
}

export async function removeSection(projectId: string, sectionId: string): Promise<Result> {
  const user = await requireUser();
  if (!isUuid(projectId) || !isUuid(sectionId)) return "That section wasn't found.";
  return run(() => deleteSection(user.id, projectId, sectionId));
}
