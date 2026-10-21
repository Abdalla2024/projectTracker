"use client";

/** A GET form that applies itself when a select changes (no "Apply" button needed). */
export function AutoSubmit({ children, className, action = "" }: { children: React.ReactNode; className?: string; action?: string }) {
  return (
    <form action={action} method="get" className={className} onChange={(e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "SELECT" || (t as HTMLInputElement).type === "checkbox") (e.currentTarget as HTMLFormElement).requestSubmit();
    }}>
      {children}
    </form>
  );
}
