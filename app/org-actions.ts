"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createOrg, updateOrg, type OrgKind } from "@/lib/org";
import { isUuid } from "@/lib/projects";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const enc = encodeURIComponent;
const kindOf = (f: FormData): OrgKind => (str(f, "kind") === "teams" ? "teams" : "locations");
const name = z.string().trim().min(1, "Give it a name.").max(60, "Use at most 60 characters.");
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour.");

async function done(fn: () => Promise<void>) {
  let error: string | null = null;
  try { await fn(); } catch (e) {
    const code = (e as { code?: string })?.code;
    error = code === "23505" ? "That name is already used." : code === "42501" ? "Only an admin can change locations and teams." : "Something went wrong.";
    if (!code) console.error(e);
  }
  redirect(`/settings${error ? `?error=${enc(error)}` : "?saved=1"}`);
}

export async function createOrgAction(formData: FormData) {
  const user = await requireUser();
  const n = name.safeParse(str(formData, "name"));
  const c = color.safeParse(str(formData, "color"));
  if (!n.success || !c.success) redirect(`/settings?error=${enc((n.error ?? c.error)!.issues[0].message)}`);
  await done(() => createOrg(user.id, kindOf(formData), n.data, c.data));
}

export async function updateOrgAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!isUuid(id)) redirect("/settings");
  const archive = str(formData, "archive");
  if (archive) {
    await done(() => updateOrg(user.id, kindOf(formData), id, { archived: archive === "1" }));
    return;
  }
  const n = name.safeParse(str(formData, "name"));
  const c = color.safeParse(str(formData, "color"));
  if (!n.success || !c.success) redirect(`/settings?error=${enc((n.error ?? c.error)!.issues[0].message)}`);
  await done(() => updateOrg(user.id, kindOf(formData), id, { name: n.data, color: c.data }));
}
