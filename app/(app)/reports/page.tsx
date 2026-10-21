import Link from "next/link";
import { DateTime } from "luxon";
import { Alerts } from "@/app/components/Alerts";
import { AutoSubmit } from "@/app/components/AutoSubmit";
import { requireUser } from "@/lib/auth";
import { listOrg } from "@/lib/org";
import { isUuid } from "@/lib/projects";
import { listReports } from "@/lib/reports";
import { formatDate, localDateString, timeZone } from "@/lib/time";
import { WEATHER_LABELS } from "@/lib/weather";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ location?: string; days?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const isAdmin = user.role === "admin";
  const zone = timeZone();
  const today = localDateString(new Date(), zone);
  const days = [7, 30, 90, 365].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const from = DateTime.fromISO(today).minus({ days: days - 1 }).toISODate()!;
  const location = sp.location && isUuid(sp.location) ? sp.location : null;
  const [reports, locations] = await Promise.all([listReports(user.id, { from, to: today, location }), listOrg(user.id, "locations")]);
  const active = locations.filter((l) => !l.archived_at);
  const has = (s: string) => s.trim().length > 0;
  const submittedToday = new Set(reports.filter((r) => r.report_date === today).map((r) => r.location_id));

  return (
    <>
      <div className="page-head">
        <h1>Nightly reports</h1>
        <Link className="btn" href={`/reports/new${location ? `?location=${location}` : ""}`}>+ New report</Link>
      </div>
      <Alerts error={sp.error} />
      {isAdmin && active.length ? (
        <div className="tonight">
          <span className="muted">Tonight:</span>
          {active.map((l) => (
            <span key={l.id} className={`chip ${submittedToday.has(l.id) ? "ok" : ""}`}><i style={{ background: l.color }} aria-hidden="true" />{l.name}: {submittedToday.has(l.id) ? "submitted" : "not yet"}</span>
          ))}
        </div>
      ) : null}
      <AutoSubmit className="toolbar" action="/reports">
        <select name="location" defaultValue={location ?? ""} aria-label="Location">
          <option value="">All locations</option>
          {active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select name="days" defaultValue={String(days)} aria-label="Period">
          <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option>
        </select>
        {!isAdmin ? <span className="hint">You see the reports you submitted. Admins see all reports.</span> : null}
      </AutoSubmit>
      {reports.length === 0 ? (
        <div className="empty-card">No reports in this period.</div>
      ) : (
        <div className="card table-card">
          <table className="stack reports">
            <thead><tr><th>Date</th><th>Store</th><th className="num">Sales</th><th>Manager</th><th>Weather</th><th className="num">Longest ticket</th><th>Notes</th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td data-label="Date"><Link href={`/reports/${r.id}`}><b>{formatDate(r.report_date)}</b></Link></td>
                  <td data-label="Store"><span className="dot-label"><i style={{ background: r.location_color }} aria-hidden="true" />{r.location_name}</span></td>
                  <td data-label="Sales" className="num">{money(r.sales)}</td>
                  <td data-label="Manager">{r.manager_on_duty}</td>
                  <td data-label="Weather">{WEATHER_LABELS[r.weather]}, {r.temperature_f}°F</td>
                  <td data-label="Longest ticket" className="num">{r.longest_ticket_minutes === null ? "—" : `${r.longest_ticket_minutes} min`}</td>
                  <td data-label="Notes" className="note-flags">
                    {has(r.customer_feedback) ? <span className="chip" title={r.customer_feedback}>Feedback</span> : null}
                    {has(r.staffing_issues) ? <span className="chip warn" title={r.staffing_issues}>Staffing</span> : null}
                    {has(r.waste_log) ? <span className="chip" title={r.waste_log}>Waste</span> : null}
                    {has(r.upcoming_events) ? <span className="chip info" title={r.upcoming_events}>Events</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
