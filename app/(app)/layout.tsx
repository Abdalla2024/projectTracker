import Link from "next/link";
import { signOutAction } from "@/app/actions";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <header className="top">
        <div className="wrap">
          <Link className="brand" href="/">Ekiben Project Tracker</Link>
          <nav>
            <Link href="/">Projects</Link>
            <Link href="/projects/new">New project</Link>
            <Link href="/summary">Weekly summary</Link>
          </nav>
          <div className="who">
            <span>{user.displayName}</span>
            <span className={`chip ${user.role === "admin" ? "warn" : ""}`}>{user.role}</span>
            <form action={signOutAction}><button className="link" type="submit">Sign out</button></form>
          </div>
        </div>
      </header>
      <div className="notice">
        <div className="wrap">Demo build. Don&apos;t enter customer, employee-personal or financial details in projects or comments.</div>
      </div>
      <main className="wrap">{children}</main>
    </>
  );
}
