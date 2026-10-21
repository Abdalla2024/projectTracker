"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setProjectStatusAction } from "@/app/actions";

export interface BoardCard {
  id: string; name: string; status: string; priority: string; phase: string; progress: number;
  location: { name: string; color: string } | null; team: { name: string; color: string } | null;
  due: string | null; overdue: boolean; tasks: string | null;
}

/** Kanban of projects by status. Drag a card to another column to change its status. */
export function ProjectBoard({ columns, cards }: { columns: { key: string; label: string }[]; cards: BoardCard[] }) {
  const router = useRouter();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const statusOf = (c: BoardCard) => local[c.id] ?? c.status;

  const drop = (status: string) => {
    const id = dragging;
    setOver(null);
    setDragging(null);
    if (!id) return;
    const card = cards.find((c) => c.id === id);
    if (!card || statusOf(card) === status) return;
    setLocal((m) => ({ ...m, [id]: status }));
    start(async () => {
      const err = await setProjectStatusAction(id, status);
      if (err) { setError(err); setLocal((m) => { const n = { ...m }; delete n[id]; return n; }); }
      router.refresh();
    });
  };

  return (
    <>
      {error ? <p className="alert error" role="alert">{error}</p> : null}
      <div className="board">
        {columns.map((col) => {
          const list = cards.filter((c) => statusOf(c) === col.key);
          return (
            <section key={col.key} className={`board-col${over === col.key ? " over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => { e.preventDefault(); drop(col.key); }}>
              <h3><span className={`dot s-${col.key}`} aria-hidden="true" />{col.label}<span className="count">{list.length}</span></h3>
              {list.map((c) => (
                <article key={c.id} className={`board-card${dragging === c.id ? " dragging" : ""}`} draggable
                  onDragStart={(e) => { setDragging(c.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}>
                  <Link href={`/?open=${c.id}#p-${c.id}`} className="title">{c.name}</Link>
                  {c.phase ? <span className="phase">Working on: <b>{c.phase}</b></span> : null}
                  <div className="bar" role="img" aria-label={`${c.progress}% complete`}><i style={{ width: `${c.status === "done" ? 100 : c.progress}%` }} /></div>
                  <div className="tags">
                    {c.location ? <span className="chip org"><i style={{ background: c.location.color }} />{c.location.name}</span> : null}
                    {c.team ? <span className="chip org"><i style={{ background: c.team.color }} />{c.team.name}</span> : null}
                    {c.priority === "high" ? <span className="chip high">High</span> : null}
                    {c.due ? <span className={`chip ${c.overdue ? "bad" : ""}`}>{c.overdue ? "Overdue · " : "Due "}{c.due}</span> : null}
                    {c.tasks ? <span className="chip">{c.tasks}</span> : null}
                  </div>
                </article>
              ))}
              {list.length === 0 ? <p className="board-empty">Drop a project here</p> : null}
            </section>
          );
        })}
      </div>
      <p className="hint">Drag a card to another column to change its status.</p>
    </>
  );
}
