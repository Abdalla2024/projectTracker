import Link from "next/link";
import { Alerts } from "@/app/components/Alerts";
import { NewProjectModal } from "@/app/components/NewProjectModal";
import { ProjectDetail } from "@/app/components/ProjectDetail";
import { StatusRing } from "@/app/components/StatusRing";
import { PHASE_MAX, PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { getProjectDetail, isUuid, listPeople, listProjects } from "@/lib/projects";
import { formatDate, formatDateTime, localDateString, timeZone } from "@/lib/time";

const FILTERS = [{ key: "all", label: "All" }, { key: "in_progress", label: "In progress" }, { key: "blocked", label: "Stuck" }, { key: "not_started", label: "Not started" }, { key: "done", label: "Done" }];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; error?: string; new?: string; status?: string; open?: string; saved?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const isAdmin = user.role === "admin";
  const filter = FILTERS.some((f) => f.key === sp.status) ? sp.status! : "all";
  const projects = await listProjects(user.id, showArchived);
  const zone = timeZone();
  const today = localDateString(new Date(), zone);
  const modalOpen = sp.new === "1";

  // The open project is loaded through the same database-checked query as before, so a project the
  // user may not see simply does not open.
  const openId = sp.open && isUuid(sp.open) ? sp.open : null;
  const [openProject, people] = await Promise.all([
    openId ? getProjectDetail(user.id, openId) : Promise.resolve(null),
    isAdmin ? listPeople(user.id) : Promise.resolve([]),
  ]);

  const isOverdue = (p: (typeof projects)[number]) => !["done", "cancelled"].includes(p.status) && !p.archived_at && !!p.deadline && p.deadline < today;
  const countOf = (key: string) => (key === "all" ? projects.length : projects.filter((p) => p.status === key).length);
  const shown = filter === "all" ? projects : projects.filter((p) => p.status === filter);
  const url = (status: string, archived: boolean, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...(status !== "all" ? { status } : {}), ...(archived ? { archived: "1" } : {}), ...extra });
    return q.size ? `/?${q}` : "/";
  };
  const qs = (extra: Record<string, string>) => url(filter, showArchived, extra);
  const tabHref = (key: string) => url(key, showArchived);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
        </div>
        <NewProjectModal
          people={people.map((p) => ({ id: p.id, name: p.name }))}
          isAdmin={isAdmin}
          statuses={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          priorities={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
          phaseMax={PHASE_MAX}
          defaultOpen={modalOpen}
          error={modalOpen ? sp.error : undefined}
        />
      </div>
      {!modalOpen && !openProject ? <Alerts error={sp.error} /> : null}

      <div className="filters">
        <div className="tabs" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <Link key={f.key} href={tabHref(f.key)} aria-current={filter === f.key ? "page" : undefined}>
              {f.label}<span>{countOf(f.key)}</span>
            </Link>
          ))}
        </div>
        <Link className="archive-toggle" href={url(filter, !showArchived)}>
          {showArchived ? "Hide archived" : "Show archived"}
        </Link>
      </div>

      {shown.length === 0 ? (
        <div className="empty-card">{projects.length === 0 ? "No projects yet. Create one to get started." : "No projects with this status."}</div>
      ) : (
        <ul className="projects">
          {shown.map((p) => {
            const open = openProject?.id === p.id;
            const overdue = isOverdue(p);
            return (
              <li key={p.id} id={`p-${p.id}`} className={`project${open ? " is-open" : ""}`}>
                <Link
                  className="project-head"
                  href={open ? qs({}) : qs({ open: p.id })}
                  scroll={false}
                  aria-expanded={open}
                >
                  <StatusRing status={p.status} progress={p.progress} phase={p.phase} />
                  <div className="project-main">
                    <span className="title">{p.name}</span>
                    {p.next_step ? <span className="hint">Next: {p.next_step}</span> : null}
                    <span className="tags">
                      <span className={`chip ${p.status}`}>{STATUS_LABELS[p.status]}</span>
                      <span className={`chip ${p.priority}`}>{PRIORITY_LABELS[p.priority]} priority</span>
                      {p.archived_at ? <span className="chip">archived</span> : null}
                      {p.deadline ? <span className={`chip ${overdue ? "bad" : ""}`}>{overdue ? "Overdue · " : "Due "}{formatDate(p.deadline)}</span> : null}
                    </span>
                  </div>
                  <span className="project-side">
                    <span className="hint">Updated {formatDateTime(p.updated_at, zone)}</span>
                    <svg className="chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </span>
                </Link>
                {open && openProject ? (
                  <ProjectDetail project={openProject} user={user} people={people} zone={zone} error={sp.error} saved={sp.saved} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="hint foot">Times shown in {zone}.</p>
    </>
  );
}
