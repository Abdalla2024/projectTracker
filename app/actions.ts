"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requestLoginCode, requireUser, signOut, verifyLoginCode } from "@/lib/auth";
import { PRIORITIES, STATUSES } from "@/lib/constants";
import {
  NotAllowedError, addComment, createProject, getProjectDetail, isUuid, setArchived, setAssignmentsAndStores,
  updateProject,
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

export async function requestCodeAction(formData: FormData) {
  const res = await requestLoginCode(str(formData, "email"));
  if (!res.ok) redirect(`/login?error=${enc(res.error)}`);
  redirect(`/login/verify?email=${enc(res.email)}`);
}

export async function verifyCodeAction(formData: FormData) {
  const email = str(formData, "email");
  if (!(await verifyLoginCode(email, str(formData, "code")))) {
    redirect(`/login/verify?email=${enc(email)}&error=${enc("That code didn't work or has expired. Request a new one.")}`);
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
  next_step: z.string().trim().max(500),
};

export async function createProjectAction(formData: FormData) {
  const user = await requireUser();
  const parsed = z
    .object({ ...fields, status: z.enum(STATUSES) })
    .safeParse({
      name: str(formData, "name"), description: str(formData, "description"), priority: str(formData, "priority"),
      deadline: str(formData, "deadline"), next_step: str(formData, "next_step"), status: str(formData, "status"),
    });
  if (!parsed.success) redirect(`/projects/new?error=${enc(parsed.error.issues[0].message)}`);

  let id = "";
  await attempt("/projects/new", async () => {
    id = await createProject(user, {
      ...parsed.data, assigneeIds: ids(formData, "assignees"), storeIds: ids(formData, "stores"),
    });
  });
  redirect(`/projects/${id}?saved=1`);
}

export async function updateProjectAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!isUuid(id)) redirect("/");
  const back = `/projects/${id}`;

  // What the form may send depends on the user; the database enforces the same rule independently.
  const project = await getProjectDetail(user.id, id);
  if (!project) redirect("/");
  const fullEdit = user.role === "admin" || project.created_by === user.id;

  const schema = fullEdit
    ? z.object({ ...fields, status: z.enum(STATUSES) })
    : z.object({ status: z.enum(STATUSES), next_step: fields.next_step });
  const raw = Object.fromEntries(
    (fullEdit ? ["name", "description", "priority", "deadline", "next_step", "status"] : ["status", "next_step"]).map((k) => [k, str(formData, k)]),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) redirect(`${back}?error=${enc(parsed.error.issues[0].message)}`);

  await attempt(back, () => updateProject(user.id, id, parsed.data as Record<string, string | null>));
  redirect(`${back}?saved=1`);
}

export async function assignAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!isUuid(id)) redirect("/");
  await attempt(`/projects/${id}`, () => setAssignmentsAndStores(user.id, id, ids(formData, "assignees"), ids(formData, "stores")));
  redirect(`/projects/${id}?saved=1`);
}

export async function commentAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!isUuid(id)) redirect("/");
  const parsed = z.string().trim().min(1, "Write a comment first.").max(4000).safeParse(str(formData, "body"));
  if (!parsed.success) redirect(`/projects/${id}?error=${enc(parsed.error.issues[0].message)}#comments`);
  await attempt(`/projects/${id}`, () => addComment(user.id, id, parsed.data));
  redirect(`/projects/${id}#comments`);
}

export async function archiveAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!isUuid(id)) redirect("/");
  await attempt(`/projects/${id}`, () => setArchived(user.id, id, str(formData, "archive") === "1"));
  redirect(`/projects/${id}?saved=1`);
}
