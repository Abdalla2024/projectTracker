import "server-only";
import { withUser } from "./db";
import { NotAllowedError } from "./projects";


export interface ReportInput {
  location_id: string;
  report_date: string;
  sales: number;
  manager_on_duty: string;
  weather: string;
  temperature_f: number;
  longest_ticket_minutes: number | null;
  general_notes: string;
  customer_feedback: string;
  staffing_issues: string;
  waste_log: string;
  upcoming_events: string;
}

export interface Report extends ReportInput {
  id: string;
  location_name: string;
  location_color: string;
  submitted_by: string;
  submitter_name: string;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `r.id, r.location_id, l.name as location_name, l.color as location_color, r.report_date::text as report_date,
  r.sales::float8 as sales, r.manager_on_duty, r.weather, r.temperature_f, r.longest_ticket_minutes::float8 as longest_ticket_minutes,
  r.general_notes, r.customer_feedback, r.staffing_issues, r.waste_log, r.upcoming_events,
  r.submitted_by, pr.display_name as submitter_name, r.created_at, r.updated_at`;
const FROM = "from nightly_reports r join locations l on l.id = r.location_id join profiles pr on pr.id = r.submitted_by";
const FIELDS = ["location_id", "report_date", "sales", "manager_on_duty", "weather", "temperature_f", "longest_ticket_minutes",
  "general_notes", "customer_feedback", "staffing_issues", "waste_log", "upcoming_events"] as const;

export class DuplicateReportError extends Error {}

const duplicate = (e: unknown) => (e as { code?: string })?.code === "23505";

export async function createReport(userId: string, input: ReportInput): Promise<string> {
  try {
    return await withUser(userId, async (c) =>
      (await c.query(
        `insert into nightly_reports (${FIELDS.join(", ")}, submitted_by) values (${FIELDS.map((_, i) => `$${i + 1}`).join(", ")}, $${FIELDS.length + 1}) returning id`,
        [...FIELDS.map((f) => input[f]), userId],
      )).rows[0].id as string,
    );
  } catch (e) {
    if (duplicate(e)) throw new DuplicateReportError();
    throw e;
  }
}

export async function updateReport(userId: string, id: string, input: ReportInput): Promise<void> {
  try {
    await withUser(userId, async (c) => {
      const r = await c.query(
        `update nightly_reports set ${FIELDS.map((f, i) => `${f} = $${i + 2}`).join(", ")} where id = $1`,
        [id, ...FIELDS.map((f) => input[f])],
      );
      if (r.rowCount === 0) throw new NotAllowedError("Report not found or not yours");
    });
  } catch (e) {
    if (duplicate(e)) throw new DuplicateReportError();
    throw e;
  }
}

/** Visible to its submitter and to admins (the database decides). */
export async function getReport(userId: string, id: string): Promise<Report | null> {
  return withUser(userId, async (c) => (await c.query(`select ${COLUMNS} ${FROM} where r.id = $1`, [id])).rows[0] ?? null);
}

export async function listReports(userId: string, f: { from: string; to: string; location?: string | null }): Promise<Report[]> {
  return withUser(userId, async (c) =>
    (await c.query(
      `select ${COLUMNS} ${FROM} where r.report_date between $1 and $2 and ($3::uuid is null or r.location_id = $3)
       order by r.report_date desc, l.sort_order, l.name`,
      [f.from, f.to, f.location ?? null],
    )).rows,
  );
}
