import Link from "next/link";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { loadSummaryData } from "@/lib/projects";
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

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ weeks?: string }> }) {
  const user = await requireUser();
  const { weeks } = await searchParams;
  const weeksAgo = Math.min(Math.max(Number.parseInt(weeks ?? "0", 10) || 0, 0), 12);
  const zone = timeZone();
  const win = weekWindow(new Date(), zone, weeksAgo);

  // Everything loaded here is already limited by the database to projects this user may see.
  const data = await loadSummaryData(user.id, win.start);
  const summary = buildWeeklySummary({ ...data, start: win.start, end: win.end, zone });
  const t = summary.totals;
  const narrative = buildNarrative({ projects: data.projects, events: data.events, comments: data.comments, start: win.start, end: win.end, zone, period: win.isCurrent ? "this week" : "that week" });

  return (
    <>
      <div className="page-head"><h1>Weekly summary</h1></div>
      <p className="week-nav">
        <span className="muted">{win.label}</span>
        {weeksAgo > 0 ? <Link href={`/summary?weeks=${weeksAgo - 1}`}>← Newer</Link> : null}
        <Link href={`/summary?weeks=${weeksAgo + 1}`}>Previous week →</Link>
      </p>

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
