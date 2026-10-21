import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, closePools, owner, app, resetDatabase } from "./helpers/db";

const DOMAINS = ["tracker.test"];
const login = (email: string, code = "hash-ok", session = `s-${Math.random()}`) =>
  app.query("select auth_set_password($1,$2,$3,$4,3600,'{}','salt-x','hash-x') as id", [email, code, DOMAINS, session]).then((r) => r.rows[0].id as string | null);
const request = (email: string, hash = "hash-ok") =>
  app.query("select auth_request_login_code($1,$2,600) as s", [email, hash]).then((r) => r.rows[0].s as string);
// Make earlier codes old enough to get past the 30-second throttle.
const age = () => owner.query("update login_codes set created_at = created_at - interval '2 minutes'");

beforeAll(() => resetDatabase());
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

describe("exact-email exception at the database (same function as the domain check)", () => {
  // Synthetic: mail.example is not an allowed domain here (DOMAINS = tracker.test).
  const EXACT = ["dev.person@mail.example"];
  const loginWith = (email: string, emails: string[], session = `s-${Math.random()}`) =>
    app.query("select auth_set_password($1,$2,$3,$4,3600,$5,'salt-x','hash-x') as id", [email, "hash-ok", DOMAINS, session, emails]).then((r) => r.rows[0].id as string | null);

  it("signs in exactly that address (any case / padding) and creates a MEMBER", async () => {
    await age();
    await request("dev.person@mail.example");
    expect(await loginWith("  Dev.Person@MAIL.example ", EXACT, "tok-dev")).toBeTruthy();
    const me = (await app.query("select email, role from auth_resolve_session('tok-dev')")).rows[0];
    expect(me).toEqual({ email: "dev.person@mail.example", role: "member" });
  });

  it("does not open the rest of the domain or any other address", async () => {
    for (const e of ["other.person@mail.example", "dev.person2@mail.example", "dev.person@mail.example.evil.com", "x@sub.mail.example"]) {
      await age();
      await request(e);
      expect(await loginWith(e, EXACT), e).toBeNull();
    }
    expect((await owner.query("select count(*)::int n from profiles where email like '%@mail.example' and email <> 'dev.person@mail.example'")).rows[0].n).toBe(0);
  });

  it("rejects plus aliases of the exact address even with a valid code", async () => {
    await age();
    await request("dev.person+tag@mail.example");
    expect(await loginWith("dev.person+tag@mail.example", EXACT)).toBeNull();
    expect((await owner.query("select count(*)::int n from profiles where email like 'dev.person+%'")).rows[0].n).toBe(0);
  });

  it("is off when no exception is passed (the default, and what production sends)", async () => {
    await age();
    await request("dev.person@mail.example");
    // The account already exists from the first test, yet without the exception it cannot sign in.
    expect(await loginWith("dev.person@mail.example", [], "tok-off")).toBeNull();
    expect(await loginWith("dev.person@mail.example", [])).toBeNull();
  });

  it("an exception gives no admin rights: admin still comes only from the allowlist", async () => {
    await age();
    await request("dev.person@mail.example");
    const id = await loginWith("dev.person@mail.example", EXACT, "tok-role");
    expect(id).toBeTruthy();
    expect((await owner.query("select role from profiles where id = $1", [id])).rows[0].role).toBe("member");
    await owner.query("insert into admin_emails (email) values ('dev.person@mail.example')");
    expect((await owner.query("select role from profiles where id = $1", [id])).rows[0].role).toBe("admin");
    await owner.query("delete from admin_emails where email = 'dev.person@mail.example'");
  });

  it("keeps the existing code rules: wrong code fails and locks after 5 tries", async () => {
    await age();
    await request("dev.person@mail.example");
    for (let i = 0; i < 5; i++) {
      const r = await app.query("select auth_set_password($1,$2,$3,$4,3600,$5,'salt-x','hash-x') as id", ["dev.person@mail.example", "wrong", DOMAINS, `s-${i}`, EXACT]);
      expect(r.rows[0].id).toBeNull();
    }
    expect(await loginWith("dev.person@mail.example", EXACT)).toBeNull();
  });

  it("keeps the request throttle for the exact address", async () => {
    await age();
    expect(await request("dev.person@mail.example")).toBe("ok");
    expect(await request("dev.person@mail.example")).toBe("throttled");
  });
});


describe("password sign-in (migration 006)", () => {
  const D = ["tracker.test"];
  const email = "pw.person@tracker.test";
  const setPw = (e: string, hash: string, session = `s-${Math.random()}`) =>
    app.query("select auth_set_password($1,'hash-ok',$2,$3,3600,'{}','salt-1',$4) as id", [e, D, session, hash]).then((r) => r.rows[0].id as string | null);
  const pwLogin = (e: string, hash: string, session = `s-${Math.random()}`, domains = D) =>
    app.query("select auth_password_login($1,$2,$3,$4,3600,'{}') as id", [e, hash, domains, session]).then((r) => r.rows[0].id as string | null);
  const salt = (e: string) => app.query("select auth_password_salt($1) as s", [e]).then((r) => r.rows[0].s as string | null);

  it("sign-up with a valid code sets the password; sign-in then needs no code", async () => {
    await age(); await request(email);
    const id = await setPw(email, "hash-1");
    expect(id).toBeTruthy();
    expect(await salt(email)).toBe("salt-1");
    expect(await pwLogin(email, "hash-1")).toBe(id);
    expect(await pwLogin(email.toUpperCase(), "hash-1")).toBe(id);
  });

  it("a wrong password, an unknown address and a bad address all fail the same way", async () => {
    expect(await pwLogin(email, "hash-wrong")).toBeNull();
    expect(await pwLogin("nobody@tracker.test", "hash-1")).toBeNull();
    expect(await pwLogin("pw.person+x@tracker.test", "hash-1")).toBeNull();
    expect(await salt("nobody@tracker.test")).toBeNull();
  });

  it("5 wrong passwords in a row lock the account, even for the right password, until the lock ends", async () => {
    for (let i = 0; i < 5; i++) expect(await pwLogin(email, `bad-${i}`)).toBeNull();
    expect(await pwLogin(email, "hash-1")).toBeNull();
    await owner.query("update credentials set locked_until = now() - interval '1 second'");
    expect(await pwLogin(email, "hash-1")).toBeTruthy();
  });

  it("sign-up needs a valid code: no code, wrong code and a disallowed domain all fail", async () => {
    expect(await setPw("pw.new@tracker.test", "h")).toBeNull();
    await age(); await request("pw.new@tracker.test");
    const wrong = await app.query("select auth_set_password($1,'wrong',$2,'s-x',3600,'{}','s','h') as id", ["pw.new@tracker.test", D]);
    expect(wrong.rows[0].id).toBeNull();
    await age(); await request("pw.new@elsewhere.test");
    expect(await setPw("pw.new@elsewhere.test", "h")).toBeNull();
    expect((await owner.query("select count(*)::int n from profiles where email like 'pw.new@%'")).rows[0].n).toBe(0);
  });

  it("a password reset (new code) replaces the password and clears a lock; the old one stops working", async () => {
    await age(); await request(email);
    expect(await app.query("select auth_set_password($1,'hash-ok',$2,'s-r',3600,'{}','salt-2','hash-2') as id", [email, D]).then((r) => r.rows[0].id)).toBeTruthy();
    expect(await pwLogin(email, "hash-1")).toBeNull();
    expect(await pwLogin(email, "hash-2")).toBeTruthy();
  });

  it("a disabled account cannot sign in with its password; removing the domain also blocks it", async () => {
    expect(await pwLogin(email, "hash-2", undefined, ["other.test"])).toBeNull();
    await owner.query("update profiles set disabled = true where email = $1", [email]);
    expect(await pwLogin(email, "hash-2")).toBeNull();
    await owner.query("update profiles set disabled = false where email = $1", [email]);
  });

  it("new accounts are members, and the runtime role cannot read or write credentials", async () => {
    expect((await owner.query("select role from profiles where email = $1", [email])).rows[0].role).toBe("member");
    await expect(app.query("select * from credentials")).rejects.toThrow(/permission denied/);
    await expect(app.query("update credentials set hash = 'x'")).rejects.toThrow(/permission denied/);
    await expect(app.query("insert into credentials (user_id, salt, hash) select id, 's', 'h' from profiles limit 1")).rejects.toThrow(/permission denied/);
  });
});
