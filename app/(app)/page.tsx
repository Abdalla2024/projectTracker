import Link from "next/link";
import { Alerts } from "@/app/components/Alerts";
import { NewProjectModal } from "@/app/components/NewProjectModal";
import { StatusRing } from "@/app/components/StatusRing";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { listPeople, listProjects } from "@/lib/projects";
import { formatDate, formatDateTime, localDateString, timeZone } from "@/lib/time";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; error?: string; new?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const isAdmin = user.role === "admin";
  const projects = await listProjects(user.id, showArchived);
  const people = isAdmin ? await listPeople(user.id) : [];
  const zone = timeZone();
  const today = localDateString(new Date(), zone);
  const modalOpen = sp.new === "1";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isAdmin ? "All projects" : "My projects"}</h1>
          <p className="muted">
            {isAdmin ? "As an admin you can see every project." : "Projects you created, plus projects an admin assigned to you."}
          </p>
        </div>
        <NewProjectModal
          people={people.map((p) => ({ id: p.id, name: p.name }))}
          isAdmin={isAdmin}
          statuses={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          priorities={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
          defaultOpen={modalOpen}
          error={modalOpen ? sp.error : undefined}
        />
      </div>
      {!modalOpen ? <Alerts error={sp.error} /> : null}

      {projects.length === 0 ? (
        <div className="card empty">No projects yet. Create one to get started.</div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => {
            const open = !["done", "cancelled"].includes(p.status) && !p.archived_at;
            const overdue = open && p.deadline && p.deadline < today;
            return (
              <article className="card project-card" key={p.id}>
                <StatusRing status={p.status} />
                <div className="project-body">
                  <Link className="title" href={`/projects/${p.id}`}>{p.name}</Link>
                  {p.next_step ? <div className="hint">Next: {p.next_step}</div> : null}
                  <div className="tags">
                    <span className={`chip ${p.priority}`}>{PRIORITY_LABELS[p.priority]}</span>
                    {p.archived_at ? <span className="chip">archived</span> : null}
                    {p.deadline ? <span className={`chip ${overdue ? "bad" : ""}`}>{overdue ? "Overdue · " : "Due "}{formatDate(p.deadline)}</span> : null}
                  </div>
                  <div className="hint">Updated {formatDateTime(p.updated_at, zone)}</div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="hint">
        {showArchived ? <Link href="/">Hide archived</Link> : <Link href="/?archived=1">Show archived</Link>}
        {" · "}Times shown in {zone}.
      </p>
    </>
  );
}
