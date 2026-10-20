// Email normalization and domain eligibility. The same rules are re-checked inside the database
// (auth_verify_and_login) so a bug here cannot create an account for a disallowed address.

export function parseAllowedDomains(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export type EmailCheck = { ok: true; email: string } | { ok: false; reason: string };

/** Exact domain match only (no subdomains), no plus-addressing, a single "@". */
export function checkEmail(input: string, allowedDomains: string[]): EmailCheck {
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, reason: "Enter a valid email address." };
  }
  const [local, domain] = email.split("@");
  if (local.includes("+")) {
    return { ok: false, reason: "Use your main work email address without a + alias." };
  }
  if (allowedDomains.length === 0 || !allowedDomains.includes(domain)) {
    return { ok: false, reason: "Sign-in is limited to Ekiben email addresses." };
  }
  return { ok: true, email };
}
