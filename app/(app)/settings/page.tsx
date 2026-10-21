import { notFound } from "next/navigation";
import { Alerts } from "@/app/components/Alerts";
import { createOrgAction, updateOrgAction } from "@/app/org-actions";
import { requireUser } from "@/lib/auth";
import { listOrg, type OrgKind, type OrgUnit } from "@/lib/org";

// The validated categorical palette, in its fixed order (see the dataviz guidance): charts colour
// locations by these, so picking from them keeps lines and bars distinguishable.
const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

function Swatches({ name, value }: { name: string; value: string }) {
  return (
    <fieldset className="swatches">
      <legend className="sr-only">Colour</legend>
      {COLORS.map((c) => (
        <label key={c} title={c}>
          <input type="radio" name={name} value={c} defaultChecked={c.toLowerCase() === value.toLowerCase()} />
          <i style={{ background: c }} aria-hidden="true" /><span className="sr-only">{c}</span>
        </label>
      ))}
    </fieldset>
  );
}

function OrgSection({ kind, title, units, hint }: { kind: OrgKind; title: string; units: OrgUnit[]; hint: string }) {
  const next = COLORS[units.length % COLORS.length];
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="hint">{hint}</p>
      <ul className="plain org-list">
        {units.map((u) => (
          <li key={u.id} className={u.archived_at ? "archived" : ""}>
            <form action={updateOrgAction} className="org-row">
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="id" value={u.id} />
              <input type="text" name="name" required maxLength={60} defaultValue={u.name} aria-label={`${title} name`} disabled={!!u.archived_at} />
              {u.archived_at ? null : <Swatches name="color" value={u.color} />}
              {u.archived_at ? <span className="chip">archived</span> : <button type="submit" className="secondary">Save</button>}
            </form>
            <form action={updateOrgAction}>
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="archive" value={u.archived_at ? "0" : "1"} />
              <button type="submit" className="link">{u.archived_at ? "Restore" : "Archive"}</button>
            </form>
          </li>
        ))}
      </ul>
      <form action={createOrgAction} className="org-row add">
        <input type="hidden" name="kind" value={kind} />
        <input type="text" name="name" required maxLength={60} placeholder={`New ${kind === "locations" ? "location" : "team"}`} aria-label={`New ${title.toLowerCase()} name`} />
        <Swatches name="color" value={next} />
        <button type="submit">Add</button>
      </form>
    </section>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const user = await requireUser();
  if (user.role !== "admin") notFound();
  const sp = await searchParams;
  const [locations, teams] = await Promise.all([listOrg(user.id, "locations"), listOrg(user.id, "teams")]);
  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      <Alerts error={sp.error} saved={sp.saved} />
      <div className="chart-grid">
        <OrgSection kind="locations" title="Locations" units={locations} hint="Stores. Projects and nightly reports belong to a location. Archiving hides it from new reports and menus but keeps its history." />
        <OrgSection kind="teams" title="Teams" units={teams} hint="Positions or departments, for example HR or Chief of Staff. Projects can be filed under a team." />
      </div>
      <section className="card">
        <h2>People and admins</h2>
        <p className="muted">Everyone with an allowed email address can sign up and sees every project. Admin rights (dashboard, settings, all nightly reports) come only from the private admin list, managed outside the app: <code>npm run admin:remote -- grant name@ekibenbaltimore.com</code>.</p>
      </section>
    </>
  );
}
