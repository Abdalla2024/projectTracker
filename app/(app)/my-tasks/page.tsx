import Link from "next/link";
import { DateTime } from "luxon";
import { Alerts } from "@/app/components/Alerts";
import { toggleTaskAction } from "@/app/task-actions";
import { DueChip } from "@/app/components/TaskPanel";
import { requireUser } from "@/lib/auth";
import { listMyTasks, type TaskWithProject } from "@/lib/tasks";
import { localDateString, timeZone } from "@/lib/time";

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  const zone = timeZone();
  const today = localDateString(new Date(), zone);
  const weekEnd = DateTime.fromISO(today).plus({ days: 7 }).toISODate()!;
  const tasks = await listMyTasks(user.id);
  const open = tasks.filter((t) => !t.completed_at);
  const buckets: { key: string; label: string; items: TaskWithProject[] }[] = [
    { key: "overdue", label: "Overdue", items: open.filter((t) => t.due_date && t.due_date < today) },
    { key: "today", label: "Today", items: open.filter((t) => t.due_date === today) },
    { key: "week", label: "Next 7 days", items: open.filter((t) => t.due_date && t.due_date > today && t.due_date <= weekEnd) },
    { key: "later", label: "Later", items: open.filter((t) => t.due_date && t.due_date > weekEnd) },
    { key: "none", label: "No due date", items: open.filter((t) => !t.due_date) },
    { key: "done", label: "Completed in the last 7 days", items: tasks.filter((t) => t.completed_at) },
  ].filter((b) => b.items.length);

  return (
    <>
      <div className="page-head"><h1>My tasks</h1><span className="muted">{open.length} open</span></div>
      <Alerts error={error} />
      {buckets.length === 0 ? <div className="empty-card">Nothing assigned to you. Tasks you are given inside projects show up here.</div> : null}
      {buckets.map((b) => (
        <section key={b.key} className={`card bucket ${b.key}`}>
          <h2>{b.label}<span className="count">{b.items.length}</span></h2>
          <ul className="task-list">
            {b.items.map((t) => (
              <li key={t.id} className={`task${t.completed_at ? " done" : ""}`}>
                <div className="task-line">
                  <form action={toggleTaskAction} className="check-form">
                    <input type="hidden" name="task_id" value={t.id} />
                    <input type="hidden" name="done" value={t.completed_at ? "0" : "1"} />
                    <input type="hidden" name="back" value="/my-tasks" />
                    <button type="submit" className={`check${t.completed_at ? " on" : ""}`} aria-label={t.completed_at ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                    </button>
                  </form>
                  <span className="task-title">{t.title}</span>
                  <span className="task-meta">
                    <Link className="chip project-link" href={`/?open=${t.project_id}#tasks-${t.project_id}`}>{t.project_name}</Link>
                    {t.location_name ? <span className="chip">{t.location_name}</span> : null}
                    <DueChip date={t.due_date} done={!!t.completed_at} today={today} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
