// Loads clearly synthetic demo data for LOCAL demos. Runs as the database owner.
//   npm run db:seed-demo             (refuses if demo data already exists)
//   npm run db:seed-demo -- --reset  (removes previous demo data first)
//
// Safety: refuses to run when NODE_ENV=production or when the database host is not local, unless
// --allow-remote is passed (use only for a private demo database that contains no real data).
// All accounts use the reserved domain below; nothing here is a real person, customer, or figure.
import pg from "pg";
import { DateTime } from "luxon";

const DEMO_DOMAIN = "ekiben-demo.example";
const ZONE = process.env.APP_TIME_ZONE || "America/New_York";
const args = new Set(process.argv.slice(2));

const url = process.env.DATABASE_ADMIN_URL;
if (!url) fail("DATABASE_ADMIN_URL is not set (see .env.example).");
if (process.env.NODE_ENV === "production") fail("Refusing to seed demo data with NODE_ENV=production.");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && !args.has("--allow-remote")) {
  fail(`Database host "${host}" is not local. Pass --allow-remote only for a private demo database with no real data.`);
}
function fail(msg) {
  console.error(`seed-demo: ${msg}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const demoUsers = [
  { key: "admin", email: `demo.admin@${DEMO_DOMAIN}`, name: "Demo Admin (synthetic)" },
  { key: "m1", email: `demo.member1@${DEMO_DOMAIN}`, name: "Demo Member One (synthetic)" },
  { key: "m2", email: `demo.member2@${DEMO_DOMAIN}`, name: "Demo Member Two (synthetic)" },
  { key: "m3", email: `demo.member3@${DEMO_DOMAIN}`, name: "Demo Member Three (synthetic)" },
];

const triggerTables = ["projects", "project_events", "comments", "project_assignees"];

async function resetDemo() {
  await client.query("begin");
  try {
    for (const t of triggerTables) await client.query(`alter table ${t} disable trigger user`);
    const ids = `select id from projects where created_by in (select id from profiles where email like '%@${DEMO_DOMAIN}')`;
    await client.query(`delete from project_events where project_id in (${ids})`);
    await client.query(`delete from comments where project_id in (${ids})`);
    await client.query(`delete from project_assignees where project_id in (${ids})`);
    await client.query(`delete from projects where id in (${ids})`);
    for (const t of triggerTables) await client.query(`alter table ${t} enable trigger user`);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

try {
  const existing = await client.query(
    `select count(*)::int n from projects where created_by in (select id from profiles where email like '%@${DEMO_DOMAIN}')`,
  );
  if (existing.rows[0].n > 0) {
    if (!args.has("--reset")) fail("demo data already exists. Re-run with --reset to replace it.");
    await resetDemo();
    console.log("Removed previous demo data.");
  }

  // Demo accounts. The admin allowlist is what makes demo.admin an admin: same path as real admins.
  await client.query("insert into admin_emails (email) values ($1) on conflict do nothing", [demoUsers[0].email]);
  const id = {};
  for (const u of demoUsers) {
    const r = await client.query(
      `insert into profiles (email, display_name) values ($1, $2)
       on conflict (email) do update set display_name = excluded.display_name returning id`,
      [u.email, u.name],
    );
    id[u.key] = r.rows[0].id;
  }

  // Time layout: "old" events sit before this week's Monday 00:00; "this week" events are spread
  // between Monday 00:00 and now, so the summary always has a start-vs-now difference to show.
  const now = DateTime.now().setZone(ZONE);
  const monday = now.startOf("week");
  const old = (days, hours = 0) => monday.minus({ days }).plus({ hours }).toJSDate();
  const week = (f) => new Date(monday.toMillis() + (now.toMillis() - monday.toMillis()) * f);
  const today = now.startOf("day");
  const dateIn = (d) => today.plus({ days: d }).toISODate();

  // Each step runs as one transaction acting as one user, like a real request. Its timestamp is
  // applied afterwards (below) because now() inside a transaction cannot be faked.
  const steps = []; // { stamp: Date (txn now()), at: Date, firstEventId }
  async function step(at, actor, fn) {
    await client.query("begin");
    try {
      await client.query("select set_config('app.user_id', $1, true)", [id[actor]]);
      // Keep the full microsecond precision as text: a JS Date would truncate it and the match below would miss.
      const stamp = (await client.query("select now()::text as t")).rows[0].t;
      const first = (await client.query("select coalesce(max(id), 0) as m from project_events")).rows[0].m;
      await fn(client);
      await client.query("commit");
      steps.push({ stamp, at, first: Number(first) });
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  const newProject = async (c, actor, p) =>
    (await c.query(
      `insert into projects (name, description, status, priority, deadline, next_step, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [p.name, p.description ?? "", p.status ?? "not_started", p.priority ?? "normal", p.deadline ?? null, p.next_step ?? "", id[actor]],
    )).rows[0].id;
  const assign = (c, pid, ...keys) => Promise.all(keys.map((k) => c.query("insert into project_assignees (project_id, user_id, assigned_by) values ($1,$2,$3)", [pid, id[k], id.admin])));
  const comment = (c, pid, actor, body) => c.query("insert into comments (project_id, author_id, body) values ($1,$2,$3)", [pid, id[actor], body]);
  const set = (c, pid, sql, ...vals) => c.query(`update projects set ${sql} where id = $1`, [pid, ...vals]);
  const P = {};

  // 1. Opening checklist: created by a member, later assigned by the admin to two members.
  await step(old(9), "m1", async (c) => { P.checklist = await newProject(c, "m1", { name: "[DEMO] Refresh the opening checklist", description: "Synthetic example project.", next_step: "Draft new checklist" }); });
  await step(old(9, 1), "admin", (c) => assign(c, P.checklist, "m1", "m2"));
  await step(old(8), "m1", (c) => set(c, P.checklist, "status = 'in_progress'"));
  await step(week(0.3), "m2", (c) => set(c, P.checklist, "next_step = $2", "Trial the checklist on one shift"));
  await step(week(0.35), "admin", (c) => comment(c, P.checklist, "admin", "Looks good. Please share a photo of the trial run."));

  // 2. Catering layout: becomes blocked this week, with a missed deadline.
  await step(old(6), "admin", async (c) => { P.catering = await newProject(c, "admin", { name: "[DEMO] Redesign catering menu layout", priority: "high", next_step: "Choose a template" }); });
  await step(old(6, 1), "admin", (c) => assign(c, P.catering, "m2"));
  await step(old(5), "m2", (c) => set(c, P.catering, "status = 'in_progress'"));
  await step(old(4), "admin", (c) => set(c, P.catering, "deadline = $2", dateIn(-2)));
  await step(week(0.4), "m2", (c) => set(c, P.catering, "status = 'blocked', next_step = $2", "Waiting on sample proofs"));
  await step(week(0.42), "m2", (c) => comment(c, P.catering, "m2", "Blocked until the printer sends sample proofs."));

  // 3. A private member project that other members must not see; gets an approaching deadline.
  await step(old(3), "m3", async (c) => { P.soap = await newProject(c, "m3", { name: "[DEMO] Compare two hand-soap options (private to creator)", next_step: "List options" }); });
  await step(week(0.2), "m3", (c) => set(c, P.soap, "status = 'in_progress'"));
  await step(week(0.5), "m3", (c) => set(c, P.soap, "deadline = $2", dateIn(3)));

  // 4. Completed this week.
  await step(old(14), "admin", async (c) => { P.allergen = await newProject(c, "admin", { name: "[DEMO] Update allergen sign templates", status: "in_progress", next_step: "Send final files" }); });
  await step(old(14, 1), "admin", (c) => assign(c, P.allergen, "m1"));
  await step(week(0.55), "m1", (c) => comment(c, P.allergen, "m1", "Final files sent."));
  await step(week(0.6), "m1", (c) => set(c, P.allergen, "status = 'done', next_step = ''"));

  // 5. Created this week, assigned to two members at once.
  await step(week(0.15), "admin", async (c) => { P.patio = await newProject(c, "admin", { name: "[DEMO] Plan spring patio setup", description: "Synthetic example project.", priority: "high", deadline: dateIn(25), next_step: "Walk the space" }); });
  await step(week(0.16), "admin", (c) => assign(c, P.patio, "m2", "m3"));

  // 6. Fellowship-style example, assigned to one member.
  await step(old(10), "admin", async (c) => { P.fellow = await newProject(c, "admin", { name: "[DEMO] Fellowship: roll out the project tracker", status: "in_progress", deadline: dateIn(20), next_step: "Run a staff walkthrough" }); });
  await step(old(10, 1), "admin", (c) => assign(c, P.fellow, "m1"));

  // 7. A cancelled and archived project (kept, never deleted).
  await step(old(20), "m2", async (c) => { P.signage = await newProject(c, "m2", { name: "[DEMO] Review old signage (cancelled)", next_step: "" }); });
  await step(old(10), "m2", (c) => set(c, P.signage, "status = 'cancelled'"));
  await step(old(9), "m2", (c) => set(c, P.signage, "archived_at = now()"));

  // Apply the intended timestamps. This is an owner-only operation done once, inside one
  // transaction, with the append-only/history triggers switched off and back on.
  await client.query("begin");
  try {
    for (const t of triggerTables) await client.query(`alter table ${t} disable trigger user`);
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const nextFirst = i + 1 < steps.length ? steps[i + 1].first : Infinity;
      await client.query("update project_events set occurred_at = $1 where id > $2 and id <= $3", [s.at, s.first, nextFirst === Infinity ? 2 ** 53 : nextFirst]);
      await client.query("update projects set created_at = $1 where created_at = $2::timestamptz", [s.at, s.stamp]);
      await client.query("update projects set updated_at = $1 where updated_at = $2::timestamptz", [s.at, s.stamp]);
      await client.query("update comments set created_at = $1 where created_at = $2::timestamptz", [s.at, s.stamp]);
      await client.query("update project_assignees set assigned_at = $1 where assigned_at = $2::timestamptz", [s.at, s.stamp]);
      if (P.signage) await client.query("update projects set archived_at = $1 where archived_at = $2::timestamptz", [s.at, s.stamp]);
    }
    for (const t of triggerTables) await client.query(`alter table ${t} enable trigger user`);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  }

  console.log(`Seeded ${Object.keys(P).length} synthetic projects and ${demoUsers.length} synthetic accounts.`);
  console.log(`Add "${DEMO_DOMAIN}" to ALLOWED_EMAIL_DOMAINS in .env.local to sign in as them (local demo only):`);
  for (const u of demoUsers) console.log(`  ${u.email}${u.key === "admin" ? "  (admin)" : ""}`);
} finally {
  await client.end();
}
