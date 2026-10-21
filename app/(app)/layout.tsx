import { Suspense } from "react";
import { signOutAction } from "@/app/actions";
import { Logo } from "@/app/components/Logo";
import { Sidebar } from "@/app/components/Sidebar";
import { requireUser } from "@/lib/auth";
import { listOrg } from "@/lib/org";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [locations, teams] = await Promise.all([listOrg(user.id, "locations"), listOrg(user.id, "teams")]);
  const active = (xs: typeof locations) => xs.filter((x) => !x.archived_at).map(({ id, name, color }) => ({ id, name, color }));
  const initials = user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const account = (
    <>
      <span className="avatar" aria-hidden="true">{initials}</span>
      <span className="who-text"><b>{user.displayName}</b><small>{user.role}</small></span>
      <form action={signOutAction}>
        <button className="icon-out" type="submit" title="Sign out" aria-label="Sign out">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </form>
    </>
  );
  return (
    <div className="shell">
      <Suspense fallback={<aside className="side" />}>
        <Sidebar isAdmin={user.role === "admin"} locations={active(locations)} teams={active(teams)} logo={<Logo size={64} />} account={account} />
      </Suspense>
      <main className="panel">{children}</main>
    </div>
  );
}
