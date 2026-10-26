"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const I = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const ICONS: Record<string, React.ReactNode> = {
  projects: <svg {...I}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></svg>,
  tasks: <svg {...I}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>,
  calendar: <svg {...I}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  summary: <svg {...I}><path d="M5 4h10l4 4v12H5z" /><path d="M9 12h6M9 16h6M9 8h3" /></svg>,
  reports: <svg {...I}><path d="M9 4h6v3H9z" /><path d="M7 5.5H5.5v15h13v-15H17" /><path d="M9 12h6M9 16h4" /></svg>,
  dashboard: <svg {...I}><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></svg>,
  settings: <svg {...I}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
};

interface Unit { id: string; name: string; color: string }

export function Sidebar({ isAdmin, locations, teams, logo, account }: {
  isAdmin: boolean; locations: Unit[]; teams: Unit[]; logo: React.ReactNode; account: React.ReactNode;
}) {
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path, params]);

  const nav = [
    { href: "/", key: "projects", label: "Projects" },
    { href: "/my-tasks", key: "tasks", label: "My tasks" },
    { href: "/calendar", key: "calendar", label: "Calendar" },
    { href: "/summary", key: "summary", label: "Weekly summary" },
    { href: "/reports", key: "reports", label: "Nightly reports" },
    { href: "/dashboard", key: "dashboard", label: "Dashboard" },
    ...(isAdmin ? [{ href: "/settings", key: "settings", label: "Settings" }] : []),
  ];
  const isActive = (href: string) => (href === "/" ? path === "/" && !params.get("location") && !params.get("team") : path.startsWith(href));
  const unitLink = (kind: "location" | "team", u: Unit) => (
    <Link key={u.id} href={`/?${kind}=${u.id}`} aria-current={params.get(kind) === u.id && path === "/" ? "page" : undefined}>
      <i style={{ background: u.color }} aria-hidden="true" />{u.name}
    </Link>
  );
  const group = (key: "locations" | "teams", title: string, kind: "location" | "team", units: Unit[], addLabel: string) =>
    units.length || isAdmin ? (
      <Collapsible id={key} title={title} count={units.length} forceOpen={!!params.get(kind) && path === "/"}>
        {units.map((u) => unitLink(kind, u))}
        {isAdmin ? <Link className="side-add" href={`/settings#${key}`}>{addLabel}</Link> : null}
      </Collapsible>
    ) : null;

  return (
    <aside className={`side${open ? " open" : ""}`}>
      <div className="side-top">
        <Link className="side-logo" href="/" aria-label="Ekiben Project Tracker home">{logo}</Link>
        <button type="button" className="side-toggle" aria-expanded={open} aria-label="Menu" onClick={() => setOpen(!open)}>
          <svg {...I}><path d={open ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} /></svg>
        </button>
      </div>
      <div className="side-body">
        <nav aria-label="Main" className="side-nav">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined}>{ICONS[n.key]}<span>{n.label}</span></Link>
          ))}
        </nav>
        {group("locations", "Locations", "location", locations, "+ Add location")}
        {group("teams", "Teams", "team", teams, "+ Add team")}
        <div className="side-account">{account}</div>
      </div>
    </aside>
  );
}

/** A sidebar group that folds away. The choice is remembered in this browser; it opens when one of its items is selected. */
function Collapsible({ id, title, count, forceOpen, children }: { id: string; title: string; count: number; forceOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try { if (localStorage.getItem(`side-${id}`) === "closed") setOpen(false); } catch { /* storage unavailable: stay open */ }
  }, [id]);
  useEffect(() => { if (forceOpen) setOpen(true); }, [forceOpen]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(`side-${id}`, next ? "open" : "closed"); } catch { /* ignore */ }
  };
  return (
    <div className={`side-group${open ? "" : " collapsed"}`}>
      <button type="button" className="side-group-toggle" aria-expanded={open} aria-controls={`side-${id}`} onClick={toggle}>
        <h4>{title}</h4>
        <span className="side-count">{count}</span>
        <svg className="side-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <div id={`side-${id}`} className="side-group-body" hidden={!open}>{children}</div>
    </div>
  );
}
