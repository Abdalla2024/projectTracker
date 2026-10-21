import Link from "next/link";
import { Alerts } from "@/app/components/Alerts";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { formatDate, formatDateTime, localDateString, timeZone } from "@/lib/time";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ archived?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const projects = await listProjects(user.id, showArchived);
  const zone = timeZone();
  const today = localDateString(new Date(), zone);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{user.role === "admin" ? "All projects" : "My projects"}</h1>
          <p className="muted">
            {user.role === "admin"
              ? "As an admin you can see every project."
              : "Projects you created, plus projects an admin assigned to you."}
          </p>
        </div>
        <Link className="btn" href="/projects/new">New project</Link>
      </div>
      <Alerts error={sp.error} />
      <div className="card table-card table-scroll">
        {projects.length === 0 ? (
          <p className="empty">No projects yet. Create one to get started.</p>
        ) : (
          <table className="stack">
            <thead>
              <tr><th>Project</th><th>Status</th><th>Priority</th><th>Deadline</th><th>Assigned to</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const open = !["done", "cancelled"].includes(p.status) && !p.archived_at;
                const overdue = open && p.deadline && p.deadline < today;
                return (
                  <tr key={p.id}>
                    <td>
                      <Link className="title" href={`/projects/${p.id}`}>{p.name}</Link>
                      {p.archived_at ? <> <span className="chip">archived</span></> : null}
                      {p.next_step ? <div className="hint">Next: {p.next_step}</div> : null}
                    </td>
                    <td data-label="Status"><span className={`chip ${p.status}`}>{STATUS_LABELS[p.status]}</span></td>
                    <td data-label="Priority"><span className={`chip ${p.priority}`}>{PRIORITY_LABELS[p.priority]}</span></td>
                    <td data-label="Deadline">{p.deadline ? formatDate(p.deadline) : "—"}{overdue ? <> <span className="chip bad">overdue</span></> : null}</td>
                    <td data-label="Assigned to">{p.assignees.length ? p.assignees.join(", ") : <span className="muted">unassigned</span>}</td>
                    <td className="muted" data-label="Updated">{formatDateTime(p.updated_at, zone)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="hint">
        {showArchived ? <Link href="/">Hide archived</Link> : <Link href="/?archived=1">Show archived</Link>}
        {" · "}Times shown in {zone}.
      </p>
    </>
  );
}
