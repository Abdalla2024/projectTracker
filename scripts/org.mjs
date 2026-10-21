// Out-of-band setup of locations and teams, for when no admin exists yet. Runs as the database owner.
// In the app, admins manage these in Settings.
//   node --env-file=.env.remote scripts/org.mjs list
//   node --env-file=.env.remote scripts/org.mjs add-location "Store name"
//   node --env-file=.env.remote scripts/org.mjs add-team "Team name"
import pg from "pg";
import { pgConfig } from "./lib/pgconfig.mjs";

// The validated chart palette, in order (see app/(app)/settings/page.tsx).
const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const [cmd, ...rest] = process.argv.slice(2);
const name = rest.join(" ").trim();
const url = process.env.DATABASE_ADMIN_URL;
if (!url) { console.error("DATABASE_ADMIN_URL is not set."); process.exit(1); }
if (!["list", "add-location", "add-team"].includes(cmd) || (cmd !== "list" && !(name.length >= 1 && name.length <= 60))) {
  console.error('Usage: scripts/org.mjs <list | add-location "Name" | add-team "Name">');
  process.exit(1);
}

const client = new pg.Client(pgConfig(url));
await client.connect();
try {
  if (cmd === "list") {
    for (const t of ["locations", "teams"]) {
      console.log(t);
      console.table((await client.query(`select name, color, sort_order, archived_at from ${t} order by sort_order, name`)).rows);
    }
  } else {
    const table = cmd === "add-location" ? "locations" : "teams";
    const n = (await client.query(`select count(*)::int n from ${table}`)).rows[0].n;
    const r = await client.query(
      `insert into ${table} (name, color, sort_order) values ($1, $2, $3) on conflict (name) do nothing returning name`,
      [name, COLORS[n % COLORS.length], n],
    );
    console.log(r.rowCount ? `Added ${table === "locations" ? "location" : "team"} "${name}".` : `"${name}" already exists; nothing changed.`);
  }
} finally {
  await client.end();
}
