"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const icon = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const LINKS = [
  { href: "/", label: "Projects", svg: <svg {...icon}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></svg> },
  { href: "/summary", label: "Weekly summary", svg: <svg {...icon}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg> },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" || path.startsWith("/projects/") : path === l.href;
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} title={l.label}>
            {l.svg}<span>{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
