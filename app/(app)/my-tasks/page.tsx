import Link from "next/link";
import { Alerts } from "@/app/components/Alerts";
import { StatusRing } from "@/app/components/StatusRing";
import { DueChip, TaskCheck } from "@/app/components/TaskCheck";
import { PRIORITY_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { listMyProjects } from "@/lib/tasks";
import { localDateString, timeZone } from "@/lib/time";

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  const today = localDateString(new Date(), timeZone());
  const projects = await listMyProjects(user.id, today);
  const open = projects.reduce((n, p) => n + p.tasks.filter((t) => !t.completed_at).length, 0);

  return (
    <>
      <div className="page-head"><h1>My tasks</h1><span className="muted">{open} open in {projects.length} {projects.length === 1 ? "project" : "projects"}</span></div>
      <Alerts error={error} />
      {projects.length === 0 ? <div className="empty-card">Nothing assigned to you. Tasks you are given inside projects show up here, under their project.</div> : null}
      <ul className="projects my-projects">
        {projects.map((p) => {
          const mine = p.tasks.filter((t) => !t.completed_at);
          const late = mine.filter((t) => t.due_date && t.due_date < today).length;
          return (
            <li key={p.id} className="project">
              <Link className="project-head" href={`/?open=${p.id}#p-${p.id}`}>
                <StatusRing status={p.status} progress={p.progress} size={84} />
                <div className="project-main">
                  <span className="title">{p.name}</span>
                  {p.phase ? <span className="phase">Working on: <b>{p.phase}</b></span> : null}
                  <span className="tags">
                    {p.location_name ? <span className="chip org"><i style={{ background: p.location_color ?? undefined }} />{p.location_name}</span> : null}
                    {p.team_name ? <span className="chip org"><i style={{ background: p.team_color ?? undefined }} />{p.team_name}</span> : null}
                    {p.priority === "high" || p.priority === "critical" ? <span className={`chip ${p.priority}`}>{PRIORITY_LABELS[p.priority]}</span> : null}
                    <span className="chip">{p.tasks_done}/{p.tasks_total} tasks done</span>
                    {late ? <span className="chip bad">{late} overdue</span> : null}
                  </span>
                </div>
                <span className="project-side"><span className="hint">{mine.length} for you</span></span>
              </Link>
              <ul className="tlist my-list">
                {p.tasks.map((t) => (
                  <li key={t.id} className={`trow${t.completed_at ? " done" : ""}`}>
                    <div className="tline">
                      <TaskCheck id={t.id} title={t.title} done={!!t.completed_at} />
                      <span className="ttitle static">{t.title}</span>
                      <span className="tmeta"><DueChip date={t.due_date} done={!!t.completed_at} today={today} /></span>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </>
  );
}
