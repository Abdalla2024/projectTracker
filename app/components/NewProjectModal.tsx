"use client";

import { useEffect, useRef } from "react";
import { createProjectAction } from "@/app/actions";

interface Props {
  people: { id: string; name: string }[];
  isAdmin: boolean;
  statuses: { value: string; label: string }[];
  priorities: { value: string; label: string }[];
  defaultOpen?: boolean;
  error?: string;
}

export function NewProjectModal({ people, isAdmin, statuses, priorities, defaultOpen, error }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (defaultOpen) ref.current?.showModal();
  }, [defaultOpen]);

  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()}>+ New project</button>
      <dialog
        ref={ref}
        className="modal"
        onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
      >
        <form action={createProjectAction}>
          <div className="modal-head">
            <h2>New project</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
          </div>
          {error ? <p className="alert error" role="alert">{error}</p> : null}
          <label htmlFor="np-name">Name</label>
          <input id="np-name" name="name" type="text" required maxLength={200} />
          <label htmlFor="np-description">Description</label>
          <textarea id="np-description" name="description" maxLength={5000} />
          <div className="grid2">
            <div>
              <label htmlFor="np-status">Status</label>
              <select id="np-status" name="status" defaultValue="not_started">
                {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="np-priority">Priority</label>
              <select id="np-priority" name="priority" defaultValue="normal">
                {priorities.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="np-deadline">Deadline (optional)</label>
              <input id="np-deadline" name="deadline" type="date" />
            </div>
            <div>
              <label htmlFor="np-next">Next step</label>
              <input id="np-next" name="next_step" type="text" maxLength={500} />
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
            <p className="hint" style={{ marginTop: 14 }}>You&apos;ll be the owner of this project. An admin can assign it to others later.</p>
          )}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => ref.current?.close()}>Cancel</button>
            <button type="submit">Create project</button>
          </div>
          <p className="hint">Don&apos;t enter customer or financial details.</p>
        </form>
      </dialog>
    </>
  );
}
