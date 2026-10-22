"use client";

import { useEffect, useRef, useState } from "react";

export type Person = { id: string; name: string };

export const initials = (name: string) =>
  name.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** Small stacked avatars for the people on a task. */
export function Faces({ people, max = 3 }: { people: Person[]; max?: number }) {
  if (!people.length) return null;
  return (
    <span className="faces" title={people.map((p) => p.name).join(", ")}>
      {people.slice(0, max).map((p) => <span key={p.id} className="face" aria-hidden="true">{initials(p.name)}</span>)}
      {people.length > max ? <span className="face more" aria-hidden="true">+{people.length - max}</span> : null}
      <span className="sr-only">Assigned to {people.map((p) => p.name).join(", ")}</span>
    </span>
  );
}

/** Pick any number of people. Shows their faces, or "Assign" when nobody is picked. */
export function PeoplePicker({ people, value, onChange, label = "Assign people", compact = false }: {
  people: Person[]; value: string[]; onChange: (ids: string[]) => void; label?: string; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const chosen = people.filter((p) => value.includes(p.id));
  const shown = people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="picker" ref={box}>
      <button type="button" className={`picker-btn${compact ? " compact" : ""}`} aria-haspopup="true" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
        {chosen.length ? <Faces people={chosen} /> : <span className="picker-empty">{compact ? "+" : "Assign"}</span>}
      </button>
      {open ? (
        <div className="picker-pop" role="dialog" aria-label={label}>
          {people.length > 6 ? <input type="search" placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /> : null}
          <ul>
            {shown.map((p) => (
              <li key={p.id}>
                <label><input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} /> <span className="face" aria-hidden="true">{initials(p.name)}</span> {p.name}</label>
              </li>
            ))}
            {shown.length === 0 ? <li className="muted">Nobody matches.</li> : null}
          </ul>
          <div className="picker-foot">
            {value.length ? <button type="button" className="link" onClick={() => onChange([])}>Clear</button> : <span />}
            <button type="button" className="secondary small" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
