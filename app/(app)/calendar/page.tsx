import Link from "next/link";
import { DateTime } from "luxon";
import { AutoSubmit } from "@/app/components/AutoSubmit";
import { requireUser } from "@/lib/auth";
import { listOrg } from "@/lib/org";
import { isUuid } from "@/lib/projects";
import { listCalendar } from "@/lib/tasks";
import { localDateString, timeZone } from "@/lib/time";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; location?: string; team?: string; mine?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const zone = timeZone();
  const today = localDateString(new Date(), zone);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? DateTime.fromISO(`${sp.month}-01`) : DateTime.fromISO(today).startOf("month");
  const location = sp.location && isUuid(sp.location) ? sp.location : null;
  const team = sp.team && isUuid(sp.team) ? sp.team : null;
  const mine = sp.mine === "1";
  // Weeks start on Monday; show whole weeks around the month.
  const gridStart = month.startOf("month").minus({ days: month.startOf("month").weekday - 1 });
  const gridEnd = month.endOf("month").plus({ days: 7 - month.endOf("month").weekday });
  const [items, locations, teams] = await Promise.all([
    listCalendar(user.id, gridStart.toISODate()!, gridEnd.toISODate()!, { location, team, mine }),
    listOrg(user.id, "locations"), listOrg(user.id, "teams"),
  ]);
  const days: DateTime[] = [];
  for (let d = gridStart; d <= gridEnd; d = d.plus({ days: 1 })) days.push(d);
  const keep = (m: DateTime) => {
    const q = new URLSearchParams({ month: m.toFormat("yyyy-MM"), ...(location ? { location } : {}), ...(team ? { team } : {}), ...(mine ? { mine: "1" } : {}) });
    return `/calendar?${q}`;
  };

  return (
    <>
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="seg">
          <Link href={keep(month.minus({ months: 1 }))} aria-label="Previous month">←</Link>
          <Link href={keep(DateTime.fromISO(today).startOf("month"))} aria-current="page" title="Back to this month">{month.toFormat("LLL yyyy")}</Link>
          <Link href={keep(month.plus({ months: 1 }))} aria-label="Next month">→</Link>
        </div>
      </div>
      <AutoSubmit className="toolbar" action="/calendar">
        <input type="hidden" name="month" value={month.toFormat("yyyy-MM")} />
        <select name="location" defaultValue={location ?? ""} aria-label="Location">
          <option value="">All locations</option>
          {locations.filter((l) => !l.archived_at).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select name="team" defaultValue={team ?? ""} aria-label="Team">
          <option value="">All teams</option>
          {teams.filter((t) => !t.archived_at).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="inline check-label"><input type="checkbox" name="mine" value="1" defaultChecked={mine} /> Only mine</label>
      </AutoSubmit>
      <div className="cal" role="grid" aria-label={`Calendar for ${month.toFormat("LLLL yyyy")}`}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
        {days.map((d) => {
          const iso = d.toISODate()!;
          const list = items.filter((i) => i.date === iso);
          return (
            <div key={iso} role="gridcell" className={`cal-day${d.month !== month.month ? " other" : ""}${iso === today ? " today" : ""}`}>
              <span className="cal-num">{d.day}</span>
              {list.slice(0, 4).map((i) => (
                <Link key={`${i.kind}-${i.id}`} href={`/?open=${i.project_id}#${i.kind === "task" ? "tasks-" : "p-"}${i.project_id}`}
                  className={`cal-item ${i.kind}${i.done ? " done" : ""}`} title={`${i.kind === "project" ? "Project deadline" : "Task"}: ${i.title}${i.assignee_name ? ` (${i.assignee_name})` : ""}`}>
                  {i.location_color ? <i style={{ background: i.location_color }} aria-hidden="true" /> : null}
                  {i.kind === "project" ? "◆ " : ""}{i.title}
                </Link>
              ))}
              {list.length > 4 ? <span className="cal-more">+{list.length - 4} more</span> : null}
            </div>
          );
        })}
      </div>
      <p className="hint">◆ marks a project deadline; other entries are task due dates. The dot shows the project&apos;s location.</p>
    </>
  );
}
