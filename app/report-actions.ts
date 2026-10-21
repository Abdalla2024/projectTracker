"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { NotAllowedError, isUuid } from "@/lib/projects";
import { DuplicateReportError, createReport, updateReport, type ReportInput } from "@/lib/reports";
import { WEATHER_ORDER } from "@/lib/weather";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const enc = encodeURIComponent;
const text = z.string().trim().max(4000);

const schema = z.object({
  location_id: z.uuid("Pick a location."),
  report_date: z.iso.date("Pick a date."),
  sales: z.coerce.number("Enter sales as a number.").min(0, "Sales can't be negative.").max(9_999_999.99),
  manager_on_duty: z.string().trim().min(1, "Enter the manager on duty.").max(100),
  weather: z.enum(WEATHER_ORDER, "Pick the weather."),
  temperature_f: z.coerce.number("Enter the temperature.").int("Use a whole number for temperature.").min(-40).max(130),
  longest_ticket_minutes: z.union([z.literal(""), z.coerce.number().min(0).max(600)]).transform((v) => (v === "" ? null : v)),
  general_notes: text, customer_feedback: text, staffing_issues: text, waste_log: text, upcoming_events: text,
});

function parse(f: FormData) {
  const raw = Object.fromEntries(Object.keys(schema.shape).map((k) => [k, str(f, k).replace(/^\$/, "").replace(/,/g, k === "sales" ? "" : ",")]));
  return schema.safeParse(raw);
}

function message(e: unknown) {
  if (e instanceof DuplicateReportError) return "There is already a report for that location and night. Open it from the list to correct it.";
  if (e instanceof NotAllowedError || (e as { code?: string })?.code === "42501") return "You can only change reports you submitted.";
  if ((e as { code?: string })?.code === "23514") return "One of the values isn't valid (or the location is archived).";
  console.error(e);
  return "Something went wrong. Please try again.";
}

export async function createReportAction(formData: FormData) {
  const user = await requireUser();
  const p = parse(formData);
  if (!p.success) redirect(`/reports/new?error=${enc(p.error.issues[0].message)}`);
  let id = "";
  let error: string | null = null;
  try { id = await createReport(user.id, p.data as ReportInput); } catch (e) { error = message(e); }
  if (error) redirect(`/reports/new?error=${enc(error)}`);
  redirect(`/reports/${id}?saved=1`);
}

export async function updateReportAction(formData: FormData) {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!isUuid(id)) redirect("/reports");
  const p = parse(formData);
  if (!p.success) redirect(`/reports/${id}?error=${enc(p.error.issues[0].message)}`);
  let error: string | null = null;
  try { await updateReport(user.id, id, p.data as ReportInput); } catch (e) { error = message(e); }
  redirect(`/reports/${id}?${error ? `error=${enc(error)}` : "saved=1"}`);
}
