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
if (!url) fail("DATABASE_ADMIN_URL is not set.");
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

const triggerTables = ["projects", "project_events", "comments", "project_assignees", "tasks", "sections", "nightly_reports"];
const DEMO_PREFIX = "[DEMO] ";

async function resetDemo() {
  await client.query("begin");
  try {
    for (const t of triggerTables) await client.query(`alter table ${t} disable trigger user`);
    const ids = `select id from projects where created_by in (select id from profiles where email like '%@${DEMO_DOMAIN}')`;
    await client.query(`delete from nightly_reports where submitted_by in (select id from profiles where email like '%@${DEMO_DOMAIN}')`);
    await client.query(`delete from tasks where project_id in (${ids})`);
    await client.query(`delete from sections where project_id in (${ids})`);
    await client.query(`delete from project_events where project_id in (${ids})`);
    await client.query(`delete from comments where project_id in (${ids})`);
    await client.query(`delete from project_assignees where project_id in (${ids})`);
    await client.query(`delete from projects where id in (${ids})`);
    // Demo locations and teams, unless something real still points at them.
    await client.query(`delete from locations l where l.name like '[DEMO]%' and not exists (select 1 from projects p where p.location_id = l.id) and not exists (select 1 from nightly_reports r where r.location_id = l.id)`);
    await client.query(`delete from teams t where t.name like '[DEMO]%' and not exists (select 1 from projects p where p.team_id = t.id)`);
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
      `insert into projects (name, description, status, priority, deadline, next_step, phase, progress, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [p.name, p.description ?? "", p.status ?? "not_started", p.priority ?? "normal", p.deadline ?? null, p.next_step ?? "", p.phase ?? "", p.progress ?? 0, id[actor]],
    )).rows[0].id;
  const assign = (c, pid, ...keys) => Promise.all(keys.map((k) => c.query("insert into project_assignees (project_id, user_id, assigned_by) values ($1,$2,$3)", [pid, id[k], id.admin])));
  const comment = (c, pid, actor, body) => c.query("insert into comments (project_id, author_id, body) values ($1,$2,$3)", [pid, id[actor], body]);
  const set = (c, pid, sql, ...vals) => c.query(`update projects set ${sql} where id = $1`, [pid, ...vals]);
  const P = {};

  // 1. Opening checklist: created by a member, later assigned by the admin to two members.
  await step(old(9), "m1", async (c) => { P.checklist = await newProject(c, "m1", { name: "[DEMO] Refresh the opening checklist", description: "Synthetic example project.", next_step: "Draft new checklist", phase: "Drafting", progress: 40 }); });
  await step(old(9, 1), "admin", (c) => assign(c, P.checklist, "m1", "m2"));
  await step(old(8), "m1", (c) => set(c, P.checklist, "status = 'in_progress'"));
  await step(week(0.3), "m2", (c) => set(c, P.checklist, "next_step = $2", "Trial the checklist on one shift"));
  await step(week(0.35), "admin", (c) => comment(c, P.checklist, "admin", "Looks good. Please share a photo of the trial run."));

  // 2. Catering layout: becomes blocked this week, with a missed deadline.
  await step(old(6), "admin", async (c) => { P.catering = await newProject(c, "admin", { name: "[DEMO] Redesign catering menu layout", priority: "high", next_step: "Choose a template", phase: "Print proofs", progress: 35 }); });
  await step(old(6, 1), "admin", (c) => assign(c, P.catering, "m2"));
  await step(old(5), "m2", (c) => set(c, P.catering, "status = 'in_progress'"));
  await step(old(4), "admin", (c) => set(c, P.catering, "deadline = $2", dateIn(-2)));
  await step(week(0.4), "m2", (c) => set(c, P.catering, "status = 'blocked', next_step = $2", "Waiting on sample proofs"));
  await step(week(0.42), "m2", (c) => comment(c, P.catering, "m2", "Stuck until the printer sends sample proofs."));

  // 3. A private member project that other members must not see; gets an approaching deadline.
  await step(old(3), "m3", async (c) => { P.soap = await newProject(c, "m3", { name: "[DEMO] Compare two hand-soap options (private to creator)", next_step: "List options", phase: "Researching", progress: 15 }); });
  await step(week(0.2), "m3", (c) => set(c, P.soap, "status = 'in_progress'"));
  await step(week(0.5), "m3", (c) => set(c, P.soap, "deadline = $2", dateIn(3)));

  // 4. Completed this week.
  await step(old(14), "admin", async (c) => { P.allergen = await newProject(c, "admin", { name: "[DEMO] Update allergen sign templates", status: "in_progress", next_step: "Send final files", phase: "Final files", progress: 80 }); });
  await step(old(14, 1), "admin", (c) => assign(c, P.allergen, "m1"));
  await step(week(0.55), "m1", (c) => comment(c, P.allergen, "m1", "Final files sent."));
  await step(week(0.6), "m1", (c) => set(c, P.allergen, "status = 'done', next_step = ''"));

  // 5. Created this week, assigned to two members at once.
  await step(week(0.15), "admin", async (c) => { P.patio = await newProject(c, "admin", { name: "[DEMO] Plan spring patio setup", description: "Synthetic example project.", priority: "high", deadline: dateIn(25), next_step: "Walk the space", phase: "Site walk", progress: 5 }); });
  await step(week(0.16), "admin", (c) => assign(c, P.patio, "m2", "m3"));

  // 6. Fellowship-style example, assigned to one member.
  await step(old(10), "admin", async (c) => { P.fellow = await newProject(c, "admin", { name: "[DEMO] Fellowship: roll out the project tracker", status: "in_progress", deadline: dateIn(20), next_step: "Run a staff walkthrough" }); });
  await step(old(10, 1), "admin", (c) => assign(c, P.fellow, "m1"));

  // 7. A cancelled and archived project (kept, never deleted).
  await step(old(20), "m2", async (c) => { P.signage = await newProject(c, "m2", { name: "[DEMO] Review old signage (cancelled)", next_step: "" }); });
  await step(old(10), "m2", (c) => set(c, P.signage, "status = 'cancelled'"));
  await step(old(9), "m2", (c) => set(c, P.signage, "archived_at = now()"));

  // 8. Organisation: synthetic locations (stores) and teams (positions). Names are placeholders.
  const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
  const LOC = {};
  for (const [i, n] of ["Location A", "Location B", "Location C", "Location D"].entries()) {
    LOC[n] = (await client.query(
      `insert into locations (name, color, sort_order) values ($1, $2, $3) on conflict (name) do update set color = excluded.color returning id`,
      [DEMO_PREFIX + n, COLORS[i], i])).rows[0].id;
  }
  const TEAM = {};
  for (const [i, [n, c]] of [["Operations", "#6250d6"], ["HR", "#e87ba4"], ["Chief of Staff", "#008300"], ["Marketing", "#e34948"]].entries()) {
    TEAM[n] = (await client.query(
      `insert into teams (name, color, sort_order) values ($1, $2, $3) on conflict (name) do update set color = excluded.color returning id`,
      [DEMO_PREFIX + n, c, i])).rows[0].id;
  }
  const file = [
    [P.checklist, "Location A", "Operations"], [P.catering, "Location B", "Marketing"], [P.soap, "Location C", "Operations"],
    [P.allergen, "Location A", "Chief of Staff"], [P.patio, "Location D", "Operations"], [P.fellow, null, "Chief of Staff"], [P.signage, "Location B", null],
  ];
  await step(old(12, 2), "admin", async (c) => {
    for (const [pid, l, t] of file) {
      await c.query("update projects set location_id = $2, team_id = $3 where id = $1", [pid, l ? LOC[l] : null, t ? TEAM[t] : null]);
    }
  });

  // 9. Sections and tasks (Asana-style), with a few finished this week.
  const T = {};
  const task = async (c, pid, title, extra = {}) =>
    (await c.query(
      `insert into tasks (project_id, section_id, parent_id, title, assignee_id, due_date, created_by, sort_order)
       values ($1,$2,$3,$4,$5,$6,app_user_id(), coalesce((select max(sort_order) + 1 from tasks where project_id = $1), 0)) returning id`,
      [pid, extra.section ?? null, extra.parent ?? null, title, extra.who ? id[extra.who] : null, extra.due ?? null])).rows[0].id;
  await step(old(8), "admin", async (c) => {
    const todo = (await c.query("insert into sections (project_id, name, sort_order) values ($1, 'To do', 0) returning id", [P.patio])).rows[0].id;
    const doing = (await c.query("insert into sections (project_id, name, sort_order) values ($1, 'Doing', 1) returning id", [P.patio])).rows[0].id;
    T.measure = await task(c, P.patio, "Measure the patio", { section: doing, who: "m2", due: dateIn(-1) });
    T.quotes = await task(c, P.patio, "Get two furniture quotes", { section: todo, who: "m3", due: dateIn(5) });
    T.heaters = await task(c, P.patio, "Check heater permits", { section: todo, who: "m2", due: dateIn(12) });
    T.q1 = await task(c, P.patio, "Quote from vendor 1", { parent: T.quotes, who: "m3" });
    T.q2 = await task(c, P.patio, "Quote from vendor 2", { parent: T.quotes, who: "m3" });
    T.draft = await task(c, P.checklist, "Draft the opening checklist", { who: "m1", due: dateIn(-2) });
    T.trial = await task(c, P.checklist, "Trial on one shift", { who: "m2", due: dateIn(3) });
    T.print = await task(c, P.catering, "Get print proofs", { who: "m2", due: dateIn(-3) });
    T.walk = await task(c, P.fellow, "Run a staff walkthrough", { who: "m1", due: dateIn(2) });
    T.train = await task(c, P.fellow, "Write a one-page how-to", { who: "m1", due: dateIn(6) });
  });
  await step(week(0.3), "m1", (c) => c.query("update tasks set completed_at = now() where id = $1", [T.draft]));
  await step(week(0.4), "m3", (c) => c.query("update tasks set completed_at = now() where id = any($1)", [[T.q1]]));
  await step(week(0.5), "m2", (c) => c.query("update tasks set completed_at = now() where id = $1", [T.measure]));

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
      await client.query("update tasks set created_at = $1 where created_at = $2::timestamptz", [s.at, s.stamp]);
      await client.query("update tasks set updated_at = $1 where updated_at = $2::timestamptz", [s.at, s.stamp]);
      await client.query("update tasks set completed_at = $1 where completed_at = $2::timestamptz", [s.at, s.stamp]);
      await client.query("update sections set created_at = $1 where created_at = $2::timestamptz", [s.at, s.stamp]);
      if (P.signage) await client.query("update projects set archived_at = $1 where archived_at = $2::timestamptz", [s.at, s.stamp]);
    }
    for (const t of triggerTables) await client.query(`alter table ${t} enable trigger user`);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  }

  // 10. Nightly reports: about four months of made-up nights for the four demo locations. The numbers
  // follow simple synthetic patterns (weekends busier, bad weather quieter) so the charts show something.
  let seed = 20261021;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const base = { "Location A": 4200, "Location B": 3600, "Location C": 5100, "Location D": 2900 };
  const owner = { "Location A": "m1", "Location B": "m2", "Location C": "m3", "Location D": "m1" };
  const dayMult = [0.85, 0.9, 0.95, 1.0, 1.3, 1.4, 1.15]; // Mon..Sun
  const weatherMult = { sunny: 1.08, partly_cloudy: 1.04, cloudy: 1.0, fog: 0.95, windy: 0.96, rain: 0.82, storm: 0.66, snow: 0.6 };
  const feedback = ["Guests loved the new special.", "Two complaints about wait times at the counter.", "Regular asked about gluten-free options.", "Compliment on friendly service."];
  const staffing = ["One call-out on the dinner shift.", "Short one line cook from 6pm.", "New hire shadowed the closing shift.", "Late arrival, covered by the opener."];
  const waste = ["Over-prepped rice; about two pans thrown out.", "Dropped tray of sauce, one batch.", "Expired herbs discarded.", "Normal closing waste."];
  const events = ["Catering order for a demo office lunch on Friday.", "Local street fair next weekend.", "Holiday hours start next week.", "School event nearby on Thursday."];
  await client.query("begin");
  try {
    await client.query("select set_config('app.user_id', $1, true)", [id.admin]);
    let n = 0;
    for (let back = 120; back >= 1; back--) {
      const day = today.minus({ days: back });
      const doy = day.ordinal;
      const meanT = 56 - 22 * Math.cos((2 * Math.PI * (doy - 20)) / 365);
      const temp = Math.round(meanT + (rnd() - 0.5) * 14);
      const weather = temp < 33 && rnd() < 0.25 ? "snow" : pick(["sunny", "sunny", "partly_cloudy", "partly_cloudy", "cloudy", "cloudy", "rain", "rain", "windy", "fog", "storm"]);
      for (const [name, lid] of Object.entries(LOC)) {
        if (back <= 6 && rnd() < 0.12) continue; // a few recent nights missing, so the dashboard shows gaps
        const tempMult = 1 + Math.max(-0.12, Math.min(0.08, (temp - 60) / 250));
        const sales = Math.round(base[name] * dayMult[day.weekday - 1] * weatherMult[weather] * tempMult * (0.9 + rnd() * 0.2) * 100) / 100;
        const ticket = Math.round((8 + (sales / base[name]) * 9 + rnd() * 8) * 2) / 2;
        const maybe = (xs, p) => (rnd() < p ? pick(xs) : "");
        await client.query(
          `insert into nightly_reports (location_id, report_date, sales, manager_on_duty, weather, temperature_f, longest_ticket_minutes,
             general_notes, customer_feedback, staffing_issues, waste_log, upcoming_events, submitted_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [lid, day.toISODate(), sales, `Demo Manager ${name.slice(-1)}${1 + (day.weekday % 2)}`, weather, temp, ticket,
           maybe(["Steady night.", "Busy dinner rush.", "Quiet after 8pm."], 0.6), maybe(feedback, 0.3), maybe(staffing, 0.2), maybe(waste, 0.35), maybe(events, 0.12), id[owner[name]]],
        );
        n++;
      }
    }
    await client.query("commit");
    console.log(`Seeded ${n} synthetic nightly reports for 4 demo locations.`);
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
