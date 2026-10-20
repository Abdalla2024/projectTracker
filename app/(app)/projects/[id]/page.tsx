import Link from "next/link";
import { notFound } from "next/navigation";
import { archiveAction, assignAction, commentAction, updateProjectAction } from "@/app/actions";
import { Alerts } from "@/app/components/Alerts";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { describeEvent } from "@/lib/format";
import { getProjectDetail, listPeople, listStores } from "@/lib/projects";
import { formatDate, formatDateTime, timeZone } from "@/lib/time";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const project = await getProjectDetail(user.id, id);
  // Not found and not-allowed look identical on purpose: the database simply returns no row.
  if (!project) notFound();

  const isAdmin = user.role === "admin";
  const isCreator = project.created_by === user.id;
  const fullEdit = isAdmin || isCreator;
  const zone = timeZone();
  const [people, stores] = isAdmin ? await Promise.all([listPeople(user.id), listStores(user.id)]) : [[], []];
  const assigned = new Set(project.assignees.map((a) => a.id));
  const inStores = new Set(project.stores.map((s) => s.id));

  return (
    <>
      <p style={{ marginTop: 16 }}><Link href="/">← All projects</Link></p>
      <div className="row">
        <div>
          <h1>{project.name}</h1>
          <p>
            <span className={`chip ${project.status}`}>{STATUS_LABELS[project.status]}</span>{" "}
            <span className={`chip ${project.priority}`}>{PRIORITY_LABELS[project.priority]} priority</span>
            {project.archived_at ? <> <span className="chip">archived</span></> : null}
          </p>
        </div>
        {fullEdit ? (
          <form action={archiveAction}>
            <input type="hidden" name="id" value={project.id} />
            <input type="hidden" name="archive" value={project.archived_at ? "0" : "1"} />
            <button className="secondary" type="submit">{project.archived_at ? "Restore from archive" : "Archive"}</button>
          </form>
        ) : null}
      </div>
      <Alerts error={sp.error} saved={sp.saved} />

      <section className="card">
        <h2>Details</h2>
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px" }}>
          <dt className="muted">Created by</dt><dd style={{ margin: 0 }}>{project.creator_name}, {formatDateTime(project.created_at, zone)}</dd>
          <dt className="muted">Assigned to</dt>
          <dd style={{ margin: 0 }}>{project.assignees.length ? project.assignees.map((a) => a.name).join(", ") : "Unassigned"}</dd>
          <dt className="muted">Stores</dt>
          <dd style={{ margin: 0 }}>{project.stores.length ? project.stores.map((s) => s.name).join(", ") : "None selected"}</dd>
          <dt className="muted">Deadline</dt><dd style={{ margin: 0 }}>{project.deadline ? formatDate(project.deadline) : "None"}</dd>
          <dt className="muted">Next step</dt><dd style={{ margin: 0 }}>{project.next_step || "—"}</dd>
          <dt className="muted">Last updated</dt><dd style={{ margin: 0 }}>{formatDateTime(project.updated_at, zone)}</dd>
        </dl>
        {project.description ? <p style={{ whiteSpace: "pre-wrap" }}>{project.description}</p> : null}
      </section>

      {fullEdit ? (
        <form action={updateProjectAction} className="card">
          <h2>Edit project</h2>
          <input type="hidden" name="id" value={project.id} />
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" required maxLength={200} defaultValue={project.name} />
          <label htmlFor="description">Description</label>
          <textarea id="description" name="description" maxLength={5000} defaultValue={project.description} />
          <div className="grid2">
            <div>
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={project.status}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="priority">Priority</label>
              <select id="priority" name="priority" defaultValue={project.priority}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="deadline">Deadline</label>
              <input id="deadline" name="deadline" type="date" defaultValue={project.deadline ?? ""} />
            </div>
            <div>
              <label htmlFor="next_step">Next step</label>
              <input id="next_step" name="next_step" type="text" maxLength={500} defaultValue={project.next_step} />
            </div>
          </div>
          <p><button type="submit">Save changes</button></p>
        </form>
      ) : (
        <form action={updateProjectAction} className="card">
          <h2>Update progress</h2>
          <p className="hint">You&apos;re assigned to this project. You can update its status and next step, and comment.</p>
          <input type="hidden" name="id" value={project.id} />
          <div className="grid2">
            <div>
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={project.status}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="next_step">Next step</label>
              <input id="next_step" name="next_step" type="text" maxLength={500} defaultValue={project.next_step} />
            </div>
          </div>
          <p><button type="submit">Save</button></p>
        </form>
      )}

      {isAdmin ? (
        <form action={assignAction} className="card">
          <h2>Assignees and stores</h2>
          <input type="hidden" name="id" value={project.id} />
          <label>Assigned to (one or more)</label>
          <div className="checks">
            {people.map((p) => (
              <label key={p.id}><input type="checkbox" name="assignees" value={p.id} defaultChecked={assigned.has(p.id)} /> {p.name}</label>
            ))}
          </div>
          <label>Stores</label>
          <div className="checks">
            {stores.map((s) => (
              <label key={s.id}><input type="checkbox" name="stores" value={s.id} defaultChecked={inStores.has(s.id)} /> {s.name}</label>
            ))}
          </div>
          <p><button type="submit">Save assignment</button></p>
          <p className="hint">Only people who have signed in at least once appear here.</p>
        </form>
      ) : null}

      <section className="card" id="comments">
        <h2>Comments and feedback</h2>
        {project.comments.length === 0 ? <p className="muted">No comments yet.</p> : (
          <ul className="plain">
            {project.comments.map((c) => (
              <li key={c.id}>
                <b>{c.author_name}</b> <span className="muted">· {formatDateTime(c.created_at, zone)}</span>
                <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
              </li>
            ))}
          </ul>
        )}
        <form action={commentAction}>
          <input type="hidden" name="id" value={project.id} />
          <label htmlFor="body">Add a comment</label>
          <textarea id="body" name="body" required maxLength={4000} />
          <p><button type="submit">Post comment</button> <span className="hint">Comments can&apos;t be edited or deleted. No customer or financial details.</span></p>
        </form>
      </section>

      <section className="card">
        <h2>History</h2>
        <ul className="plain">
          {project.events.map((e) => (
            <li key={String(e.id)}>
              <span className="muted">{formatDateTime(e.occurred_at, zone)}</span> · <b>{e.actor_name}</b> {describeEvent(e)}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
