import { archiveAction, assignAction, commentAction, updateProjectAction } from "@/app/actions";
import { Alerts } from "@/app/components/Alerts";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";
import { describeEvent } from "@/lib/format";
import type { getProjectDetail, listPeople } from "@/lib/projects";
import { formatDate, formatDateTime } from "@/lib/time";

type Project = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
type People = Awaited<ReturnType<typeof listPeople>>;

/** The expanded part of a project card: details, editing, assignees (admins), comments and history. */
export function ProjectDetail({
  project, user, people, zone, error, saved,
}: { project: Project; user: SessionUser; people: People; zone: string; error?: string; saved?: string }) {
  const isAdmin = user.role === "admin";
  const fullEdit = isAdmin || project.created_by === user.id;
  const assigned = new Set(project.assignees.map((a) => a.id));
  const id = project.id;

  return (
    <div className="detail" id={`d-${id}`}>
      <Alerts error={error} saved={saved} />
      <div className="detail-cols">
        <div>
          <section className="sub">
            <h3>Details</h3>
            <dl className="details">
              <dt>Created by</dt><dd>{project.creator_name}, {formatDateTime(project.created_at, zone)}</dd>
              {project.assignees.length ? <><dt>Assigned to</dt><dd>{project.assignees.map((a) => a.name).join(", ")}</dd></> : null}
              <dt>Deadline</dt><dd>{project.deadline ? formatDate(project.deadline) : "None"}</dd>
              <dt>Next step</dt><dd>{project.next_step || "—"}</dd>
              <dt>Last updated</dt><dd>{formatDateTime(project.updated_at, zone)}</dd>
            </dl>
            {project.description ? <p className="desc">{project.description}</p> : null}
          </section>

          {fullEdit ? (
            <form action={updateProjectAction} className="sub">
              <h3>Edit project</h3>
              <input type="hidden" name="id" value={id} />
              <label htmlFor={`name-${id}`}>Name</label>
              <input id={`name-${id}`} name="name" type="text" required maxLength={200} defaultValue={project.name} />
              <label htmlFor={`desc-${id}`}>Description</label>
              <textarea id={`desc-${id}`} name="description" maxLength={5000} defaultValue={project.description} />
              <div className="grid2">
                <div>
                  <label htmlFor={`status-${id}`}>Status</label>
                  <select id={`status-${id}`} name="status" defaultValue={project.status}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`priority-${id}`}>Priority</label>
                  <select id={`priority-${id}`} name="priority" defaultValue={project.priority}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`deadline-${id}`}>Deadline</label>
                  <input id={`deadline-${id}`} name="deadline" type="date" defaultValue={project.deadline ?? ""} />
                </div>
                <div>
                  <label htmlFor={`next-${id}`}>Next step</label>
                  <input id={`next-${id}`} name="next_step" type="text" maxLength={500} defaultValue={project.next_step} />
                </div>
              </div>
              <p><button type="submit">Save changes</button></p>
            </form>
          ) : (
            <form action={updateProjectAction} className="sub">
              <h3>Update progress</h3>
              <p className="hint">You&apos;re assigned to this project. You can update its status and next step, and comment.</p>
              <input type="hidden" name="id" value={id} />
              <div className="grid2">
                <div>
                  <label htmlFor={`status-${id}`}>Status</label>
                  <select id={`status-${id}`} name="status" defaultValue={project.status}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`next-${id}`}>Next step</label>
                  <input id={`next-${id}`} name="next_step" type="text" maxLength={500} defaultValue={project.next_step} />
                </div>
              </div>
              <p><button type="submit">Save</button></p>
            </form>
          )}

          {isAdmin ? (
            <form action={assignAction} className="sub">
              <h3>Assignees</h3>
              <input type="hidden" name="id" value={id} />
              <div className="checks">
                {people.map((p) => (
                  <label key={p.id}><input type="checkbox" name="assignees" value={p.id} defaultChecked={assigned.has(p.id)} /> {p.name}</label>
                ))}
              </div>
              <p><button type="submit">Save assignees</button></p>
              <p className="hint">Only people who have signed in at least once appear here.</p>
            </form>
          ) : null}
        </div>

        <div>
          <section className="sub" id={`c-${id}`}>
            <h3>Comments and feedback</h3>
            {project.comments.length === 0 ? <p className="muted">No comments yet.</p> : (
              <ul className="plain">
                {project.comments.map((c) => (
                  <li key={c.id}>
                    <b>{c.author_name}</b> <span className="muted">· {formatDateTime(c.created_at, zone)}</span>
                    <div className="desc">{c.body}</div>
                  </li>
                ))}
              </ul>
            )}
            <form action={commentAction}>
              <input type="hidden" name="id" value={id} />
              <label htmlFor={`body-${id}`}>Add a comment</label>
              <textarea id={`body-${id}`} name="body" required maxLength={4000} />
              <p><button type="submit">Post comment</button> <span className="hint">Comments can&apos;t be edited or deleted. No customer or financial details.</span></p>
            </form>
          </section>

          <section className="sub">
            <h3>History</h3>
            <ul className="plain">
              {project.events.map((e) => (
                <li key={String(e.id)}>
                  <span className="muted">{formatDateTime(e.occurred_at, zone)}</span> · <b>{e.actor_name}</b> {describeEvent(e)}
                </li>
              ))}
            </ul>
          </section>

          {fullEdit ? (
            <form action={archiveAction} className="archive-row">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="archive" value={project.archived_at ? "0" : "1"} />
              <button className="secondary" type="submit">{project.archived_at ? "Restore from archive" : "Archive project"}</button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
