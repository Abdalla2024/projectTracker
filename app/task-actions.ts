"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { NotAllowedError, isUuid } from "@/lib/projects";
import { createSection, createTask, deleteSection, deleteTask, renameSection, setTaskDone, updateTask } from "@/lib/tasks";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const optId = (v: string) => (isUuid(v) ? v : null);
const optDate = z.union([z.literal(""), z.iso.date()]).transform((v) => (v === "" ? null : v));
const enc = encodeURIComponent;

function friendly(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (err instanceof NotAllowedError || code === "42501") return "You don't have permission to do that.";
  if (code === "23514" || code === "22P02" || code === "22007") return "One of the values isn't valid.";
  console.error(err);
  return "Something went wrong. Please try again.";
}

/** Run a change, then go back to the open project (with an error message if it failed). */
async function run(projectId: string, fn: () => Promise<void>, back?: string) {
  let error: string | null = null;
  try { await fn(); } catch (e) { error = friendly(e); }
  const to = back || `/?open=${projectId}`;
  redirect(`${to}${to.includes("?") ? "&" : "?"}${error ? `error=${enc(error)}` : "t=1"}#tasks-${projectId}`);
}

export async function addTaskAction(formData: FormData) {
  const user = await requireUser();
  const projectId = str(formData, "project_id");
  if (!isUuid(projectId)) redirect("/");
  const title = z.string().trim().min(1).max(300).safeParse(str(formData, "title"));
  const due = optDate.safeParse(str(formData, "due_date"));
  if (!title.success || !due.success) redirect(`/?open=${projectId}&error=${enc("Give the task a title (and a valid date).")}#tasks-${projectId}`);
  await run(projectId, () => createTask(user.id, projectId, {
    title: title.data, due_date: due.data,
    section_id: optId(str(formData, "section_id")), parent_id: optId(str(formData, "parent_id")), assignee_id: optId(str(formData, "assignee_id")),
  }), str(formData, "back"));
}

export async function updateTaskAction(formData: FormData) {
  const user = await requireUser();
  const projectId = str(formData, "project_id");
  const taskId = str(formData, "task_id");
  if (!isUuid(projectId) || !isUuid(taskId)) redirect("/");
  const parsed = z.object({
    title: z.string().trim().min(1).max(300),
    notes: z.string().max(5000),
    due_date: optDate,
  }).safeParse({ title: str(formData, "title"), notes: str(formData, "notes"), due_date: str(formData, "due_date") });
  if (!parsed.success) redirect(`/?open=${projectId}&error=${enc("Give the task a title (and a valid date).")}#tasks-${projectId}`);
  await run(projectId, () => updateTask(user.id, projectId, taskId, {
    ...parsed.data, assignee_id: optId(str(formData, "assignee_id")), section_id: optId(str(formData, "section_id")),
  }), str(formData, "back"));
}

export async function toggleTaskAction(formData: FormData) {
  const user = await requireUser();
  const taskId = str(formData, "task_id");
  const back = str(formData, "back");
  if (!isUuid(taskId)) redirect("/");
  let projectId = "";
  let error: string | null = null;
  try { projectId = await setTaskDone(user.id, taskId, str(formData, "done") === "1"); } catch (e) { error = friendly(e); }
  if (back && !back.startsWith("/?open=")) {
    revalidatePath(back.split("?")[0]);
    redirect(`${back}${back.includes("?") ? "&" : "?"}${error ? `error=${enc(error)}` : "t=1"}`);
  }
  redirect(`/?open=${projectId}${error ? `&error=${enc(error)}` : ""}#tasks-${projectId}`);
}

export async function deleteTaskAction(formData: FormData) {
  const user = await requireUser();
  const projectId = str(formData, "project_id");
  const taskId = str(formData, "task_id");
  if (!isUuid(projectId) || !isUuid(taskId)) redirect("/");
  await run(projectId, () => deleteTask(user.id, projectId, taskId));
}

export async function addSectionAction(formData: FormData) {
  const user = await requireUser();
  const projectId = str(formData, "project_id");
  if (!isUuid(projectId)) redirect("/");
  const name = z.string().trim().min(1).max(80).safeParse(str(formData, "name"));
  if (!name.success) redirect(`/?open=${projectId}&error=${enc("Give the section a name.")}#tasks-${projectId}`);
  await run(projectId, () => createSection(user.id, projectId, name.data));
}

export async function renameSectionAction(formData: FormData) {
  const user = await requireUser();
  const projectId = str(formData, "project_id");
  const sectionId = str(formData, "section_id");
  if (!isUuid(projectId) || !isUuid(sectionId)) redirect("/");
  const name = z.string().trim().min(1).max(80).safeParse(str(formData, "name"));
  if (!name.success) redirect(`/?open=${projectId}&error=${enc("Give the section a name.")}#tasks-${projectId}`);
  await run(projectId, () => renameSection(user.id, projectId, sectionId, name.data));
}

export async function deleteSectionAction(formData: FormData) {
  const user = await requireUser();
  const projectId = str(formData, "project_id");
  const sectionId = str(formData, "section_id");
  if (!isUuid(projectId) || !isUuid(sectionId)) redirect("/");
  await run(projectId, () => deleteSection(user.id, projectId, sectionId));
}
