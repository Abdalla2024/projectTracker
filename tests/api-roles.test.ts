// Regression test for a real exposure found while preparing the Supabase deployment: hosted providers
// create API roles (anon, authenticated, service_role) with default privileges on everything the owner
// creates, so their public API could call our SECURITY DEFINER sign-in functions. Migration 005 and the
// check in scripts/lib/migrate.mjs must keep those roles out.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JS module shared with the setup scripts
import { API_ROLES, findApiRoleExposure } from "../scripts/lib/migrate.mjs";
import { dropDatabaseAndRoles, migrateToLatest, owner, resetDatabase } from "./helpers/db";

const createdRoles: string[] = [];
// Impersonating a role needs superuser (or membership). When the test owner can't, those tests are skipped
// (visibly); the catalog-based exposure test still covers every function and table.
let canImpersonate = false;

/** Run statements as one of the API roles on the owner (superuser) connection, like the provider's API does. */
async function asApiRole<T>(role: string, fn: (q: (sql: string, p?: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T> {
  const c = await owner.connect();
  try {
    await c.query(`set role ${role}`);
    return await fn((sql, p) => c.query(sql, p));
  } finally {
    await c.query("reset role").catch(() => {});
    c.release();
  }
}

beforeAll(async () => {
  await resetDatabase({ upTo: "000" }); // empty database, no migrations yet
  for (const r of API_ROLES as string[]) {
    const has = await owner.query("select 1 from pg_roles where rolname = $1", [r]);
    if (!has.rowCount) {
      await owner.query(`create role ${r} nologin`);
      createdRoles.push(r);
    }
  }
  // The provider's defaults, in place BEFORE our migrations run: everything new is granted to the API roles.
  for (const obj of ["tables", "sequences", "functions"]) {
    await owner.query(`alter default privileges in schema public grant all on ${obj} to anon, authenticated, service_role`);
  }
  await migrateToLatest();
  const c = await owner.connect();
  try {
    await c.query("set role anon");
    canImpersonate = true;
  } catch {
    canImpersonate = false;
  } finally {
    await c.query("reset role").catch(() => {});
    c.release();
  }
});
afterAll(() => dropDatabaseAndRoles(createdRoles));

describe("provider API roles (anon, authenticated, service_role)", () => {
  it("can reach nothing of ours after migrations, even though default grants were in place", async () => {
    const c = await owner.connect();
    try {
      expect(await findApiRoleExposure(c)).toEqual([]);
    } finally {
      c.release();
    }
  });

  it("cannot run the sign-in functions (the attack: choose your own code hash and domain list)", async (ctx) => {
    if (!canImpersonate) ctx.skip();
    for (const role of API_ROLES as string[]) {
      await expect(
        asApiRole(role, (q) => q("select auth_request_login_code('victim@tracker.test', 'chosen-hash', 600)")),
        role,
      ).rejects.toThrow(/permission denied for function/);
      await expect(
        asApiRole(role, (q) => q("select auth_set_password('victim@tracker.test', 'chosen-hash', array['tracker.test'], 'my-session', 3600, '{}', 's', 'h')")),
        role,
      ).rejects.toThrow(/permission denied for function/);
    }
  });

  it("cannot read our tables", async (ctx) => {
    if (!canImpersonate) ctx.skip();
    for (const role of API_ROLES as string[]) {
      for (const table of ["profiles", "projects", "comments", "project_events", "sessions", "login_codes", "schema_migrations"]) {
        await expect(asApiRole(role, (q) => q(`select * from ${table}`)), `${role} ${table}`).rejects.toThrow(/permission denied/);
      }
    }
  });

  it("objects created by later migrations are born closed to those roles", async () => {
    await owner.query("create table zz_later_table (a int); create function zz_later_fn() returns int language sql as 'select 1'");
    try {
      const r = await owner.query(
        `select has_table_privilege('anon', 'zz_later_table', 'SELECT') t, has_function_privilege('authenticated', 'zz_later_fn()', 'EXECUTE') f`,
      );
      expect(r.rows[0]).toEqual({ t: false, f: false });
    } finally {
      await owner.query("drop table zz_later_table; drop function zz_later_fn()");
    }
  });

  it("setup fails loudly if any of them regains access, and passes again once it is removed", async () => {
    await owner.query("grant execute on function app_user_id() to authenticated");
    await expect(migrateToLatest()).rejects.toThrow(/API roles can still reach.*authenticated -> function app_user_id/);
    await owner.query("revoke execute on function app_user_id() from authenticated");
    await expect(migrateToLatest()).resolves.toBeUndefined();
  });

  it("ignores event-trigger functions, which cannot be called directly (the provider ships one in public)", async () => {
    await owner.query("create function zz_evt() returns event_trigger language plpgsql as 'begin end'; grant execute on function zz_evt() to anon");
    try {
      const c = await owner.connect();
      try { expect(await findApiRoleExposure(c)).toEqual([]); } finally { c.release(); }
    } finally {
      await owner.query("drop function zz_evt()");
    }
  });

  it("does not affect the app's own restricted role", async () => {
    const r = await owner.query("select has_function_privilege('tracker_app', 'auth_resolve_session(text)', 'EXECUTE') f, has_table_privilege('tracker_app', 'projects', 'SELECT') t");
    expect(r.rows[0]).toEqual({ f: true, t: true });
  });
});
