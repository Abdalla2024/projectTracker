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
        <Link className="brand" href="/" aria-label="Ekiben Project Tracker home"><Logo size={84} /></Link>
        <NavLinks />
        <div className="who">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <span className="name">{user.displayName}</span>
          <span className={`chip ${user.role === "admin" ? "warn" : ""}`}>{user.role}</span>
          <form action={signOutAction}><button className="link" type="submit">Sign out</button></form>
        </div>
      </header>
      <p className="demo-note">Demo build. Don&apos;t enter customer, employee-personal or financial details in projects or comments.</p>
      <main className="content">{children}</main>
    </>
  );
}
