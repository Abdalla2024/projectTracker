"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Projects" },
  { href: "/summary", label: "Weekly summary" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={(l.href === "/" ? path === "/" : path === l.href) ? "page" : undefined}>{l.label}</Link>
      ))}
    </nav>
  );
}
