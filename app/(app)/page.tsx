import Link from "next/link";
import { Alerts } from "@/app/components/Alerts";
import { NewProjectModal } from "@/app/components/NewProjectModal";
import { StatusRing } from "@/app/components/StatusRing";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { listPeople, listProjects } from "@/lib/projects";
import { formatDate, formatDateTime, localDateString, timeZone } from "@/lib/time";

const BAR: Record<string, string> = { done: "#22c55e", in_progress: "#f59e0b", blocked: "#ef4444", not_started: "#a1a1aa", cancelled: "#d4d4d8" };
const FILTERS = [{ key: "all", label: "All" }, { key: "in_progress", label: "In progress" }, { key: "blocked", label: "Blocked" }, { key: "not_started", label: "Not started" }, { key: "done", label: "Done" }];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; error?: string; new?: string; status?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const isAdmin = user.role === "admin";
  const filter = FILTERS.some((f) => f.key === sp.status) ? sp.status! : "all";
  const projects = await listProjects(user.id, showArchived);
  const people = isAdmin ? await listPeople(user.id) : [];
  const zone = timeZone();
  const today = localDateString(new Date(), zone);
  const modalOpen = sp.new === "1";

  const live = projects.filter((p) => !p.archived_at);
  const count = (s: string) => live.filter((p) => p.status === s).length;
  const isOverdue = (p: (typeof projects)[number]) => !["done", "cancelled"].includes(p.status) && !p.archived_at && !!p.deadline && p.deadline < today;
  const attention = live.filter((p) => p.status === "blocked" || isOverdue(p)).slice(0, 5);
  const shown = filter === "all" ? projects : projects.filter((p) => p.status === filter);
  const total = live.length;
  const href = (status: string) => `/?${new URLSearchParams({ ...(status !== "all" ? { status } : {}), ...(showArchived ? { archived: "1" } : {}) })}`.replace(/\?$/, "");
  const first = user.displayName.split(" ")[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">Welcome back, {first}. {isAdmin ? "You can see every project." : "Projects you created, plus projects an admin assigned to you."}</p>
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

      <div className="overview">
        <section className="tile tile-sky health">
          <h2>Project health</h2>
          <div className="big">{total}<span> active project{total === 1 ? "" : "s"}</span></div>
          {total > 0 ? (
            <>
              <div className="stack-bar" role="img" aria-label="Projects by status">
                {STATUSES.filter((s) => count(s) > 0).map((s) => <i key={s} style={{ flex: count(s), background: BAR[s] }} />)}
              </div>
              <ul className="legend">
                {STATUSES.filter((s) => count(s) > 0).map((s) => <li key={s}><i style={{ background: BAR[s] }} />{STATUS_LABELS[s]} {count(s)}</li>)}
              </ul>
            </>
          ) : <p className="hint">Create a project to see its health here.</p>}
        </section>
        {([["in_progress", "tile-lilac"], ["blocked", "tile-rose"], ["done", "tile-mint"]] as const).map(([s, tone]) => (
          <Link key={s} href={href(s)} className={`tile ${tone} stat-tile`}>
            <h2>{STATUS_LABELS[s]}</h2>
            <div className="big">{count(s)}</div>
            <StatusRing status={s} size={44} compact />
          </Link>
        ))}
      </div>

      <div className="split">
        <section className="card list-card">
          <div className="list-head">
            <h2>Projects</h2>
            <div className="tabs" role="tablist" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <Link key={f.key} href={href(f.key)} aria-current={filter === f.key ? "page" : undefined}>{f.label}</Link>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="empty">{projects.length === 0 ? "No projects yet. Create one to get started." : "No projects with this status."}</p>
          ) : (
            <ul className="rows">
              {shown.map((p) => {
                const overdue = isOverdue(p);
                return (
                  <li className="row-item" key={p.id}>
                    <StatusRing status={p.status} size={64} />
                    <div className="row-main">
                      <Link className="title" href={`/projects/${p.id}`}>{p.name}</Link>
                      {p.next_step ? <div className="hint">Next: {p.next_step}</div> : null}
                    </div>
                    <div className="row-meta">
                      <span className={`chip ${p.priority}`}>{PRIORITY_LABELS[p.priority]}</span>
                      {p.archived_at ? <span className="chip">archived</span> : null}
                      {p.deadline ? <span className={`chip ${overdue ? "bad" : ""}`}>{overdue ? "Overdue · " : "Due "}{formatDate(p.deadline)}</span> : null}
                    </div>
                    <div className="row-time hint">Updated<br />{formatDateTime(p.updated_at, zone)}</div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="hint foot">
            {showArchived ? <Link href={href(filter).replace(/[?&]archived=1/, "") || "/"}>Hide archived</Link> : <Link href={`${href(filter)}${href(filter).includes("?") ? "&" : "?"}archived=1`}>Show archived</Link>}
            {" · "}Times shown in {zone}.
          </p>
        </section>

        <aside className="dark-card">
          <h2>Needs attention</h2>
          {attention.length === 0 ? (
            <p className="dim">Nothing is blocked or overdue. All clear.</p>
          ) : (
            <ul>
              {attention.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`}>{p.name}</Link>
                  <span className={`chip ${p.status === "blocked" ? "bad" : "warn"}`}>{p.status === "blocked" ? "Blocked" : "Overdue"}</span>
                </li>
              ))}
            </ul>
          )}
          <Link className="btn light" href="/summary">Weekly summary</Link>
        </aside>
      </div>
    </>
  );
}
