import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, closePools, owner, app, resetDatabase } from "./helpers/db";

const DOMAINS = ["tracker.test"];
const login = (email: string, code = "hash-ok", session = `s-${Math.random()}`) =>
  app.query("select auth_verify_and_login($1,$2,$3,$4,3600) as id", [email, code, DOMAINS, session]).then((r) => r.rows[0].id as string | null);
const request = (email: string, hash = "hash-ok") =>
  app.query("select auth_request_login_code($1,$2,600) as s", [email, hash]).then((r) => r.rows[0].s as string);
// Make earlier codes old enough to get past the 30-second throttle.
const age = () => owner.query("update login_codes set created_at = created_at - interval '2 minutes'");

beforeAll(resetDatabase);
afterAll(closePools);

describe("login codes and sessions", () => {
  it("creates a member profile and a working session on a correct code", async () => {
    expect(await request("new.person@tracker.test")).toBe("ok");
    const id = await login("new.person@tracker.test", "hash-ok", "tok-1");
    expect(id).toBeTruthy();
    const me = (await app.query("select * from auth_resolve_session('tok-1')")).rows[0];
    expect(me).toMatchObject({ email: "new.person@tracker.test", role: "member", display_name: "New Person" });
  });

  it("a code works only once", async () => {
    await age();
    await request("once@tracker.test");
    expect(await login("once@tracker.test")).toBeTruthy();
    expect(await login("once@tracker.test")).toBeNull();
  });

  it("a wrong code fails, and the code locks after 5 wrong attempts", async () => {
    await age();
    await request("lock@tracker.test");
    for (let i = 0; i < 5; i++) expect(await login("lock@tracker.test", "wrong")).toBeNull();
    expect(await login("lock@tracker.test", "hash-ok")).toBeNull(); // even the right code is now dead
  });

  it("an expired code fails", async () => {
    await age();
    await request("late@tracker.test");
    await owner.query("update login_codes set expires_at = now() - interval '1 second' where email = 'late@tracker.test'");
    expect(await login("late@tracker.test")).toBeNull();
  });

  it("refuses accounts outside the allowed domains, even with a valid code", async () => {
    for (const e of ["x@gmail.com", "x@tracker.test.evil.com", "x@sub.tracker.test", "x+alias@tracker.test"]) {
      await request(e);
      expect(await login(e), e).toBeNull();
    }
    expect((await owner.query("select count(*)::int n from profiles where email like 'x%'")).rows[0].n).toBe(0);
  });

  it("throttles repeated code requests", async () => {
    await age();
    expect(await request("burst@tracker.test")).toBe("ok");
    expect(await request("burst@tracker.test")).toBe("throttled");
  });

  it("an allowlisted email becomes admin on first sign-in; a disabled user cannot sign in", async () => {
    await owner.query("insert into admin_emails (email) values ('boss@tracker.test')");
    await age();
    await request("boss@tracker.test");
    await login("boss@tracker.test", "hash-ok", "tok-admin");
    expect((await app.query("select role from auth_resolve_session('tok-admin')")).rows[0].role).toBe("admin");

    await owner.query("update profiles set disabled = true where email = 'boss@tracker.test'");
    expect((await app.query("select * from auth_resolve_session('tok-admin')")).rowCount).toBe(0); // existing session dies
    await age();
    await request("boss@tracker.test");
    expect(await login("boss@tracker.test")).toBeNull();
  });

  it("ending a session invalidates it", async () => {
    await age();
    await request("bye@tracker.test");
    await login("bye@tracker.test", "hash-ok", "tok-bye");
    await app.query("select auth_end_session('tok-bye')");
    expect((await app.query("select * from auth_resolve_session('tok-bye')")).rowCount).toBe(0);
  });

  it("the app role cannot read sessions or login codes directly", async () => {
    await expect(app.query("select * from sessions")).rejects.toThrow(/permission denied/);
    await expect(app.query("select * from login_codes")).rejects.toThrow(/permission denied/);
    await expect(asUser(null, (c) => c.query("select * from admin_emails"))).rejects.toThrow(/permission denied/);
  });
});
