import Link from "next/link";
import { DateTime } from "luxon";
import { AutoSubmit } from "@/app/components/AutoSubmit";
import { fmt } from "@/lib/number-format";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { isUuid, loadSummaryData } from "@/lib/projects";
import { listOrg } from "@/lib/org";
import { listReports } from "@/lib/reports";
import { buildNarrative } from "@/lib/narrative";
import { buildWeeklySummary, type ProjectSummary } from "@/lib/summary";
import { formatDate, formatDateTime, timeZone, weekWindow } from "@/lib/time";

const s = (v: string) => STATUS_LABELS[v] ?? v;
const d = (v: string | null) => (v ? formatDate(v) : "none");

function lines(p: ProjectSummary): string[] {
  const out: string[] = [];
  if (p.isNew) out.push("New this week");
  if (p.statusChange) out.push(`Status: ${s(p.statusChange.from)} → ${s(p.statusChange.to)}`);
  if (p.priorityChange) out.push(`Priority: ${PRIORITY_LABELS[p.priorityChange.from] ?? p.priorityChange.from} → ${PRIORITY_LABELS[p.priorityChange.to] ?? p.priorityChange.to}`);
  if (p.deadlineChange) out.push(`Deadline: ${d(p.deadlineChange.from)} → ${d(p.deadlineChange.to)}`);
  if (p.nextStepChange) out.push(`Next step: "${p.nextStepChange.from || "none"}" → "${p.nextStepChange.to || "none"}"`);
  if (p.assigneesAdded.length) out.push(`Assigned: ${p.assigneesAdded.join(", ")}`);
  if (p.assigneesRemoved.length) out.push(`Unassigned: ${p.assigneesRemoved.join(", ")}`);
  if (p.archivedChange) out.push(p.archivedChange === "archived" ? "Archived" : "Restored from archive");
  if (p.comments) out.push(`${p.comments} new comment${p.comments === 1 ? "" : "s"}`);
  return out;
}

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ weeks?: string; location?: string; team?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { weeks } = sp;
  const location = sp.location && isUuid(sp.location) ? sp.location : null;
  const team = sp.team && isUuid(sp.team) ? sp.team : null;
  const weeksAgo = Math.min(Math.max(Number.parseInt(weeks ?? "0", 10) || 0, 0), 12);
  const zone = timeZone();
  const win = weekWindow(new Date(), zone, weeksAgo);

  // Everything loaded here is already limited by the database to projects this user may see.
  const isAdmin = user.role === "admin";
  const startDate = DateTime.fromJSDate(win.start, { zone }).toISODate()!;
  const endDate = DateTime.fromJSDate(win.end, { zone }).toISODate()!;
  const prevStart = DateTime.fromISO(startDate).minus({ days: 7 }).toISODate()!;
  const [raw, locations, teams, reports] = await Promise.all([
    loadSummaryData(user.id, win.start), listOrg(user.id, "locations"), listOrg(user.id, "teams"),
    isAdmin ? listReports(user.id, { from: prevStart, to: endDate, location }) : Promise.resolve([]),
  ]);
  // Narrow to one location or team; history, comments and tasks follow their projects.
  const projects = raw.projects.filter((p) => (!location || p.location_id === location) && (!team || p.team_id === team));
  const ids = new Set(projects.map((p) => p.id));
  const data = { projects, events: raw.events.filter((e) => ids.has(e.project_id)), comments: raw.comments.filter((c) => ids.has(c.project_id)), tasks: raw.tasks.filter((k) => ids.has(k.project_id)) };
  const summary = buildWeeklySummary({ projects: data.projects, events: data.events, start: win.start, end: win.end, zone });
  const t = summary.totals;
  const narrative = buildNarrative({ ...data, start: win.start, end: win.end, zone, period: win.isCurrent ? "this week" : "that week" });

  // Store snapshot for admins: this week against the week before, from the nightly reports.
  const activeLocations = locations.filter((l) => !l.archived_at && (!location || l.id === location));
  const stores = activeLocations.map((l) => {
    const now = reports.filter((r) => r.location_id === l.id && r.report_date >= startDate && r.report_date <= endDate);
    const before = reports.filter((r) => r.location_id === l.id && r.report_date >= prevStart && r.report_date < startDate);
    const sales = now.reduce((a, r) => a + r.sales, 0);
    const prev = before.reduce((a, r) => a + r.sales, 0);
    const tickets = now.map((r) => r.longest_ticket_minutes).filter((v): v is number => v !== null);
    const issues = now.filter((r) => r.staffing_issues.trim()).length;
    return { ...l, nights: now.length, sales, prev, change: prev ? ((sales - prev) / prev) * 100 : null, worst: tickets.length ? Math.max(...tickets) : null, issues };
  });
  const keep = (extra: Record<string, string>) => new URLSearchParams({ ...(location ? { location } : {}), ...(team ? { team } : {}), ...extra }).toString();

  return (
    <>
      <div className="page-head"><h1>Weekly summary</h1></div>
      <p className="week-nav">
        <span className="muted">{win.label}</span>
        {weeksAgo > 0 ? <Link href={`/summary?${keep({ weeks: String(weeksAgo - 1) })}`}>← Newer</Link> : null}
        <Link href={`/summary?${keep({ weeks: String(weeksAgo + 1) })}`}>Previous week →</Link>
      </p>
      <AutoSubmit className="toolbar" action="/summary">
        {weeksAgo ? <input type="hidden" name="weeks" value={String(weeksAgo)} /> : null}
        <select name="location" defaultValue={location ?? ""} aria-label="Location">
          <option value="">All locations</option>
          {locations.filter((l) => !l.archived_at).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select name="team" defaultValue={team ?? ""} aria-label="Team">
          <option value="">All teams</option>
          {teams.filter((x) => !x.archived_at).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </AutoSubmit>

      {isAdmin && stores.length ? (
        <section className="stores">
          {stores.map((st) => (
            <div key={st.id} className="store">
              <h3><i style={{ background: st.color }} aria-hidden="true" />{st.name}</h3>
              <b>{fmt(st.sales, "money")}</b>
              <small className={st.change === null ? "" : st.change >= 0 ? "up" : "down"}>
                {st.change === null ? "No reports the week before" : `${st.change >= 0 ? "▲" : "▼"} ${Math.abs(st.change).toFixed(1)}% vs the week before`}
              </small>
              <span className="muted">{st.nights} nightly report{st.nights === 1 ? "" : "s"}{st.worst !== null ? ` · longest ticket ${fmt(st.worst, "minutes")}` : ""}{st.issues ? ` · ${st.issues} staffing note${st.issues === 1 ? "" : "s"}` : ""}</span>
            </div>
          ))}
        </section>
      ) : null}

      <div className="stats">
        <div className="stat"><b>{t.activeAtEnd}</b>active projects</div>
        <div className="stat"><b>{t.created}</b>created</div>
        <div className="stat"><b>{t.completed}</b>completed</div>
        <div className="stat"><b>{t.newlyBlocked}</b>newly stuck</div>
        <div className="stat"><b>{t.missedDeadlines}</b>missed deadlines</div>
        <div className="stat"><b>{t.approachingDeadlines}</b>due within 7 days</div>
      </div>

      <section className="narrative">
        {narrative.length === 0 ? <p className="muted">Nothing to report for this period.</p> : narrative.map((person) => (
          <article className="card person" key={person.id}>
            <h3>{person.name}</h3>
            {person.started ? <p className="started">{person.started}</p> : null}
            {person.projects.map((p) => (
              <div className="story" key={p.id}>
                <p>
                  {p.prefix}<Link href={`/?open=${p.id}#p-${p.id}`}><b>{p.name}</b></Link>{p.suffix}{" "}
                  {p.sentences.join(" ")}
                </p>
              </div>
            ))}
          </article>
        ))}
      </section>

      <details className="card changes">
        <summary>All changes</summary>
        {summary.projects.length === 0 ? <p className="muted">Nothing to report for this period.</p> : (
          <ul className="plain">
            {summary.projects.map((p) => (
              <li key={p.id}>
                <Link href={`/?open=${p.id}#p-${p.id}`}><b>{p.name}</b></Link>{" "}
                <span className={`chip ${p.endStatus}`}>{s(p.endStatus)}</span>
                {p.newlyBlocked ? <> <span className="chip bad">newly stuck</span></> : null}
                {p.completed ? <> <span className="chip ok">completed</span></> : null}
                {p.deadlineFlag === "missed" ? <> <span className="chip bad">deadline missed ({d(p.deadline)})</span></> : null}
                {p.deadlineFlag === "approaching" ? <> <span className="chip warn">due {d(p.deadline)}</span></> : null}
                {lines(p).length ? <ul className="muted tight">{lines(p).map((l) => <li key={l}>{l}</li>)}</ul> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">{t.unchanged} other project{t.unchanged === 1 ? "" : "s"} had no changes.</p>
      </details>
    </>
  );
}
