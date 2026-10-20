import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closePools, resetDatabase } from "./helpers/db";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://localhost:5432/ekiben_tracker_test";
const APP_URL = (() => {
  const u = new URL(ADMIN_URL);
  u.username = "tracker_app";
  u.password = "test-only-password";
  return u.toString();
})();

const env = process.env as Record<string, string | undefined>;
const saved = { ...env };
afterEach(() => {
  for (const k of ["DATABASE_URL", "EMAIL_TRANSPORT", "NODE_ENV", "AUTH_SECRET"]) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
  delete (globalThis as Record<string, unknown>).__trackerPool;
  delete (globalThis as Record<string, unknown>).__trackerPoolChecked;
  vi.resetModules();
});

describe("runtime database role", () => {
  beforeAll(() => resetDatabase());
  afterAll(closePools);

  it("refuses to run on a connection that can bypass row-level security (owner/superuser)", async () => {
    env.DATABASE_URL = ADMIN_URL;
    const { withoutUser } = await import("@/lib/db");
    await expect(withoutUser((c) => c.query("select 1"))).rejects.toThrow(/bypass row-level security/);
    const g = globalThis as unknown as { __trackerPool?: { end(): Promise<void> } };
    await g.__trackerPool?.end();
  });

  it("works with the restricted app role", async () => {
    env.DATABASE_URL = APP_URL;
    const { withoutUser } = await import("@/lib/db");
    const r = await withoutUser((c) => c.query("select current_user as u"));
    expect(r.rows[0].u).toBe("tracker_app");
    const g = globalThis as unknown as { __trackerPool?: { end(): Promise<void> } };
    await g.__trackerPool?.end();
  });
});

describe("email transport and secrets", () => {
  it("refuses the console (dev-only) email transport in production", async () => {
    env.NODE_ENV = "production";
    env.EMAIL_TRANSPORT = "console";
    const { emailTransport } = await import("@/lib/config");
    expect(() => emailTransport()).toThrow(/local development only/);
  });

  it("allows console in development and smtp in production", async () => {
    env.NODE_ENV = "development";
    env.EMAIL_TRANSPORT = "console";
    const { emailTransport } = await import("@/lib/config");
    expect(emailTransport()).toBe("console");
    env.NODE_ENV = "production";
    env.EMAIL_TRANSPORT = "smtp";
    expect(emailTransport()).toBe("smtp");
  });

  it("rejects a missing or placeholder AUTH_SECRET", async () => {
    const { authSecret } = await import("@/lib/config");
    delete env.AUTH_SECRET;
    expect(() => authSecret()).toThrow(/AUTH_SECRET/);
    env.AUTH_SECRET = "replace-with-a-long-random-string";
    expect(() => authSecret()).toThrow(/AUTH_SECRET/);
  });
});
