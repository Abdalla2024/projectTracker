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

  // 1. Create the database if it does not exist (needs CREATEDB; skipped quietly if it already exists).
  const maint = new pg.Client({ connectionString: withDatabase(adminUrl, "postgres") });
  await maint.connect();
  try {
    const { rowCount } = await maint.query("select 1 from pg_database where datname = $1", [dbName]);
    if (!rowCount) {
      await maint.query(`create database ${pg.escapeIdentifier(dbName)}`);
      log(`created database ${dbName}`);
    }
    // 2. Role is cluster-wide: create or refresh its password, and make sure it is not privileged.
    const role = await maint.query("select 1 from pg_roles where rolname = $1", [APP_ROLE]);
    const stmt = role.rowCount ? "alter role" : "create role";
    await maint.query(
      `${stmt} ${APP_ROLE} login password ${pg.escapeLiteral(appPassword)} nosuperuser nocreatedb nocreaterole nobypassrls`,
    );
    await maint.query(`grant connect on database ${pg.escapeIdentifier(dbName)} to ${APP_ROLE}`);
  } finally {
    await maint.end();
  }

  // 3. Apply pending migrations, each in its own transaction.
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const applied = [];
  try {
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
