// Creates the database (if missing), the restricted runtime role, and applies SQL migrations.
// Runs as the database owner (DATABASE_ADMIN_URL). The web app never uses these credentials.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pgConfig } from "./pgconfig.mjs";

export const APP_ROLE = "tracker_app";
// Roles that hosted providers use for their public APIs. They must never reach our objects (see migration 005).
export const API_ROLES = ["anon", "authenticated", "service_role"];

/** Returns a list of "role -> object" exposures; empty when the API roles (if they exist) can reach nothing of ours. */
export async function findApiRoleExposure(client) {
  const exposed = [];
  // Separate simple queries (not one union): Postgres may evaluate a privilege function before a relkind filter.
  const tables = await client.query(
    `select c.oid, c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')`);
  const sequences = await client.query(
    `select c.oid, c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'`);
  const functions = await client.query(
    `select p.oid, p.proname as relname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
       and p.prorettype <> 'event_trigger'::regtype -- cannot be called directly (e.g. the provider's own rls_auto_enable)
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
  const existing = (await client.query("select rolname from pg_roles where rolname = any($1)", [API_ROLES])).rows.map((x) => x.rolname);
  for (const role of existing) {
    for (const t of tables.rows) {
      const ok = (await client.query("select has_table_privilege($1, $2::oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as ok", [role, t.oid])).rows[0].ok;
      if (ok) exposed.push(`${role} -> table ${t.relname}`);
    }
    for (const q of sequences.rows) {
      const ok = (await client.query("select has_sequence_privilege($1, $2::oid, 'USAGE,SELECT,UPDATE') as ok", [role, q.oid])).rows[0].ok;
      if (ok) exposed.push(`${role} -> sequence ${q.relname}`);
    }
    for (const f of functions.rows) {
      const ok = (await client.query("select has_function_privilege($1, $2::oid, 'EXECUTE') as ok", [role, f.oid])).rows[0].ok;
      if (ok) exposed.push(`${role} -> function ${f.relname}`);
    }
  }
  return exposed;
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "migrations");

function withDatabase(url, dbName) {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

export function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

// `upTo` (a migration file name) stops after that migration; used by tests to exercise upgrades.
export async function setupDatabase({ adminUrl, appPassword, upTo, log = () => {} }) {
  if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is not set");
  if (!appPassword) throw new Error("APP_DB_PASSWORD is not set");
  const dbName = databaseName(adminUrl);

  // 1. Connect to the target database. Only if it does not exist yet (local development) create it,
  //    through the maintenance database. On a hosted database it already exists and this step is skipped,
  //    so the owner login does not need the CREATEDB privilege.
  let client = new pg.Client(pgConfig(adminUrl));
  try {
    await client.connect();
  } catch (err) {
    if (err.code !== "3D000") throw err; // 3D000 = database does not exist
    const maint = new pg.Client(pgConfig(withDatabase(adminUrl, "postgres")));
    await maint.connect();
    try {
      await maint.query(`create database ${pg.escapeIdentifier(dbName)}`);
      log(`created database ${dbName}`);
    } finally {
      await maint.end();
    }
    client = new pg.Client(pgConfig(adminUrl));
    await client.connect();
  }

  const applied = [];
  try {
    // 2. The runtime role. CREATE ROLE already defaults to no superuser / createdb / createrole /
    //    bypassrls, so no privileged attributes are requested (hosted owners often cannot set them).
    //    Whatever happens, the role is then checked and setup fails if it is not a plain login role.
    const exists = (await client.query("select 1 from pg_roles where rolname = $1", [APP_ROLE])).rowCount > 0;
    await client.query(`${exists ? "alter role" : "create role"} ${APP_ROLE} login password ${pg.escapeLiteral(appPassword)}`);
    if (exists) {
      // Best effort: strip privileges from a role created by an older setup. Ignored where not permitted.
      await client.query(`alter role ${APP_ROLE} nosuperuser nocreatedb nocreaterole nobypassrls`).catch(() => {});
    }
    const attrs = (await client.query(
      "select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls from pg_roles where rolname = $1", [APP_ROLE])).rows[0];
    if (attrs.rolsuper || attrs.rolcreatedb || attrs.rolcreaterole || attrs.rolbypassrls) {
      throw new Error(`role ${APP_ROLE} has elevated privileges (${JSON.stringify(attrs)}); it must be a plain login role so row-level security applies`);
    }
    await client.query(`grant connect on database ${pg.escapeIdentifier(dbName)} to ${APP_ROLE}`).catch((e) => log(`note: could not grant CONNECT (${e.message}); usually fine, PUBLIC can connect`));

    // 3. Apply pending migrations, each in its own transaction.
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && (!upTo || f <= upTo)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }

    // 4. Fail loudly if a provider API role can still reach any of our objects.
    const exposed = await findApiRoleExposure(client);
    if (exposed.length) {
      throw new Error(
        `provider API roles can still reach this app's objects (${exposed.length}), which would bypass its sign-in checks. First: ${exposed.slice(0, 5).join("; ")}`,
      );
    }
  } finally {
    await client.end();
  }
  return applied;
}
