"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toggleTask } from "@/app/task-actions";

/** A task's check box outside the project view (My tasks): instant, then the page data refreshes. */
export function TaskCheck({ id, title, done }: { id: string; title: string; done: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(done);
  const [, start] = useTransition();
  useEffect(() => setOn(done), [done]);
  return (
    <button type="button" className={`check${on ? " on" : ""}`} aria-pressed={on} aria-label={on ? `Mark "${title}" not done` : `Mark "${title}" done`}
      onClick={() => {
        const next = !on;
        setOn(next);
        start(async () => {
          const err = await toggleTask(id, next);
          if (err) { setOn(!next); alert(err); }
          router.refresh();
        });
      }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
    </button>
  );
}

export function DueChip({ date, done, today }: { date: string | null; done: boolean; today: string }) {
  if (!date) return null;
  const late = !done && date < today;
  const [y, m, d] = date.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return <span className={`due${late ? " late" : date === today && !done ? " today" : ""}`}>{late ? `Overdue · ${label}` : date === today ? "Today" : label}</span>;
}
