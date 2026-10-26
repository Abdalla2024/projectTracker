import Link from "next/link";
import { DateTime } from "luxon";
import { AutoSubmit } from "@/app/components/AutoSubmit";
import { requireUser } from "@/lib/auth";
import { listOrg } from "@/lib/org";
import { isUuid } from "@/lib/projects";
import { listCalendar, type CalendarItem } from "@/lib/tasks";
import { localDateString, timeZone } from "@/lib/time";

type SP = { view?: string; week?: string; month?: string; location?: string; team?: string; mine?: string };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const zone = timeZone();
  const today = localDateString(new Date(), zone);
  // Week view is the default: one week is easier to take in than a month of deadlines.
  const view = sp.view === "month" ? "month" : "week";
  const location = sp.location && isUuid(sp.location) ? sp.location : null;
  const team = sp.team && isUuid(sp.team) ? sp.team : null;
  const mine = sp.mine === "1";

  // Weeks start on Monday.
  const weekStart = (/^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? DateTime.fromISO(sp.week!) : DateTime.fromISO(today)).startOf("week");
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? DateTime.fromISO(`${sp.month}-01`) : DateTime.fromISO(today).startOf("month");
  const gridStart = view === "week" ? weekStart : month.startOf("month").startOf("week");
  const gridEnd = view === "week" ? weekStart.plus({ days: 6 }) : month.endOf("month").endOf("week").startOf("day");

  const [items, locations, teams] = await Promise.all([
    listCalendar(user.id, gridStart.toISODate()!, gridEnd.toISODate()!, { location, team, mine }),
    listOrg(user.id, "locations"), listOrg(user.id, "teams"),
  ]);
  const days: DateTime[] = [];
  for (let d = gridStart; d <= gridEnd; d = d.plus({ days: 1 })) days.push(d);

  const filters = { ...(location ? { location } : {}), ...(team ? { team } : {}), ...(mine ? { mine: "1" } : {}) };
  const link = (extra: Record<string, string>) => `/calendar?${new URLSearchParams({ ...filters, ...extra })}`;
  const weekLink = (d: DateTime) => link({ week: d.toISODate()! });
  const monthLink = (d: DateTime) => link({ view: "month", month: d.toFormat("yyyy-MM") });
  const weekLabel = weekStart.month === gridEnd.month
    ? `${weekStart.toFormat("LLL d")} – ${gridEnd.toFormat("d, yyyy")}`
    : `${weekStart.toFormat("LLL d")} – ${gridEnd.toFormat("LLL d, yyyy")}`;
  const isThisWeek = DateTime.fromISO(today).startOf("week").toISODate() === weekStart.toISODate();
  const href = (i: CalendarItem) => `/?open=${i.project_id}#${i.kind === "task" ? "tasks-" : "p-"}${i.project_id}`;
  const openCount = items.filter((i) => !i.done).length;

  return (
    <>
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="cal-controls">
          <div className="seg" role="group" aria-label="View">
            <Link href={weekLink(view === "week" ? weekStart : month.startOf("month") <= DateTime.fromISO(today) && DateTime.fromISO(today) <= month.endOf("month") ? DateTime.fromISO(today) : month.startOf("month"))}
              aria-current={view === "week" ? "page" : undefined}>Week</Link>
            <Link href={monthLink(view === "month" ? month : weekStart)} aria-current={view === "month" ? "page" : undefined}>Month</Link>
          </div>
          {view === "week" ? (
            <div className="seg">
              <Link href={weekLink(weekStart.minus({ weeks: 1 }))} aria-label="Previous week">←</Link>
              <Link href={weekLink(DateTime.fromISO(today))} aria-current="page" title="Back to this week">{weekLabel}</Link>
              <Link href={weekLink(weekStart.plus({ weeks: 1 }))} aria-label="Next week">→</Link>
            </div>
          ) : (
            <div className="seg">
              <Link href={monthLink(month.minus({ months: 1 }))} aria-label="Previous month">←</Link>
              <Link href={monthLink(DateTime.fromISO(today))} aria-current="page" title="Back to this month">{month.toFormat("LLL yyyy")}</Link>
              <Link href={monthLink(month.plus({ months: 1 }))} aria-label="Next month">→</Link>
            </div>
          )}
        </div>
      </div>
      <AutoSubmit className="toolbar" action="/calendar">
        {view === "month" ? <><input type="hidden" name="view" value="month" /><input type="hidden" name="month" value={month.toFormat("yyyy-MM")} /></>
          : <input type="hidden" name="week" value={weekStart.toISODate()!} />}
        <select name="location" defaultValue={location ?? ""} aria-label="Location">
          <option value="">All locations</option>
          {locations.filter((l) => !l.archived_at).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select name="team" defaultValue={team ?? ""} aria-label="Team">
          <option value="">All teams</option>
          {teams.filter((t) => !t.archived_at).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="inline check-label"><input type="checkbox" name="mine" value="1" defaultChecked={mine} /> Only mine</label>
        {view === "week" ? <span className="hint">{openCount ? `${openCount} open ${openCount === 1 ? "item" : "items"} ${isThisWeek ? "this week" : "that week"}` : `Nothing due ${isThisWeek ? "this week" : "that week"}`}</span> : null}
      </AutoSubmit>

      {view === "week" ? (
        <div className="week" aria-label={`Week of ${weekLabel}`}>
          {days.map((d) => {
            const iso = d.toISODate()!;
            const list = items.filter((i) => i.date === iso);
            return (
              <section key={iso} className={`week-day${iso === today ? " today" : ""}${iso < today ? " past" : ""}`}>
                <h3><span>{d.toFormat("ccc")}</span><b>{d.day}</b></h3>
                {list.length === 0 ? <p className="week-empty">—</p> : (
                  <ul>
                    {list.map((i) => (
                      <li key={`${i.kind}-${i.id}`} className={`week-item ${i.kind}${i.done ? " done" : ""}${!i.done && iso < today ? " late" : ""}`}>
                        <Link href={href(i)}>
                          {i.location_color ? <i style={{ background: i.location_color }} aria-hidden="true" /> : null}
                          <span className="week-title">{i.kind === "project" ? "◆ " : ""}{i.title}</span>
                        </Link>
                        <span className="week-sub">{i.kind === "project" ? "Project deadline" : i.assignee_name || "Unassigned"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="cal" role="grid" aria-label={`Calendar for ${month.toFormat("LLLL yyyy")}`}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
          {days.map((d) => {
            const iso = d.toISODate()!;
            const list = items.filter((i) => i.date === iso);
            return (
              <div key={iso} role="gridcell" className={`cal-day${d.month !== month.month ? " other" : ""}${iso === today ? " today" : ""}`}>
                <Link className="cal-num" href={weekLink(d)} title="Open this week">{d.day}</Link>
                {list.slice(0, 4).map((i) => (
                  <Link key={`${i.kind}-${i.id}`} href={href(i)} className={`cal-item ${i.kind}${i.done ? " done" : ""}`}
                    title={`${i.kind === "project" ? "Project deadline" : "Task"}: ${i.title}${i.assignee_name ? ` (${i.assignee_name})` : ""}`}>
                    {i.location_color ? <i style={{ background: i.location_color }} aria-hidden="true" /> : null}
                    {i.kind === "project" ? "◆ " : ""}{i.title}
                  </Link>
                ))}
                {list.length > 4 ? <Link className="cal-more" href={weekLink(d)}>+{list.length - 4} more</Link> : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="hint">◆ marks a project deadline; the other entries are task due dates. The dot shows the project&apos;s location.</p>
    </>
  );
}
