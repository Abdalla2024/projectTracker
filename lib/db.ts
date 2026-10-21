import "server-only";
import pg from "pg";
import { connectionConfig } from "./db-ssl";

// Every query from the web app goes through withUser() / withoutUser(). The connection is the
// restricted `tracker_app` role, so row-level security applies to everything run here.

const globalForPool = globalThis as unknown as { __trackerPool?: pg.Pool; __trackerPoolChecked?: Promise<void> };

/** Max connections per server instance. Serverless hosts run many instances, so keep this small there (see docs). */
function poolMax(): number {
  const n = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 20) : 10;
}

function pool(): pg.Pool {
  if (!globalForPool.__trackerPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    globalForPool.__trackerPool = new pg.Pool({ ...connectionConfig(url, process.env.DATABASE_CA_CERT), max: poolMax() });
  }
  return globalForPool.__trackerPool;
}

/** Refuse to run on a connection that would bypass row-level security (e.g. a superuser or owner login). */
async function assertRestrictedRole(p: pg.Pool) {
  globalForPool.__trackerPoolChecked ??= (async () => {
    const r = await p.query(
      `select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    const row = r.rows[0];
    if (row.rolsuper || row.rolbypassrls) {
      throw new Error(
        `DATABASE_URL connects as "${row.name}", which can bypass row-level security. ` +
          `Use the restricted app role created by "npm run db:setup" (DATABASE_ADMIN_URL is for migrations only).`,
      );
    }
    const owns = await p.query(`select 1 from pg_tables where tablename = 'projects' and tableowner = current_user`);
    if (owns.rowCount) {
      throw new Error(`DATABASE_URL connects as the table owner, which bypasses row-level security. Use the app role.`);
    }
  })();
  await globalForPool.__trackerPoolChecked;
}

async function run<T>(userId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const p = pool();
  await assertRestrictedRole(p);
  const client = await p.connect();
  try {
    await client.query("begin");
    // Transaction-local: cleared automatically at commit/rollback, so it cannot leak between requests.
    if (userId) await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Run queries as a signed-in user. Row-level security decides what they can see and change. */
export const withUser = <T>(userId: string, fn: (c: pg.PoolClient) => Promise<T>) => run(userId, fn);

/** Run queries with no user (only the auth_* functions are callable this way). */
export const withoutUser = <T>(fn: (c: pg.PoolClient) => Promise<T>) => run(null, fn);
