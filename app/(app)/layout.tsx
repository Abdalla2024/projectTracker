import Link from "next/link";
import { signOutAction } from "@/app/actions";
import { Logo } from "@/app/components/Logo";
import { NavLinks } from "@/app/components/NavLinks";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const initials = user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return (
    <>
      <header className="top">
        <Link className="brand" href="/" aria-label="Ekiben Project Tracker home"><Logo size={132} /></Link>
        <NavLinks />
        <div className="who">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <span className="name">{user.displayName}</span>
          <span className={`chip ${user.role === "admin" ? "warn" : ""}`}>{user.role}</span>
          <form action={signOutAction}>
            <button className="icon-out" type="submit" title="Sign out" aria-label="Sign out">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </form>
        </div>
      </header>
      <main className="content">{children}</main>
    </>
  );
}
