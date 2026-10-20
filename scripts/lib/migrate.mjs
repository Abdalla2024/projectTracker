// Creates the database (if missing), the restricted runtime role, and applies SQL migrations.
// Runs as the database owner (DATABASE_ADMIN_URL). The web app never uses these credentials.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const APP_ROLE = "tracker_app";
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
  let client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
  } catch (err) {
    if (err.code !== "3D000") throw err; // 3D000 = database does not exist
    const maint = new pg.Client({ connectionString: withDatabase(adminUrl, "postgres") });
    await maint.connect();
    try {
      await maint.query(`create database ${pg.escapeIdentifier(dbName)}`);
      log(`created database ${dbName}`);
    } finally {
      await maint.end();
    }
    client = new pg.Client({ connectionString: adminUrl });
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
  } finally {
    await client.end();
  }
  return applied;
}
