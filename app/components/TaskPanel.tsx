import { addSectionAction, addTaskAction, deleteSectionAction, deleteTaskAction, renameSectionAction, toggleTaskAction, updateTaskAction } from "@/app/task-actions";
import type { Section, Task } from "@/lib/tasks";
import { formatDate } from "@/lib/time";

type Person = { id: string; name: string };

function Check({ task, back }: { task: Task; back?: string }) {
  const done = !!task.completed_at;
  return (
    <form action={toggleTaskAction} className="check-form">
      <input type="hidden" name="task_id" value={task.id} />
      <input type="hidden" name="done" value={done ? "0" : "1"} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <button type="submit" className={`check${done ? " on" : ""}`} aria-label={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`} title={done ? "Mark not done" : "Mark done"}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
      </button>
    </form>
  );
}

export function DueChip({ date, done, today }: { date: string | null; done: boolean; today: string }) {
  if (!date) return null;
  const overdue = !done && date < today;
  const isToday = date === today;
  return <span className={`chip ${overdue ? "bad" : isToday && !done ? "warn" : ""}`}>{overdue ? "Overdue · " : isToday ? "Today · " : ""}{formatDate(date)}</span>;
}

function PersonSelect({ name, people, value, label }: { name: string; people: Person[]; value?: string | null; label: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} aria-label={label}>
      <option value="">Unassigned</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

function AddTask({ projectId, sectionId, parentId, people, placeholder }: { projectId: string; sectionId?: string | null; parentId?: string; people: Person[]; placeholder: string }) {
  return (
    <form action={addTaskAction} className="add-task">
      <input type="hidden" name="project_id" value={projectId} />
      {sectionId ? <input type="hidden" name="section_id" value={sectionId} /> : null}
      {parentId ? <input type="hidden" name="parent_id" value={parentId} /> : null}
      <input type="text" name="title" required maxLength={300} placeholder={placeholder} aria-label={placeholder} />
      <PersonSelect name="assignee_id" people={people} label="Assignee" />
      <input type="date" name="due_date" aria-label="Due date" />
      <button type="submit" className="secondary">Add</button>
    </form>
  );
}

function TaskRow({ task, subtasks, projectId, sections, people, today }: { task: Task; subtasks: Task[]; projectId: string; sections: Section[]; people: Person[]; today: string }) {
  const done = !!task.completed_at;
  const subDone = subtasks.filter((s) => s.completed_at).length;
  return (
    <li className={`task${done ? " done" : ""}`}>
      <div className="task-line">
        <Check task={task} />
        <details className="task-more">
          <summary>
            <span className="task-title">{task.title}</span>
            <span className="task-meta">
              {subtasks.length ? <span className="chip">{subDone}/{subtasks.length} subtasks</span> : null}
              {task.assignee_name ? <span className="chip person">{task.assignee_name}</span> : null}
              <DueChip date={task.due_date} done={done} today={today} />
            </span>
          </summary>
          <div className="task-edit">
            <form action={updateTaskAction} className="task-form">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="task_id" value={task.id} />
              <input type="text" name="title" required maxLength={300} defaultValue={task.title} aria-label="Task title" />
              <textarea name="notes" maxLength={5000} defaultValue={task.notes} placeholder="Notes" aria-label="Notes" />
              <div className="task-form-row">
                <PersonSelect name="assignee_id" people={people} value={task.assignee_id} label="Assignee" />
                <input type="date" name="due_date" defaultValue={task.due_date ?? ""} aria-label="Due date" />
                {!task.parent_id ? (
                  <select name="section_id" defaultValue={task.section_id ?? ""} aria-label="Section">
                    <option value="">No section</option>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : null}
                <button type="submit">Save</button>
              </div>
            </form>
            {!task.parent_id ? (
              <div className="subtasks">
                <h4>Subtasks</h4>
                {subtasks.length ? (
                  <ul>
                    {subtasks.map((s) => (
                      <li key={s.id} className={`task sub${s.completed_at ? " done" : ""}`}>
                        <div className="task-line">
                          <Check task={s} />
                          <span className="task-title">{s.title}</span>
                          <span className="task-meta">
                            {s.assignee_name ? <span className="chip person">{s.assignee_name}</span> : null}
                            <DueChip date={s.due_date} done={!!s.completed_at} today={today} />
                            <form action={deleteTaskAction}>
                              <input type="hidden" name="project_id" value={projectId} />
                              <input type="hidden" name="task_id" value={s.id} />
                              <button type="submit" className="link" aria-label={`Delete subtask ${s.title}`}>Remove</button>
                            </form>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <AddTask projectId={projectId} parentId={task.id} people={people} placeholder="Add a subtask" />
              </div>
            ) : null}
            <form action={deleteTaskAction} className="danger-row">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="task_id" value={task.id} />
              <button type="submit" className="link danger-link">Delete task{subtasks.length ? " and its subtasks" : ""}</button>
            </form>
          </div>
        </details>
      </div>
    </li>
  );
}

/** Tasks inside an open project, grouped by section (Asana-style list). */
export function TaskPanel({ projectId, sections, tasks, people, today }: { projectId: string; sections: Section[]; tasks: Task[]; people: Person[]; today: string }) {
  const top = tasks.filter((t) => !t.parent_id);
  const subsOf = (id: string) => tasks.filter((t) => t.parent_id === id);
  const done = top.filter((t) => t.completed_at).length;
  // Open tasks first, finished ones after, each in their saved order.
  const order = (xs: Task[]) => [...xs.filter((t) => !t.completed_at), ...xs.filter((t) => t.completed_at)];
  const groups = [
    ...(top.some((t) => !t.section_id) || sections.length === 0 ? [{ id: null as string | null, name: sections.length ? "No section" : "", items: top.filter((t) => !t.section_id) }] : []),
    ...sections.map((s) => ({ id: s.id as string | null, name: s.name, items: top.filter((t) => t.section_id === s.id) })),
  ];

  return (
    <section className="sub tasks-panel" id={`tasks-${projectId}`}>
      <div className="tasks-head">
        <h3>Tasks</h3>
        {top.length ? <span className="hint">{done} of {top.length} done</span> : null}
        {top.length ? <div className="bar small" role="img" aria-label={`${done} of ${top.length} tasks done`}><i style={{ width: `${Math.round((done / top.length) * 100)}%` }} /></div> : null}
      </div>
      {groups.map((g) => (
        <div key={g.id ?? "none"} className="task-section">
          {g.name ? (
            <div className="section-head">
              <h4>{g.name}</h4>
              {g.id ? (
                <details className="section-menu">
                  <summary aria-label={`Edit section ${g.name}`}>Edit</summary>
                  <form action={renameSectionAction} className="inline-form">
                    <input type="hidden" name="project_id" value={projectId} />
                    <input type="hidden" name="section_id" value={g.id} />
                    <input type="text" name="name" required maxLength={80} defaultValue={g.name} aria-label="Section name" />
                    <button type="submit" className="secondary">Rename</button>
                  </form>
                  <form action={deleteSectionAction}>
                    <input type="hidden" name="project_id" value={projectId} />
                    <input type="hidden" name="section_id" value={g.id} />
                    <button type="submit" className="link danger-link">Delete section (its tasks move to “No section”)</button>
                  </form>
                </details>
              ) : null}
            </div>
          ) : null}
          {g.items.length ? (
            <ul className="task-list">
              {order(g.items).map((t) => (
                <TaskRow key={t.id} task={t} subtasks={subsOf(t.id)} projectId={projectId} sections={sections} people={people} today={today} />
              ))}
            </ul>
          ) : null}
          <AddTask projectId={projectId} sectionId={g.id} people={people} placeholder={g.name && g.id ? `Add a task to ${g.name}` : "Add a task"} />
        </div>
      ))}
      <form action={addSectionAction} className="inline-form add-section">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="text" name="name" required maxLength={80} placeholder="New section, e.g. To do, Doing, Done" aria-label="New section name" />
        <button type="submit" className="secondary">Add section</button>
      </form>
    </section>
  );
}
