import Link from "next/link";
import { Alerts } from "@/app/components/Alerts";
import { AutoSubmit } from "@/app/components/AutoSubmit";
import { NewProjectModal } from "@/app/components/NewProjectModal";
import { ProjectBoard, type BoardCard } from "@/app/components/ProjectBoard";
import { ProjectDetail } from "@/app/components/ProjectDetail";
import { StatusRing } from "@/app/components/StatusRing";
import { PHASE_MAX, PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { listOrg } from "@/lib/org";
import { getProjectDetail, isUuid, listPeople, listProjects, type ProjectListItem } from "@/lib/projects";
import { getProjectTasks } from "@/lib/tasks";
import { formatDate, formatDateTime, localDateString, timeZone } from "@/lib/time";

const FILTERS = [{ key: "all", label: "All" }, { key: "in_progress", label: "In progress" }, { key: "blocked", label: "Stuck" }, { key: "not_started", label: "Not started" }, { key: "done", label: "Done" }];
const GROUPS = [{ key: "location", label: "Location" }, { key: "team", label: "Team" }, { key: "status", label: "Status" }, { key: "none", label: "No grouping" }];

type SP = { archived?: string; error?: string; new?: string; status?: string; open?: string; saved?: string; view?: string; group?: string; location?: string; team?: string; q?: string; t?: string };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const view = sp.view === "board" ? "board" : "list";
  const group = GROUPS.some((g) => g.key === sp.group) ? sp.group! : "location";
  const filter = FILTERS.some((f) => f.key === sp.status) ? sp.status! : "all";
  const location = sp.location && isUuid(sp.location) ? sp.location : null;
  const team = sp.team && isUuid(sp.team) ? sp.team : null;
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 100);
  const zone = timeZone();
  const today = localDateString(new Date(), zone);
  const modalOpen = sp.new === "1";
  const openId = sp.open && isUuid(sp.open) ? sp.open : null;

  const [projects, people, locations, teams, openProject, openTasks] = await Promise.all([
    listProjects(user.id, showArchived),
    listPeople(user.id),
    listOrg(user.id, "locations"),
    listOrg(user.id, "teams"),
    openId ? getProjectDetail(user.id, openId) : Promise.resolve(null),
    openId ? getProjectTasks(user.id, openId) : Promise.resolve(null),
  ]);
  const activeLocations = locations.filter((l) => !l.archived_at);
  const activeTeams = teams.filter((t) => !t.archived_at);

  // Everything except the status tab narrows the list; the tab counts are computed after it.
  const scoped = projects.filter((p) =>
    (!location || p.location_id === location) && (!team || p.team_id === team) &&
    (!q || p.name.toLowerCase().includes(q) || p.phase.toLowerCase().includes(q) || p.next_step.toLowerCase().includes(q)));
  const countOf = (key: string) => (key === "all" ? scoped.length : scoped.filter((p) => p.status === key).length);
  const shown = filter === "all" || view === "board" ? scoped : scoped.filter((p) => p.status === filter);
  const isOverdue = (p: ProjectListItem) => !["done", "cancelled"].includes(p.status) && !p.archived_at && !!p.deadline && p.deadline < today;

  const base: Record<string, string> = {
    ...(view !== "list" ? { view } : {}), ...(group !== "location" ? { group } : {}), ...(filter !== "all" ? { status: filter } : {}),
    ...(location ? { location } : {}), ...(team ? { team } : {}), ...(q ? { q } : {}), ...(showArchived ? { archived: "1" } : {}),
  };
  const url = (change: Record<string, string | null>) => {
    const next = { ...base };
    for (const [k, v] of Object.entries(change)) { if (v === null) delete next[k]; else next[k] = v; }
    const s = new URLSearchParams(next).toString();
    return s ? `/?${s}` : "/";
  };

  const heading = location ? activeLocations.concat(locations).find((l) => l.id === location)?.name ?? "Projects"
    : team ? teams.find((t) => t.id === team)?.name ?? "Projects" : "Projects";

  // Grouping for the list view.
  type Group = { key: string; label: string; color: string | null; items: ProjectListItem[] };
  let groups: Group[];
  if (group === "location" && !location) {
    groups = [...activeLocations.map((l) => ({ key: l.id, label: l.name, color: l.color, items: shown.filter((p) => p.location_id === l.id) })),
      { key: "none", label: "No location", color: null, items: shown.filter((p) => !p.location_id || !activeLocations.some((l) => l.id === p.location_id)) }];
  } else if (group === "team" && !team) {
    groups = [...activeTeams.map((t) => ({ key: t.id, label: t.name, color: t.color, items: shown.filter((p) => p.team_id === t.id) })),
      { key: "none", label: "No team", color: null, items: shown.filter((p) => !p.team_id || !activeTeams.some((t) => t.id === p.team_id)) }];
  } else if (group === "status") {
    groups = STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s], color: null, items: shown.filter((p) => p.status === s) }));
  } else {
    groups = [{ key: "all", label: "", color: null, items: shown }];
  }
  groups = groups.filter((g) => g.items.length);

  const card = (p: ProjectListItem) => {
    const open = openProject?.id === p.id;
    const overdue = isOverdue(p);
    return (
      <li key={p.id} id={`p-${p.id}`} className={`project${open ? " is-open" : ""}`}>
        <Link className="project-head" href={open ? url({ open: null }) : url({ open: p.id })} scroll={false} aria-expanded={open}>
          <StatusRing status={p.status} progress={p.progress} />
          <div className="project-main">
            <span className="title">{p.name}</span>
            {p.phase ? <span className="phase">Working on: <b>{p.phase}</b></span> : null}
            <span className="tags">
              {p.location_name ? <span className="chip org"><i style={{ background: p.location_color ?? undefined }} />{p.location_name}</span> : null}
              {p.team_name ? <span className="chip org"><i style={{ background: p.team_color ?? undefined }} />{p.team_name}</span> : null}
              <span className={`chip ${p.priority}`}>{PRIORITY_LABELS[p.priority]} priority</span>
              {p.archived_at ? <span className="chip">archived</span> : null}
              {p.deadline ? <span className={`chip ${overdue ? "bad" : ""}`}>{overdue ? "Overdue · " : "Due "}{formatDate(p.deadline)}</span> : null}
              {p.tasks_total ? <span className="chip">{p.tasks_done}/{p.tasks_total} tasks</span> : null}
            </span>
          </div>
          <span className="project-side">
            <span className="hint">Updated {formatDateTime(p.updated_at, zone)}</span>
            <svg className="chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </span>
        </Link>
        {open && openProject && openTasks ? (
          <ProjectDetail project={openProject} tasks={openTasks} user={user} people={people} locations={activeLocations} teams={activeTeams}
            zone={zone} today={today} error={sp.error} saved={sp.saved} />
        ) : null}
      </li>
    );
  };

  const cards: BoardCard[] = shown.filter((p) => p.status !== "cancelled").map((p) => ({
    id: p.id, name: p.name, status: p.status, priority: p.priority, phase: p.phase, progress: p.progress,
    location: p.location_name ? { name: p.location_name, color: p.location_color ?? "#999999" } : null,
    team: p.team_name ? { name: p.team_name, color: p.team_color ?? "#999999" } : null,
    due: p.deadline ? formatDate(p.deadline) : null, overdue: isOverdue(p), tasks: p.tasks_total ? `${p.tasks_done}/${p.tasks_total} tasks` : null,
  }));

  return (
    <>
      <div className="page-head">
        <h1>{heading}</h1>
        <NewProjectModal
          people={people.map((p) => ({ id: p.id, name: p.name }))}
          locations={activeLocations.map(({ id, name }) => ({ id, name }))}
          teams={activeTeams.map(({ id, name }) => ({ id, name }))}
          defaultLocation={location} defaultTeam={team}
          statuses={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          priorities={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
          phaseMax={PHASE_MAX}
          defaultOpen={modalOpen}
          error={modalOpen ? sp.error : undefined}
        />
      </div>
      {!modalOpen && !openProject ? <Alerts error={sp.error} /> : null}

      <AutoSubmit className="toolbar">
        <div className="seg" role="group" aria-label="View">
          <Link href={url({ view: null })} aria-current={view === "list" ? "page" : undefined}>List</Link>
          <Link href={url({ view: "board" })} aria-current={view === "board" ? "page" : undefined}>Board</Link>
        </div>
        {Object.entries(base).filter(([k]) => !["group", "location", "team", "q"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Search projects" aria-label="Search projects" />
        {view === "list" ? (
          <label className="inline">Group by
            <select name="group" defaultValue={group}>{GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</select>
          </label>
        ) : null}
        <select name="location" defaultValue={location ?? ""} aria-label="Location">
          <option value="">All locations</option>
          {activeLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select name="team" defaultValue={team ?? ""} aria-label="Team">
          <option value="">All teams</option>
          {activeTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <Link className="archive-toggle" href={url({ archived: showArchived ? null : "1" })}>{showArchived ? "Hide archived" : "Show archived"}</Link>
      </AutoSubmit>

      {view === "list" ? (
        <div className="tabs" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <Link key={f.key} href={url({ status: f.key === "all" ? null : f.key })} aria-current={filter === f.key ? "page" : undefined}>
              {f.label}<span>{countOf(f.key)}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="empty-card">{projects.length === 0 ? "No projects yet. Create one to get started." : "No projects match these filters."}</div>
      ) : view === "board" ? (
        <ProjectBoard columns={STATUSES.filter((s) => s !== "cancelled").map((s) => ({ key: s, label: STATUS_LABELS[s] }))} cards={cards} />
      ) : (
        groups.map((g) => (
          <section key={g.key} className="group">
            {g.label ? <h2 className="group-head">{g.color ? <i style={{ background: g.color }} aria-hidden="true" /> : null}{g.label}<span>{g.items.length}</span></h2> : null}
            <ul className="projects">{g.items.map(card)}</ul>
          </section>
        ))
      )}
      <p className="hint foot">Times shown in {zone}.</p>
    </>
  );
}
