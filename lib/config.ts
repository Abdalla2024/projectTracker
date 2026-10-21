import { parseAllowedDomains } from "./email-address";

export const SESSION_COOKIE = "ekiben_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;
export const LOGIN_CODE_TTL_SECONDS = 10 * 60;

export function allowedDomains(): string[] {
  return parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS);
}

export const isProduction = () => process.env.NODE_ENV === "production";

export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16 || s.startsWith("replace-with")) {
    throw new Error("AUTH_SECRET is missing or still the placeholder value. Set a long random string in .env.local.");
  }
  return s;
}

export type EmailTransport = "console" | "smtp";

export function emailTransport(): EmailTransport {
  const t = (process.env.EMAIL_TRANSPORT ?? "console") as EmailTransport;
  if (t !== "console" && t !== "smtp") throw new Error(`EMAIL_TRANSPORT must be "console" or "smtp", got "${t}"`);
  // Local-dev shortcut: the console transport prints login codes to the server log. It must never run in production.
  if (t === "console" && isProduction()) {
    throw new Error('EMAIL_TRANSPORT="console" is for local development only and is refused when NODE_ENV=production.');
  }
  return t;
}

/**
 * Local-development exception: ONE exact email address allowed to sign in besides the allowed domains
 * (env DEV_ALLOWED_EMAIL). It is never a domain and never a list, and it is refused in production
 * (loudly, like the console email transport) so it cannot be switched on there by accident.
 */
/**
 * Individual full addresses allowed in any environment, in addition to the allowed domains
 * (ALLOWED_EMAILS, comma-separated). Each must be one complete address: no domain, wildcard or + alias.
 * Everything else about signing in is unchanged (verified code, rate limits, member role).
 */
export function allowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAILS?.trim();
  if (!raw) return [];
  const out = raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const e of out) {
    if (!/^[a-z0-9._%-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(e)) {
      throw new Error("ALLOWED_EMAILS must be a comma-separated list of full email addresses (no domains, wildcards or + aliases).");
    }
  }
  return [...new Set(out)];
}

/** Every exact address that may sign in outside the allowed domains. */
export function exactAllowedEmails(): string[] {
  return [...new Set([...allowedEmails(), ...devAllowedEmails()])];
}

export function devAllowedEmails(): string[] {
  const raw = process.env.DEV_ALLOWED_EMAIL?.trim();
  if (!raw) return [];
  if (isProduction()) {
    throw new Error("DEV_ALLOWED_EMAIL is for local development only and is refused when NODE_ENV=production.");
  }
  const email = raw.toLowerCase();
  if (!/^[a-z0-9._%-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email)) {
    throw new Error("DEV_ALLOWED_EMAIL must be one full email address (no domain-only value, list, or + alias).");
  }
  return [email];
}
