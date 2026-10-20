import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module used by the setup/admin scripts
import { pgConfig } from "../scripts/lib/pgconfig.mjs";
import { connectionConfig } from "@/lib/db-ssl";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";
const URL_IN = "postgres://tracker_app.abcd1234:p%40ss%2Fw%3Ard@pooler.example.test:6543/postgres?sslmode=verify-full&uselibpqcompat=true&application_name=x";

// The app and the scripts must behave identically.
const impls: [string, (url: string, ca?: string) => { connectionString: string; ssl?: unknown }][] = [
  ["app (lib/db-ssl.ts)", (url, ca) => connectionConfig(url, ca)],
  ["scripts (pgconfig.mjs)", (url, ca) => pgConfig(url, { DATABASE_CA_CERT: ca })],
];

describe.each(impls)("TLS settings: %s", (_name, build) => {
  it("without a CA leaves the URL exactly as given", () => {
    expect(build(URL_IN)).toEqual({ connectionString: URL_IN });
    expect(build(URL_IN, "   ")).toEqual({ connectionString: URL_IN });
  });

  it("with a CA keeps verification ON, using that CA", () => {
    const c = build(URL_IN, PEM);
    expect(c.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it("removes the URL's own ssl settings (they would override the explicit ones) but keeps everything else", () => {
    const u = new URL(build(URL_IN, PEM).connectionString);
    expect(u.searchParams.has("sslmode")).toBe(false);
    expect(u.searchParams.has("uselibpqcompat")).toBe(false);
    expect(u.searchParams.get("application_name")).toBe("x");
    expect(u.username).toBe("tracker_app.abcd1234");
    expect(decodeURIComponent(u.password)).toBe("p@ss/w:rd"); // special characters survive
    expect(u.host).toBe("pooler.example.test:6543");
    expect(u.pathname).toBe("/postgres");
  });

  it("accepts a PEM stored on one line with \\n escapes (how an env var is often saved)", () => {
    expect(build(URL_IN, PEM.replace(/\n/g, "\\n")).ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it("refuses a value that is not a certificate rather than silently connecting unverified", () => {
    expect(() => build(URL_IN, "not a certificate")).toThrow(/PEM certificate/);
    expect(() => build(URL_IN, "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----")).toThrow(/PEM certificate/);
  });
});
