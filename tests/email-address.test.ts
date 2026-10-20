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

describe("checkEmail with a local-dev exact-address exception", () => {
  // Synthetic: a "consumer" mail domain that is NOT in the allowed domains.
  const exact = ["Dev.Person@mail.example"];

  it("accepts exactly that address, case-insensitively and trimmed", () => {
    for (const e of ["dev.person@mail.example", "  DEV.PERSON@MAIL.EXAMPLE  "]) {
      expect(checkEmail(e, domains, exact), e).toEqual({ ok: true, email: "dev.person@mail.example" });
    }
  });
  it("does not open the rest of that domain", () => {
    for (const e of ["other.person@mail.example", "dev.person2@mail.example", "xdev.person@mail.example", "dev.person@mail.example.evil.com"]) {
      expect(checkEmail(e, domains, exact).ok, e).toBe(false);
    }
  });
  it("rejects plus aliases of that address", () => {
    expect(checkEmail("dev.person+tag@mail.example", domains, exact).ok).toBe(false);
  });
  it("changes nothing for allowed domains, and nothing when no exception is configured", () => {
    expect(checkEmail("a@example-org.test", domains, exact).ok).toBe(true);
    expect(checkEmail("dev.person@mail.example", domains, []).ok).toBe(false);
    expect(checkEmail("dev.person@mail.example", domains).ok).toBe(false);
  });
});

