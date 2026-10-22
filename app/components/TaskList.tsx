"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { addSection, addTask, placeTask, removeSection, removeTask, renameSectionTo, saveTask, setTaskPeople, toggleTask } from "@/app/task-actions";
import { Faces, PeoplePicker, type Person } from "@/app/components/PeoplePicker";

export interface ListTask {
  id: string; section_id: string | null; parent_id: string | null; title: string; notes: string;
  assignees: Person[]; due_date: string | null; completed_at: string | null; sort_order: number;
}
export interface ListSection { id: string; name: string }

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function Due({ date, done, today }: { date: string | null; done: boolean; today: string }) {
  if (!date) return null;
  const late = !done && date < today;
  return <span className={`due${late ? " late" : date === today && !done ? " today" : ""}`}>{late ? "Overdue · " : date === today ? "Today" : ""}{date === today ? "" : shortDate(date)}</span>;
}

/**
 * Tasks of one open project, Asana-style: tick a task off (it stays in place, crossed out), drag a task
 * into a section or between tasks, see subtasks underneath, click a task to edit it.
 * Changes show at once; the page data refreshes behind them, so the project's ring, status and current
 * phase (computed by the database) follow.
 */
export function TaskList({ projectId, sections, tasks, people, today }: {
  projectId: string; sections: ListSection[]; tasks: ListTask[]; people: Person[]; today: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(tasks);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null); // "task:<id>" or "section:<id|none>"
  const [pending, start] = useTransition();
  useEffect(() => setItems(tasks), [tasks]);

  const act = (optimistic: (xs: ListTask[]) => ListTask[], call: () => Promise<string | null>) => {
    const before = items;
    setItems(optimistic(items));
    setError(null);
    start(async () => {
      const err = await call();
      if (err) { setError(err); setItems(before); }
      router.refresh();
    });
  };

  const top = items.filter((t) => !t.parent_id);
  const subsOf = (id: string) => items.filter((t) => t.parent_id === id).sort((a, b) => a.sort_order - b.sort_order);
  const inSection = (sid: string | null) => top.filter((t) => t.section_id === sid).sort((a, b) => a.sort_order - b.sort_order);
  const done = top.filter((t) => t.completed_at).length;
  const groups = useMemo(() => [
    ...(sections.length === 0 || top.some((t) => !t.section_id) ? [{ id: null as string | null, name: sections.length ? "No section" : "" }] : []),
    ...sections.map((s) => ({ id: s.id as string | null, name: s.name })),
  ], [sections, top]);

  const toggle = (t: ListTask) => act(
    (xs) => xs.map((x) => (x.id === t.id ? { ...x, completed_at: x.completed_at ? null : new Date().toISOString() } : x)),
    () => toggleTask(t.id, !t.completed_at),
  );

  const drop = (sectionId: string | null, beforeId: string | null) => {
    const id = dragId;
    setDragId(null); setDropAt(null);
    if (!id || id === beforeId) return;
    act((xs) => {
      const moving = xs.find((x) => x.id === id)!;
      const rest = xs.filter((x) => x.id !== id);
      const siblings = rest.filter((x) => !x.parent_id && x.section_id === sectionId).sort((a, b) => a.sort_order - b.sort_order);
      const at = beforeId ? siblings.findIndex((x) => x.id === beforeId) : siblings.length;
      siblings.splice(at < 0 ? siblings.length : at, 0, { ...moving, section_id: sectionId });
      const order = new Map(siblings.map((x, i) => [x.id, i]));
      return [...rest.filter((x) => !order.has(x.id)), ...siblings.map((x) => ({ ...x, sort_order: order.get(x.id)! }))];
    }, () => placeTask(projectId, id, sectionId, beforeId));
  };

  const row = (t: ListTask, sectionId: string | null, isSub = false) => {
    const isDone = !!t.completed_at;
    const subs = isSub ? [] : subsOf(t.id);
    const subsDone = subs.filter((s) => s.completed_at).length;
    return (
      <li key={t.id}
        className={`trow${isDone ? " done" : ""}${isSub ? " is-sub" : ""}${dropAt === `task:${t.id}` ? " drop-before" : ""}${dragId === t.id ? " dragging" : ""}`}
        draggable={!isSub}
        onDragStart={(e) => { if (isSub) return; setDragId(t.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); }}
        onDragEnd={() => { setDragId(null); setDropAt(null); }}
        onDragOver={(e) => { if (!dragId || isSub) return; e.preventDefault(); e.stopPropagation(); setDropAt(`task:${t.id}`); }}
        onDrop={(e) => { if (isSub) return; e.preventDefault(); e.stopPropagation(); drop(sectionId, t.id); }}>
        <div className="tline">
          {!isSub ? <span className="grip" aria-hidden="true" title="Drag to move">⋮⋮</span> : null}
          <button type="button" className={`check${isDone ? " on" : ""}`} onClick={() => toggle(t)}
            aria-label={isDone ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`} aria-pressed={isDone}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
          </button>
          <button type="button" className="ttitle" onClick={() => setOpenId(openId === t.id ? null : t.id)} aria-expanded={openId === t.id}>{t.title}</button>
          <span className="tmeta">
            {subs.length ? <span className="subcount">{subsDone}/{subs.length}</span> : null}
            <Due date={t.due_date} done={isDone} today={today} />
            <PeoplePicker compact people={people} value={t.assignees.map((a) => a.id)} label={`People on "${t.title}"`}
              onChange={(ids) => act(
                (xs) => xs.map((x) => (x.id === t.id ? { ...x, assignees: people.filter((p) => ids.includes(p.id)) } : x)),
                () => setTaskPeople(projectId, t.id, ids),
              )} />
          </span>
        </div>
        {openId === t.id ? (
          <TaskEditor task={t} people={people} onClose={() => setOpenId(null)}
            onSave={(v) => act((xs) => xs.map((x) => (x.id === t.id ? { ...x, title: v.title, notes: v.notes, due_date: v.dueDate, assignees: people.filter((p) => v.assigneeIds.includes(p.id)) } : x)),
              () => saveTask({ projectId, taskId: t.id, ...v }))}
            onDelete={() => { setOpenId(null); act((xs) => xs.filter((x) => x.id !== t.id && x.parent_id !== t.id), () => removeTask(projectId, t.id)); }}
            onAddSub={isSub ? undefined : (title) => act((xs) => [...xs, { id: `tmp-${Date.now()}`, section_id: null, parent_id: t.id, title, notes: "", assignees: [], due_date: null, completed_at: null, sort_order: 1e9 }],
              () => addTask({ projectId, title, sectionId: null, parentId: t.id, assigneeIds: [], dueDate: null }))} />
        ) : null}
        {subs.length ? <ul className="subs">{subs.map((s) => row(s, sectionId, true))}</ul> : null}
      </li>
    );
  };

  return (
    <section className="sub tasks-panel" id={`tasks-${projectId}`} aria-busy={pending}>
      <div className="tasks-head">
        <h3>Tasks</h3>
        {top.length ? (
          <>
            <div className="bar" role="img" aria-label={`${done} of ${top.length} tasks done`}><i style={{ width: `${Math.round((done / top.length) * 100)}%` }} /></div>
            <span className="hint">{done} of {top.length} done</span>
          </>
        ) : <span className="hint">Add the steps of this project. Ticking them off moves the progress ring.</span>}
        {pending ? <span className="saving">Saving…</span> : null}
      </div>
      {error ? <p className="alert error" role="alert">{error}</p> : null}
      {groups.map((g) => {
        const list = inSection(g.id);
        const key = `section:${g.id ?? "none"}`;
        return (
          <div key={key} className={`tsection${dropAt === key ? " drop-into" : ""}`}
            onDragOver={(e) => { if (!dragId) return; e.preventDefault(); setDropAt(key); }}
            onDrop={(e) => { e.preventDefault(); drop(g.id, null); }}>
            {g.name ? <SectionHead id={g.id} name={g.name} count={list.length}
              onRename={(name) => g.id ? act((xs) => xs, () => renameSectionTo(projectId, g.id!, name)) : undefined}
              onDelete={() => g.id ? act((xs) => xs.map((x) => (x.section_id === g.id ? { ...x, section_id: null } : x)), () => removeSection(projectId, g.id!)) : undefined} /> : null}
            <ul className="tlist">{list.map((t) => row(t, g.id))}</ul>
            {dragId && list.length === 0 ? <p className="drop-hint">Drop a task here</p> : null}
            <AddTask people={people} placeholder={g.name && g.id ? `Add a task to ${g.name}` : "Add a task"}
              onAdd={(v) => act((xs) => [...xs, { id: `tmp-${Date.now()}`, section_id: g.id, parent_id: null, title: v.title, notes: "", assignees: people.filter((p) => v.assigneeIds.includes(p.id)), due_date: v.dueDate, completed_at: null, sort_order: 1e9 }],
                () => addTask({ projectId, sectionId: g.id, parentId: null, ...v }))} />
          </div>
        );
      })}
      <AddSection onAdd={(name) => act((xs) => xs, () => addSection(projectId, name))} />
      {top.length > 1 ? <p className="hint drag-tip">Tip: drag a task by its ⋮⋮ handle to reorder it or move it into a section.</p> : null}
    </section>
  );
}

function SectionHead({ id, name, count, onRename, onDelete }: { id: string | null; name: string; count: number; onRename: (n: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  if (editing && id) {
    return (
      <form className="shead editing" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onRename(value); setEditing(false); }}>
        <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} autoFocus aria-label="Section name" />
        <button type="submit" className="small">Save</button>
        <button type="button" className="link" onClick={() => setEditing(false)}>Cancel</button>
        <button type="button" className="link danger-link" onClick={() => { if (confirm(`Delete the section "${name}"? Its tasks move to "No section".`)) onDelete(); }}>Delete section</button>
      </form>
    );
  }
  return (
    <div className="shead">
      <h4>{name}</h4><span className="count">{count}</span>
      {id ? <button type="button" className="link" onClick={() => setEditing(true)} aria-label={`Rename or delete ${name}`}>Edit</button> : null}
    </div>
  );
}

function AddTask({ people, placeholder, onAdd }: { people: Person[]; placeholder: string; onAdd: (v: { title: string; assigneeIds: string[]; dueDate: string | null }) => void }) {
  const [title, setTitle] = useState("");
  const [who, setWho] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const submit = () => {
    if (!title.trim()) return;
    onAdd({ title: title.trim(), assigneeIds: who, dueDate: due || null });
    setTitle(""); setWho([]); setDue("");
  };
  return (
    <form className="tadd" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <span className="plus" aria-hidden="true">+</span>
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={300} />
      {title.trim() ? (
        <>
          <PeoplePicker people={people} value={who} onChange={setWho} label="People for the new task" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
          <button type="submit" className="small">Add</button>
        </>
      ) : null}
    </form>
  );
}

function AddSection({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open) return <button type="button" className="link add-section-btn" onClick={() => setOpen(true)}>+ Add a section</button>;
  return (
    <form className="tadd section-add" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name.trim()); setName(""); setOpen(false); } }}>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Section name, e.g. To do, Doing, Done" aria-label="New section name" maxLength={80} autoFocus />
      <button type="submit" className="small">Add section</button>
      <button type="button" className="link" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

function TaskEditor({ task, people, onSave, onDelete, onAddSub, onClose }: {
  task: ListTask; people: Person[];
  onSave: (v: { title: string; notes: string; assigneeIds: string[]; dueDate: string | null }) => void;
  onDelete: () => void; onAddSub?: (title: string) => void; onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [who, setWho] = useState(task.assignees.map((a) => a.id));
  const [due, setDue] = useState(task.due_date ?? "");
  const [sub, setSub] = useState("");
  return (
    <div className="teditor">
      <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) { onSave({ title: title.trim(), notes, assigneeIds: who, dueDate: due || null }); onClose(); } }}>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} aria-label="Task name" />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} placeholder="Notes (optional)" aria-label="Notes" />
        <div className="teditor-row">
          <label className="inline">People <PeoplePicker people={people} value={who} onChange={setWho} /></label>
          <label className="inline">Due <input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <span className="spacer" />
          <button type="button" className="link danger-link" onClick={() => { if (confirm(`Delete "${task.title}"${task.parent_id ? "" : " and its subtasks"}?`)) onDelete(); }}>Delete</button>
          <button type="button" className="secondary small" onClick={onClose}>Cancel</button>
          <button type="submit" className="small">Save</button>
        </div>
      </form>
      {onAddSub ? (
        <form className="tadd sub-add" onSubmit={(e) => { e.preventDefault(); if (sub.trim()) { onAddSub(sub.trim()); setSub(""); } }}>
          <span className="plus" aria-hidden="true">+</span>
          <input type="text" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Add a subtask" aria-label="Add a subtask" maxLength={300} />
          {sub.trim() ? <button type="submit" className="small">Add</button> : null}
        </form>
      ) : null}
    </div>
  );
}

export { Faces };
