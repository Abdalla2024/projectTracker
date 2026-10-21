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
  for (const k of ["DATABASE_URL", "EMAIL_TRANSPORT", "NODE_ENV", "AUTH_SECRET", "DEV_ALLOWED_EMAIL"]) {
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
    await expect(withoutUser((c) => c.query("select 1"))).rejects.toThrow(/bypass(es)? row-level security/);
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

describe("local-dev exact email exception (DEV_ALLOWED_EMAIL)", () => {
  it("is off when unset or blank", async () => {
    const { devAllowedEmails } = await import("@/lib/config");
    delete env.DEV_ALLOWED_EMAIL;
    expect(devAllowedEmails()).toEqual([]);
    env.DEV_ALLOWED_EMAIL = "   ";
    expect(devAllowedEmails()).toEqual([]);
  });

  it("yields the one address, lowercased and trimmed, outside production", async () => {
    const { devAllowedEmails } = await import("@/lib/config");
    env.NODE_ENV = "development";
    env.DEV_ALLOWED_EMAIL = "  Dev.Person@Mail.Example ";
    expect(devAllowedEmails()).toEqual(["dev.person@mail.example"]);
  });

  it("is refused in production, even though it is set to a valid address", async () => {
    const { devAllowedEmails } = await import("@/lib/config");
    env.NODE_ENV = "production";
    env.DEV_ALLOWED_EMAIL = "dev.person@mail.example";
    expect(() => devAllowedEmails()).toThrow(/local development only/);
  });

  it("is harmless in production when unset", async () => {
    const { devAllowedEmails } = await import("@/lib/config");
    env.NODE_ENV = "production";
    delete env.DEV_ALLOWED_EMAIL;
    expect(devAllowedEmails()).toEqual([]);
  });

  it("refuses values that would widen it: a domain, a wildcard, a list, a plus alias", async () => {
    const { devAllowedEmails } = await import("@/lib/config");
    env.NODE_ENV = "development";
    for (const bad of ["mail.example", "@mail.example", "*@mail.example", "a@mail.example,b@mail.example", "a@mail.example b@mail.example", "dev+tag@mail.example", "dev@localhost"]) {
      env.DEV_ALLOWED_EMAIL = bad;
      expect(() => devAllowedEmails(), bad).toThrow(/DEV_ALLOWED_EMAIL/);
    }
  });
});


describe("individual addresses allowed in any environment (ALLOWED_EMAILS)", () => {
  it("is off when unset or blank", async () => {
    const { allowedEmails } = await import("@/lib/config");
    delete env.ALLOWED_EMAILS;
    expect(allowedEmails()).toEqual([]);
    env.ALLOWED_EMAILS = "  ";
    expect(allowedEmails()).toEqual([]);
  });

  it("yields the exact addresses, lowercased and de-duplicated, including in production", async () => {
    const { allowedEmails, exactAllowedEmails } = await import("@/lib/config");
    env.NODE_ENV = "production";
    delete env.DEV_ALLOWED_EMAIL;
    env.ALLOWED_EMAILS = " Person.One@mail.example, person.two@mail.example ,person.one@mail.example";
    expect(allowedEmails()).toEqual(["person.one@mail.example", "person.two@mail.example"]);
    expect(exactAllowedEmails()).toEqual(["person.one@mail.example", "person.two@mail.example"]);
  });

  it("refuses values that would widen it: a domain, a wildcard, a plus alias", async () => {
    const { allowedEmails } = await import("@/lib/config");
    for (const bad of ["mail.example", "@mail.example", "*@mail.example", "a@mail.example, mail.example", "dev+tag@mail.example", "dev@localhost"]) {
      env.ALLOWED_EMAILS = bad;
      expect(() => allowedEmails(), bad).toThrow(/ALLOWED_EMAILS/);
    }
  });

  it("does not turn on the local-only dev exception in production", async () => {
    const { exactAllowedEmails } = await import("@/lib/config");
    env.NODE_ENV = "production";
    env.ALLOWED_EMAILS = "person.one@mail.example";
    env.DEV_ALLOWED_EMAIL = "dev.person@mail.example";
    expect(() => exactAllowedEmails()).toThrow(/local development only/);
  });
});
