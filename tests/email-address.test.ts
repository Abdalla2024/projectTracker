import { describe, expect, it } from "vitest";
import { checkEmail, parseAllowedDomains } from "@/lib/email-address";

const domains = parseAllowedDomains(" Example-Org.test , @other.test ");

describe("checkEmail", () => {
  it("parses configurable domains", () => {
    expect(domains).toEqual(["example-org.test", "other.test"]);
    expect(parseAllowedDomains(undefined)).toEqual([]);
  });
  it("accepts an allowed domain and normalizes case and whitespace", () => {
    expect(checkEmail("  Some.Person@EXAMPLE-ORG.test ", domains)).toEqual({ ok: true, email: "some.person@example-org.test" });
  });
  it("rejects other domains, lookalikes and subdomains", () => {
    for (const e of ["a@gmail.com", "a@example-org.test.evil.com", "a@evil-example-org.test", "a@mail.example-org.test"]) {
      expect(checkEmail(e, domains).ok, e).toBe(false);
    }
  });
  it("rejects plus aliases, multiple @, and malformed input", () => {
    for (const e of ["a+x@example-org.test", "a@b@example-org.test", "nodomain", "@example-org.test", ""]) {
      expect(checkEmail(e, domains).ok, e).toBe(false);
    }
  });
  it("rejects everything when no domain is configured", () => {
    expect(checkEmail("a@example-org.test", []).ok).toBe(false);
  });
});
