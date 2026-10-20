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
