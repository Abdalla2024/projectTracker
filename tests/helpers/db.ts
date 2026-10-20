// Test helper: builds a throwaway database from the real migrations and exposes two connections:
// `owner` (migrations/seed, like scripts) and the restricted `tracker_app` role the web app uses.
import pg from "pg";
// @ts-expect-error plain JS module shared with the setup scripts
import { setupDatabase, databaseName } from "../../scripts/lib/migrate.mjs";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://localhost:5432/ekiben_tracker_test";
const APP_PASSWORD = "test-only-password";

export const dbName: string = databaseName(ADMIN_URL);
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run tests against "${dbName}": test database name must end in _test`);
}

function appUrl() {
  const u = new URL(ADMIN_URL);
  u.username = "tracker_app";
  u.password = APP_PASSWORD;
  return u.toString();
}

export let owner: pg.Pool;
export let app: pg.Pool;

export async function resetDatabase(opts: { upTo?: string } = {}) {
  await closePools();
  const maintUrl = new URL(ADMIN_URL);
  maintUrl.pathname = "/postgres";
  const maint = new pg.Client({ connectionString: maintUrl.toString() });
  await maint.connect();
  try {
    await maint.query(`drop database if exists ${pg.escapeIdentifier(dbName)} with (force)`);
  } finally {
    await maint.end();
  }
  await setupDatabase({ adminUrl: ADMIN_URL, appPassword: APP_PASSWORD, upTo: opts.upTo });
  owner = new pg.Pool({ connectionString: ADMIN_URL, max: 4 });
  app = new pg.Pool({ connectionString: appUrl(), max: 4 });
}

export async function closePools() {
  await Promise.all([owner?.end(), app?.end()]);
  owner = undefined as unknown as pg.Pool;
  app = undefined as unknown as pg.Pool;
}

/** Run as the restricted app role with app.user_id set, in one transaction (like the web app). */
export async function asUser<T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("begin");
    if (userId) await c.query("select set_config('app.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

/** Owner-side change attributed to an actor (as scripts/seed would do). */
export async function asOwnerActing<T>(userId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await owner.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true)", [userId]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export async function addUser(email: string, name: string): Promise<{ id: string; role: string }> {
  const r = await owner.query("insert into profiles (email, display_name) values ($1, $2) returning id, role", [
    email,
    name,
  ]);
  return r.rows[0];
}

export async function createProject(userId: string, name: string, extra: Record<string, unknown> = {}) {
  return asUser(userId, async (c) => {
    const r = await c.query(
      `insert into projects (name, description, status, priority, deadline, next_step, created_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        name,
        extra.description ?? "",
        extra.status ?? "not_started",
        extra.priority ?? "normal",
        extra.deadline ?? null,
        extra.next_step ?? "",
        userId,
      ],
    );
    return r.rows[0].id as string;
  });
}

export const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

/** Apply any migrations not yet applied (used to test upgrading an existing database). */
export async function migrateToLatest() {
  await setupDatabase({ adminUrl: ADMIN_URL, appPassword: APP_PASSWORD });
}
