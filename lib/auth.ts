import "server-only";
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  LOGIN_CODE_TTL_SECONDS, SESSION_COOKIE, SESSION_TTL_SECONDS, allowedDomains, authSecret, exactAllowedEmails, isProduction,
} from "./config";
import { withoutUser } from "./db";
import { checkEmail } from "./email-address";
import { sendLoginCode } from "./email";
import { PASSWORD_MAX, checkPassword, fakeSalt, hashPassword, newSalt } from "./password";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: "member" | "admin";
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const hashCode = (email: string, code: string) => createHmac("sha256", authSecret()).update(`${email}:${code}`).digest("hex");

export type RequestCodeResult = { ok: true; email: string } | { ok: false; error: string };

export async function requestLoginCode(emailInput: string): Promise<RequestCodeResult> {
  const check = checkEmail(emailInput, allowedDomains(), exactAllowedEmails());
  if (!check.ok) return { ok: false, error: check.reason };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const status = await withoutUser(async (c) =>
    (await c.query("select auth_request_login_code($1, $2, $3) as s", [check.email, hashCode(check.email, code), LOGIN_CODE_TTL_SECONDS])).rows[0].s,
  );
  if (status !== "ok") {
    return { ok: false, error: "A code was sent recently. Wait a minute and try again, or use the code already in your inbox." };
  }
  await sendLoginCode(check.email, code);
  return { ok: true, email: check.email };
}

async function startSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export type SignUpResult = { ok: true } | { ok: false; error: string };

/** Sign up or reset a password: the emailed code proves control of the address, and the password is set in the same step. */
export async function signUpWithCode(emailInput: string, codeInput: string, password: string): Promise<SignUpResult> {
  const check = checkEmail(emailInput, allowedDomains(), exactAllowedEmails());
  const code = codeInput.replace(/\s/g, "");
  if (!check.ok || !/^\d{6}$/.test(code)) return { ok: false, error: "That code didn't work or has expired. Request a new one." };
  const weak = checkPassword(password, check.email);
  if (weak) return { ok: false, error: weak };

  const token = randomBytes(32).toString("base64url");
  const salt = newSalt();
  const userId = await withoutUser(async (c) =>
    (await c.query("select auth_set_password($1, $2, $3, $4, $5, $6, $7, $8) as id", [
      check.email, hashCode(check.email, code), allowedDomains(), sha256(token), SESSION_TTL_SECONDS, exactAllowedEmails(),
      salt, await hashPassword(password, salt),
    ])).rows[0].id as string | null,
  );
  if (!userId) return { ok: false, error: "That code didn't work or has expired. Request a new one." };
  await startSessionCookie(token);
  return { ok: true };
}

/** Email + password sign-in. Every failure looks the same to the caller. */
export async function signInWithPassword(emailInput: string, password: string): Promise<boolean> {
  const check = checkEmail(emailInput, allowedDomains(), exactAllowedEmails());
  if (!check.ok || password.length === 0 || password.length > PASSWORD_MAX) return false;

  const token = randomBytes(32).toString("base64url");
  const salt = (await withoutUser(async (c) =>
    (await c.query("select auth_password_salt($1) as s", [check.email])).rows[0].s as string | null,
  )) ?? fakeSalt(check.email);
  const hash = await hashPassword(password, salt);
  const userId = await withoutUser(async (c) =>
    (await c.query("select auth_password_login($1, $2, $3, $4, $5, $6) as id", [
      check.email, hash, allowedDomains(), sha256(token), SESSION_TTL_SECONDS, exactAllowedEmails(),
    ])).rows[0].id as string | null,
  );
  if (!userId) return false;
  await startSessionCookie(token);
  return true;
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await withoutUser(async (c) =>
    (await c.query("select * from auth_resolve_session($1)", [sha256(token)])).rows[0],
  );
  return row ? { id: row.id, email: row.email, displayName: row.display_name, role: row.role } : null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await withoutUser((c) => c.query("select auth_end_session($1)", [sha256(token)]));
  jar.delete(SESSION_COOKIE);
}

