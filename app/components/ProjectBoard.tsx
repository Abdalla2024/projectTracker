import Link from "next/link";

export interface BoardCard {
  id: string; name: string; status: string; priority: string; phase: string; progress: number;
  location: { name: string; color: string } | null; team: { name: string; color: string } | null;
  due: string | null; overdue: boolean; tasks: string | null;
}

/** Projects in status columns. Status follows each project's tasks, so cards are not dragged here. */
export function ProjectBoard({ columns, cards }: { columns: { key: string; label: string }[]; cards: BoardCard[] }) {
  return (
    <>
      <div className="board">
        {columns.map((col) => {
          const list = cards.filter((c) => c.status === col.key);
          return (
            <section key={col.key} className="board-col">
              <h3><span className={`dot s-${col.key}`} aria-hidden="true" />{col.label}<span className="count">{list.length}</span></h3>
              {list.map((c) => (
                <article key={c.id} className="board-card">
                  <Link href={`/?open=${c.id}#p-${c.id}`} className="title">{c.name}</Link>
                  {c.phase ? <span className="phase">Working on: <b>{c.phase}</b></span> : null}
                  <div className="bar" role="img" aria-label={`${c.progress}% complete`}><i style={{ width: `${c.progress}%` }} /></div>
                  <div className="tags">
                    {c.location ? <span className="chip org"><i style={{ background: c.location.color }} />{c.location.name}</span> : null}
                    {c.team ? <span className="chip org"><i style={{ background: c.team.color }} />{c.team.name}</span> : null}
                    {c.priority === "high" ? <span className="chip high">High</span> : null}
                    {c.due ? <span className={`chip ${c.overdue ? "bad" : ""}`}>{c.overdue ? "Overdue · " : "Due "}{c.due}</span> : null}
                    {c.tasks ? <span className="chip">{c.tasks}</span> : null}
                  </div>
                </article>
              ))}
              {list.length === 0 ? <p className="board-empty">None</p> : null}
            </section>
          );
        })}
      </div>
      <p className="hint">A project moves between columns on its own as its tasks are ticked off. Mark it Stuck from the project if it is blocked.</p>
    </>
  );
}
