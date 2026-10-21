"use client";

import { useEffect, useRef, useState } from "react";
import { createProjectAction } from "@/app/actions";
import { ProgressField } from "@/app/components/ProgressField";

interface Props {
  people: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  defaultLocation?: string | null;
  defaultTeam?: string | null;
  statuses: { value: string; label: string }[];
  priorities: { value: string; label: string }[];
  phaseMax: number;
  defaultOpen?: boolean;
  error?: string;
}

export function NewProjectModal({ people, locations, teams, defaultLocation, defaultTeam, statuses, priorities, phaseMax, defaultOpen, error }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tasks, setTasks] = useState<string[]>([""]);
  const hasTasks = tasks.some((t) => t.trim());
  const setTask = (i: number, v: string) => setTasks((ts) => ts.map((t, j) => (j === i ? v : t)));
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
              <label htmlFor="np-location">Location</label>
              <select id="np-location" name="location_id" defaultValue={defaultLocation ?? ""}>
                <option value="">None</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="np-team">Team</label>
              <select id="np-team" name="team_id" defaultValue={defaultTeam ?? ""}>
                <option value="">None</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
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
            <div>
              <label htmlFor="np-phase">Current phase</label>
              <input id="np-phase" name="phase" type="text" maxLength={phaseMax} placeholder="e.g. Drafting menu" />
            </div>
            <div>
              <label htmlFor="np-progress">Progress</label>
              {hasTasks ? <p className="auto-progress">Follows the tasks below: 0% to start, 100% when all are done.</p> : <ProgressField id="np-progress" />}
            </div>
          </div>
          <fieldset className="np-tasks">
            <legend>Tasks</legend>
            <p className="hint">Break the project into steps. People tick them off one at a time and the progress ring moves on its own.</p>
            <ol>
              {tasks.map((t, i) => (
                <li key={i}>
                  <input type="text" name="task_titles" maxLength={300} value={t} placeholder={`Task ${i + 1}`} aria-label={`Task ${i + 1}`}
                    onChange={(e) => setTask(i, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setTasks((ts) => [...ts.slice(0, i + 1), "", ...ts.slice(i + 1)]); } }} />
                  {tasks.length > 1 ? <button type="button" className="icon-btn" aria-label={`Remove task ${i + 1}`} onClick={() => setTasks((ts) => ts.filter((_, j) => j !== i))}>×</button> : null}
                </li>
              ))}
            </ol>
            <button type="button" className="secondary small" onClick={() => setTasks((ts) => [...ts, ""])}>+ Add task</button>
          </fieldset>
          {people.length ? (
            <>
              <label>Assign to (one or more)</label>
              <div className="checks">
                {people.map((p) => (
                  <label key={p.id}><input type="checkbox" name="assignees" value={p.id} /> {p.name}</label>
                ))}
              </div>
            </>
          ) : null}
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
