import { archiveAction, assignAction, commentAction, deleteCommentAction, editCommentAction, updateProjectAction } from "@/app/actions";
import { Alerts } from "@/app/components/Alerts";
import { ProgressField } from "@/app/components/ProgressField";
import { PHASE_MAX, PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";
import { describeEvent } from "@/lib/format";
import type { CommentRow, getProjectDetail, listPeople } from "@/lib/projects";
import { formatDate, formatDateTime } from "@/lib/time";

type Project = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
type People = Awaited<ReturnType<typeof listPeople>>;

function Comment({ c, project, user, zone, isReply }: { c: CommentRow; project: Project; user: SessionUser; zone: string; isReply?: boolean }) {
  const mine = c.author_id === user.id;
  const key = c.id;
  if (c.deleted_at) {
    return <div className={`comment deleted${isReply ? " reply" : ""}`}><span className="muted">Comment deleted</span></div>;
  }
  return (
    <div className={`comment${isReply ? " reply" : ""}`}>
      <div className="comment-meta">
        <b>{c.author_name}</b> <span className="muted">· {formatDateTime(c.created_at, zone)}{c.edited_at ? " · edited" : ""}</span>
      </div>
      <div className="desc">{c.body}</div>
      <div className="comment-actions">
        {!isReply ? (
          <details>
            <summary>Reply</summary>
            <form action={commentAction}>
              <input type="hidden" name="id" value={project.id} />
              <input type="hidden" name="parent_id" value={c.id} />
              <textarea name="body" required maxLength={4000} aria-label={`Reply to ${c.author_name}`} />
              <button type="submit">Post reply</button>
            </form>
          </details>
        ) : null}
        {mine ? (
          <>
            <details>
              <summary>Edit</summary>
              <form action={editCommentAction}>
                <input type="hidden" name="id" value={project.id} />
                <input type="hidden" name="comment_id" value={c.id} />
                <textarea name="body" required maxLength={4000} defaultValue={c.body} aria-label="Edit your comment" />
                <button type="submit">Save</button>
              </form>
            </details>
            <details>
              <summary>Delete</summary>
              <form action={deleteCommentAction} className="confirm" key={key}>
                <input type="hidden" name="id" value={project.id} />
                <input type="hidden" name="comment_id" value={c.id} />
                <span>Delete this comment?</span>
                <button type="submit" className="danger">Delete</button>
              </form>
            </details>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The expanded part of a project card: details, editing, assignees (admins), comments and history. */
export function ProjectDetail({
  project, user, people, zone, error, saved,
}: { project: Project; user: SessionUser; people: People; zone: string; error?: string; saved?: string }) {
  const isAdmin = user.role === "admin";
  const fullEdit = isAdmin || project.created_by === user.id;
  const assigned = new Set(project.assignees.map((a) => a.id));
  const id = project.id;
  const top = project.comments.filter((c) => !c.parent_id);
  const repliesOf = (pid: string) => project.comments.filter((c) => c.parent_id === pid);
  // A deleted comment with no replies disappears; one with replies stays as a placeholder.
  const visibleTop = top.filter((c) => !c.deleted_at || repliesOf(c.id).some((r) => !r.deleted_at));

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
              <dt>Status</dt><dd>{STATUS_LABELS[project.status]}</dd>
              <dt>Phase</dt><dd>{project.phase || "—"}</dd>
              <dt>Progress</dt><dd>{project.status === "done" ? 100 : project.progress}%</dd>
              <dt>Deadline</dt><dd>{project.deadline ? formatDate(project.deadline) : "None"}</dd>
              <dt>Next step</dt><dd>{project.next_step || "—"}</dd>
              <dt>Last updated</dt><dd>{formatDateTime(project.updated_at, zone)}</dd>
            </dl>
            {project.description ? <p className="desc">{project.description}</p> : null}
          </section>

          <form action={updateProjectAction} className="sub">
            <h3>{fullEdit ? "Edit project" : "Update progress"}</h3>
            <input type="hidden" name="id" value={id} />
            {fullEdit ? (
              <>
                <label htmlFor={`name-${id}`}>Name</label>
                <input id={`name-${id}`} name="name" type="text" required maxLength={200} defaultValue={project.name} />
                <label htmlFor={`desc-${id}`}>Description</label>
                <textarea id={`desc-${id}`} name="description" maxLength={5000} defaultValue={project.description} />
              </>
            ) : null}
            <div className="grid2">
              <div>
                <label htmlFor={`status-${id}`}>Status</label>
                <select id={`status-${id}`} name="status" defaultValue={project.status}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              {fullEdit ? (
                <div>
                  <label htmlFor={`priority-${id}`}>Priority</label>
                  <select id={`priority-${id}`} name="priority" defaultValue={project.priority}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                  </select>
                </div>
              ) : null}
              <div>
                <label htmlFor={`phase-${id}`}>Current phase</label>
                <input id={`phase-${id}`} name="phase" type="text" maxLength={PHASE_MAX} defaultValue={project.phase} placeholder="e.g. Drafting menu" />
              </div>
              <div>
                <label htmlFor={`progress-${id}`}>Progress</label>
                <ProgressField id={`progress-${id}`} defaultValue={project.progress} />
              </div>
              {fullEdit ? (
                <div>
                  <label htmlFor={`deadline-${id}`}>Deadline</label>
                  <input id={`deadline-${id}`} name="deadline" type="date" defaultValue={project.deadline ?? ""} />
                </div>
              ) : null}
              <div>
                <label htmlFor={`next-${id}`}>Next step</label>
                <input id={`next-${id}`} name="next_step" type="text" maxLength={500} defaultValue={project.next_step} />
              </div>
            </div>
            <p><button type="submit">Save changes</button></p>
          </form>

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
            </form>
          ) : null}
        </div>

        <div>
          <section className="sub" id={`c-${id}`}>
            <h3>Comments</h3>
            {visibleTop.length === 0 ? <p className="muted">No comments yet.</p> : (
              <ul className="thread">
                {visibleTop.map((c) => (
                  <li key={c.id}>
                    <Comment c={c} project={project} user={user} zone={zone} />
                    {repliesOf(c.id).filter((r) => !r.deleted_at).map((r) => (
                      <Comment key={r.id} c={r} project={project} user={user} zone={zone} isReply />
                    ))}
                  </li>
                ))}
              </ul>
            )}
            <form action={commentAction} className="new-comment">
              <input type="hidden" name="id" value={id} />
              <label htmlFor={`body-${id}`}>Add a comment</label>
              <textarea id={`body-${id}`} name="body" required maxLength={4000} />
              <p><button type="submit">Post comment</button></p>
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
