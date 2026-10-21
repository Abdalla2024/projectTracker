import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { AutoSubmit } from "@/app/components/AutoSubmit";
import { BarChart, LineChart, ScatterChart } from "@/app/components/Charts";
import { fmt } from "@/lib/number-format";
import { requireUser } from "@/lib/auth";
import { buildDashboard } from "@/lib/dashboard";
import { listOrg } from "@/lib/org";
import { isUuid } from "@/lib/projects";
import { listReports } from "@/lib/reports";
import { formatDate, localDateString, timeZone } from "@/lib/time";

const RANGES = [{ v: "7", l: "Last 7 days" }, { v: "30", l: "Last 30 days" }, { v: "90", l: "Last 90 days" }, { v: "365", l: "Last 12 months" }];
const NOTE_KINDS = [
  { key: "customer_feedback", label: "Customer feedback", cls: "" },
  { key: "staffing_issues", label: "Staffing", cls: "warn" },
  { key: "waste_log", label: "Waste", cls: "" },
  { key: "upcoming_events", label: "Upcoming event", cls: "info" },
] as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string; location?: string }> }) {
  const user = await requireUser();
  // Sales data: admins only (the database also limits members to their own reports).
  if (user.role !== "admin") notFound();
  const sp = await searchParams;
  const zone = timeZone();
  const today = localDateString(new Date(), zone);
  const days = RANGES.some((r) => r.v === sp.days) ? Number(sp.days) : 30;
  const from = DateTime.fromISO(today).minus({ days: days - 1 }).toISODate()!;
  const prevFrom = DateTime.fromISO(from).minus({ days }).toISODate()!;
  const prevTo = DateTime.fromISO(from).minus({ days: 1 }).toISODate()!;
  const location = sp.location && isUuid(sp.location) ? sp.location : null;

  const [all, orgLocations] = await Promise.all([listReports(user.id, { from: prevFrom, to: today, location }), listOrg(user.id, "locations")]);
  const locations = orgLocations.filter((l) => !l.archived_at && (!location || l.id === location)).map(({ id, name, color }) => ({ id, name, color }));
  const current = all.filter((r) => r.report_date >= from);
  const previous = all.filter((r) => r.report_date >= prevFrom && r.report_date <= prevTo);
  const d = buildDashboard({ reports: current, previous, locations, from, to: today, missingFrom: DateTime.fromISO(today).minus({ days: 7 }).toISODate()!, missingTo: DateTime.fromISO(today).minus({ days: 1 }).toISODate()! });
  const k = d.kpis;
  const change = k.previousSales ? ((k.totalSales - k.previousSales) / k.previousSales) * 100 : null;
  const notes = current
    .flatMap((r) => NOTE_KINDS.filter((n) => r[n.key].trim()).map((n) => ({ r, n, text: r[n.key].trim() })))
    .slice(0, 12);

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <Link className="btn secondary" href="/reports">All nightly reports</Link>
      </div>
      <AutoSubmit className="toolbar" action="/dashboard">
        <select name="location" defaultValue={location ?? ""} aria-label="Location">
          <option value="">All locations</option>
          {orgLocations.filter((l) => !l.archived_at).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select name="days" defaultValue={String(days)} aria-label="Period">
          {RANGES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
        </select>
        <span className="hint">{formatDate(from)} – {formatDate(today)}</span>
      </AutoSubmit>

      {locations.length === 0 ? <div className="empty-card">Add locations in Settings to start collecting nightly reports.</div> : (
        <>
          <div className="kpis">
            <div className="kpi">
              <span>Total sales</span>
              <b>{fmt(k.totalSales, "money")}</b>
              {change !== null ? <small className={change >= 0 ? "up" : "down"}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}% vs previous {days} days</small> : <small>No earlier period to compare</small>}
            </div>
            <div className="kpi"><span>Average per night</span><b>{fmt(k.avgDailySales, "money")}</b><small>per location</small></div>
            <div className="kpi"><span>Average longest ticket</span><b>{fmt(k.avgTicket, "minutes")}</b>
              <small>{k.worstTicket ? `Worst: ${fmt(k.worstTicket.minutes, "minutes")}, ${k.worstTicket.location}, ${formatDate(k.worstTicket.date)}` : "No ticket times"}</small></div>
            <div className="kpi"><span>Reports in</span><b>{k.submitted} / {k.expected}</b><small>{k.expected ? Math.round((k.submitted / k.expected) * 100) : 0}% of nights</small></div>
          </div>

          <section className="card chart-card">
            <h2>Sales by night</h2>
            <LineChart series={d.salesByDay} format="money" label="Sales by night, per location" />
          </section>

          <div className="chart-grid">
            <section className="card chart-card">
              <h2>Average sales by weather</h2>
              <BarChart data={d.salesByWeather} format="money" label="Average sales per night by weather" />
            </section>
            <section className="card chart-card">
              <h2>Sales vs temperature</h2>
              <ScatterChart points={d.salesVsTemp} trend={d.trend} xLabel="°F" format="money" label="Sales against temperature, one dot per location-night" />
            </section>
            <section className="card chart-card">
              <h2>Average sales by day of week</h2>
              <BarChart data={d.salesByWeekday} format="money" label="Average sales per night by day of the week" />
            </section>
            <section className="card chart-card">
              <h2>Total sales by location</h2>
              <BarChart data={d.salesByLocation.map((b) => ({ ...b, color: locations.find((l) => l.id === b.key)?.color }))} format="money" label="Total sales per location" countLabel="reports" />
            </section>
          </div>

          <section className="card chart-card">
            <h2>Longest ticket time</h2>
            <LineChart series={d.ticketByDay} format="minutes" label="Longest ticket time by night, per location" />
          </section>

          <div className="chart-grid">
            <section className="card">
              <h2>Missing reports, last 7 days</h2>
              {d.missing.length === 0 ? <p className="muted">Every location has reported every night.</p> : (
                <ul className="plain missing">
                  {d.missing.map((m) => (
                    <li key={`${m.locationId}-${m.date}`}>
                      <span><b>{m.location}</b> · {formatDate(m.date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card">
              <h2>Latest notes</h2>
              {notes.length === 0 ? <p className="muted">No notes in this period.</p> : (
                <ul className="plain notes">
                  {notes.map(({ r, n, text }) => (
                    <li key={`${r.id}-${n.key}`}>
                      <div className="note-meta"><span className={`chip ${n.cls}`}>{n.label}</span> <b>{r.location_name}</b> <span className="muted">· {formatDate(r.report_date)} · {r.manager_on_duty}</span></div>
                      <Link href={`/reports/${r.id}`} className="note-text">{text.length > 220 ? `${text.slice(0, 220)}…` : text}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
