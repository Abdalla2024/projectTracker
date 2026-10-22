"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requestLoginCode, requireUser, signInWithPassword, signOut, signUpWithCode } from "@/lib/auth";
import { PRIORITIES, STATUSES } from "@/lib/constants";
import {
  NotAllowedError, addComment, createProject, deleteComment, editComment, getProjectDetail, isUuid, setArchived, setAssignees, updateProject,
} from "@/lib/projects";

const enc = encodeURIComponent;
const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const ids = (f: FormData, k: string) => f.getAll(k).map(String).filter(isUuid);

/** Turn a database/permission error into a short message for the user. */
function friendly(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (err instanceof NotAllowedError || code === "42501") return "You don't have permission to do that.";
  if (code === "23514" || code === "22P02" || code === "22007") return "One of the values isn't valid.";
  console.error(err);
  return "Something went wrong. Please try again.";
}

/** Run a mutation; on failure redirect back with a message (redirect must be called outside try/catch). */
async function attempt(back: string, fn: () => Promise<void>): Promise<void> {
  let error: string | null = null;
  try {
    await fn();
  } catch (e) {
    error = friendly(e);
  }
  if (error) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${enc(error)}`);
}

// ---- sign in ---------------------------------------------------------------------------------

/** Step 1 of sign-up / password reset: email a one-time code. */
export async function requestCodeAction(formData: FormData) {
  const mode = str(formData, "mode") === "reset" ? "reset" : "signup";
  const res = await requestLoginCode(str(formData, "email"));
  if (!res.ok) redirect(`/signup?mode=${mode}&error=${enc(res.error)}`);
  redirect(`/signup/verify?email=${enc(res.email)}&mode=${mode}`);
}

/** Step 2: the code proves the address; the password is set and the user is signed in. */
export async function completeSignupAction(formData: FormData) {
  const email = str(formData, "email");
  const mode = str(formData, "mode") === "reset" ? "reset" : "signup";
  const back = (msg: string) => redirect(`/signup/verify?email=${enc(email)}&mode=${mode}&error=${enc(msg)}`);
  const password = str(formData, "password");
  if (password !== str(formData, "confirm")) back("The two passwords don't match.");
  const res = await signUpWithCode(email, str(formData, "code"), password);
  if (!res.ok) back(res.error);
  redirect("/");
}

export async function signInAction(formData: FormData) {
  if (!(await signInWithPassword(str(formData, "email"), str(formData, "password")))) {
    redirect(`/login?error=${enc("Incorrect email or password. After 5 wrong attempts an account is locked for 15 minutes.")}`);
  }
  redirect("/");
}

export async function signOutAction() {
  await signOut();
  redirect("/login");
}

// ---- projects --------------------------------------------------------------------------------

const optionalDate = z.union([z.literal(""), z.iso.date()]).transform((v) => (v === "" ? null : v));
const fields = {
  name: z.string().trim().min(1, "Name is required.").max(200),
  description: z.string().trim().max(5000),
  priority: z.enum(PRIORITIES),
  deadline: optionalDate,
  location_id: z.union([z.literal(""), z.uuid()]).transform((v) => (v === "" ? null : v)),
  team_id: z.union([z.literal(""), z.uuid()]).transform((v) => (v === "" ? null : v)),
};

export async function createProjectAction(formData: FormData) {
  const user = await requireUser();
  const parsed = z
    .object(fields)
    .safeParse({
      name: str(formData, "name"), description: str(formData, "description"), priority: str(formData, "priority"),
      deadline: str(formData, "deadline"), location_id: str(formData, "location_id"), team_id: str(formData, "team_id"),
    });
  if (!parsed.success) redirect(`/?new=1&error=${enc(parsed.error.issues[0].message)}`);

  let id = "";
  await attempt("/?new=1", async () => {
    // Status, phase and progress start empty and are then computed from the tasks by the database.
    id = await createProject(user, {
      ...parsed.data, status: "not_started", next_step: "", phase: "", progress: 0, assigneeIds: ids(formData, "assignees"),
      taskTitles: formData.getAll("task_titles").map((t) => String(t).trim().slice(0, 300)).filter(Boolean).slice(0, 50),
    });
  });
  redirect(`/?open=${id}&saved=1#p-${id}`);
}

export async function updateProjectAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!isUuid(id)) redirect("/");
  const back = `/?open=${id}`;

  // Shared workspace: everyone active may edit every field (the database enforces who may archive).
  const project = await getProjectDetail(user.id, id);
  if (!project) redirect("/");
  // Status is automatic unless flagged Stuck or Cancelled; "auto" hands it back to the database.
  const schema = z.object({ ...fields, status: z.enum(["auto", "blocked", "cancelled"]).transform((v) => (v === "auto" ? "not_started" : v)) });
  const raw = Object.fromEntries(
    ["name", "description", "priority", "deadline", "status", "location_id", "team_id"].map((k) => [k, str(formData, k)]),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) redirect(`${back}&error=${enc(parsed.error.issues[0].message)}#p-${id}`);

  await attempt(back, () => updateProject(user.id, id, parsed.data as Record<string, string | number | null>));
  redirect(`${back}&saved=1#p-${id}`);
}

export async function assignAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!isUuid(id)) redirect("/");
  await attempt(`/?open=${id}`, () => setAssignees(user.id, id, ids(formData, "assignees")));
  redirect(`/?open=${id}&saved=1#p-${id}`);
}

export async function commentAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!isUuid(id)) redirect("/");
  const parsed = z.string().trim().min(1, "Write a comment first.").max(4000).safeParse(str(formData, "body"));
  if (!parsed.success) redirect(`/?open=${id}&error=${enc(parsed.error.issues[0].message)}#p-${id}`);
  const parent = str(formData, "parent_id");
  await attempt(`/?open=${id}`, () => addComment(user.id, id, parsed.data, isUuid(parent) ? parent : null));
  redirect(`/?open=${id}#c-${id}`);
}

export async function editCommentAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  const commentId = str(formData, "comment_id");
  if (!isUuid(id) || !isUuid(commentId)) redirect("/");
  const parsed = z.string().trim().min(1, "A comment can't be empty.").max(4000).safeParse(str(formData, "body"));
  if (!parsed.success) redirect(`/?open=${id}&error=${enc(parsed.error.issues[0].message)}#c-${id}`);
  await attempt(`/?open=${id}`, () => editComment(user.id, id, commentId, parsed.data));
  redirect(`/?open=${id}#c-${id}`);
}

export async function deleteCommentAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  const commentId = str(formData, "comment_id");
  if (!isUuid(id) || !isUuid(commentId)) redirect("/");
  await attempt(`/?open=${id}`, () => deleteComment(user.id, id, commentId));
  redirect(`/?open=${id}#c-${id}`);
}

export async function archiveAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!isUuid(id)) redirect("/");
  await attempt(`/?open=${id}`, () => setArchived(user.id, id, str(formData, "archive") === "1"));
  redirect(`/?open=${id}&saved=1#p-${id}`);
}
