"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Projects" },
  { href: "/projects/new", label: "New project" },
  { href: "/summary", label: "Weekly summary" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" || (path.startsWith("/projects/") && path !== "/projects/new") : path === l.href;
        return <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>{l.label}</Link>;
      })}
    </nav>
  );
}
