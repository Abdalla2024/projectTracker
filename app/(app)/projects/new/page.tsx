import { createProjectAction } from "@/app/actions";
import { Alerts } from "@/app/components/Alerts";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "@/lib/constants";
import { requireUser } from "@/lib/auth";
import { listPeople } from "@/lib/projects";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  const isAdmin = user.role === "admin";
  const people = isAdmin ? await listPeople(user.id) : [];

  return (
    <>
      <h1 style={{ marginTop: 20 }}>New project</h1>
      <Alerts error={error} />
      <form action={createProjectAction} className="card">
        <label htmlFor="name">Name</label>
        <input id="name" name="name" type="text" required maxLength={200} />
        <label htmlFor="description">Description</label>
        <textarea id="description" name="description" maxLength={5000} />
        <div className="grid2">
          <div>
            <label htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue="not_started">
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="priority">Priority</label>
            <select id="priority" name="priority" defaultValue="normal">
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="deadline">Deadline (optional)</label>
            <input id="deadline" name="deadline" type="date" />
          </div>
          <div>
            <label htmlFor="next_step">Next step</label>
            <input id="next_step" name="next_step" type="text" maxLength={500} />
          </div>
        </div>
        {isAdmin ? (
          <>
            <label>Assign to (one or more)</label>
            <div className="checks">
              {people.map((p) => (
                <label key={p.id}><input type="checkbox" name="assignees" value={p.id} /> {p.name}</label>
              ))}
            </div>
          </>
        ) : (
          <p className="hint">You&apos;ll be the owner of this project. An admin can assign it to others later.</p>
        )}
        <p><button type="submit">Create project</button></p>
        <p className="hint">Don&apos;t enter customer or financial details.</p>
      </form>
    </>
  );
}
