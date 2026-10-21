import { beforeAll, describe, expect, it } from "vitest";
import { checkPassword, fakeSalt, hashPassword, newSalt } from "@/lib/password";

beforeAll(() => { process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123456"; });

describe("password rules", () => {
  it("requires 10 to 128 characters and rejects the email or its local part", () => {
    expect(checkPassword("short", "a@b.test")).toMatch(/at least 10/);
    expect(checkPassword("x".repeat(129), "a@b.test")).toMatch(/at most 128/);
    expect(checkPassword("correct horse battery", "a@b.test")).toBeNull();
    expect(checkPassword("person@tracker.test", "person@tracker.test")).toMatch(/email/);
    expect(checkPassword("longpersonname", "longpersonname@tracker.test")).toMatch(/email/);
  });
});

describe("password hashing", () => {
  it("is deterministic for one salt, differs by salt and password, and ignores Unicode composition", async () => {
    const salt = newSalt();
    const a = await hashPassword("correct horse battery", salt);
    expect(await hashPassword("correct horse battery", salt)).toBe(a);
    expect(await hashPassword("correct horse batterz", salt)).not.toBe(a);
    expect(await hashPassword("correct horse battery", newSalt())).not.toBe(a);
    expect(await hashPassword("café café café", salt)).toBe(await hashPassword("café café café", salt));
    expect(a).not.toContain("correct");
  });
  it("gives an unknown address a stable fake salt that differs per address", () => {
    expect(fakeSalt("a@b.test")).toBe(fakeSalt("a@b.test"));
    expect(fakeSalt("a@b.test")).not.toBe(fakeSalt("c@b.test"));
    expect(fakeSalt("a@b.test")).toMatch(/^[0-9a-f]{32}$/);
  });
});
