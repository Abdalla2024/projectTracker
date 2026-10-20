import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closePools, owner, resetDatabase } from "./helpers/db";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://localhost:5432/ekiben_tracker_test";
const APP_URL = (() => {
  const u = new URL(ADMIN_URL);
  u.username = "tracker_app";
  u.password = "test-only-password";
  return u.toString();
})();
const env = process.env as Record<string, string | undefined>;
const savedUrl = env.DATABASE_URL;

async function callHealth(url: string) {
  env.DATABASE_URL = url;
  delete (globalThis as Record<string, unknown>).__trackerPool;
  delete (globalThis as Record<string, unknown>).__trackerPoolChecked;
  vi.resetModules();
  const { GET } = await import("@/app/api/health/route");
  const res = await GET();
  const g = globalThis as unknown as { __trackerPool?: { end(): Promise<void> } };
  await g.__trackerPool?.end().catch(() => {});
  return { status: res.status, body: await res.text(), cache: res.headers.get("cache-control") };
}

beforeAll(() => resetDatabase());
afterAll(closePools);
afterEach(() => { if (savedUrl === undefined) delete env.DATABASE_URL; else env.DATABASE_URL = savedUrl; });

describe("GET /api/health", () => {
  it("reports connected with row-level security on, as the restricted role", async () => {
    const r = await callHealth(APP_URL);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, database: "connected", rowLevelSecurity: true });
    expect(r.cache).toBe("no-store");
  });

  it("fails (503) with no detail when connected as a privileged/owner role", async () => {
    const r = await callHealth(ADMIN_URL);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ ok: false });
    expect(r.body).not.toMatch(/tracker|owner|postgres|password/i);
  });

  it("fails (503) with no detail when the database is unreachable", async () => {
    const r = await callHealth("postgres://tracker_app:x@127.0.0.1:1/none");
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ ok: false });
  });

  it("fails (503) if row-level security is off on projects", async () => {
    await owner.query("alter table projects disable row level security");
    try {
      const r = await callHealth(APP_URL);
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toMatchObject({ ok: false, rowLevelSecurity: false });
    } finally {
      await owner.query("alter table projects enable row level security");
    }
  });
});
