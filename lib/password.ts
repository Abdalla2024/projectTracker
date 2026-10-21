import { createHmac, randomBytes, scrypt } from "node:crypto";
import { authSecret } from "./config";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** null when the password is acceptable, otherwise a message for the user. */
export function checkPassword(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (password.toLowerCase() === email.toLowerCase() || (local.length >= 4 && password.toLowerCase() === local)) {
    return "Don't use your email address as your password.";
  }
  return null;
}

export const newSalt = () => randomBytes(16).toString("hex");

/** Stand-in salt for addresses with no password, so "unknown address" and "wrong password" look the same. */
export const fakeSalt = (email: string) =>
  createHmac("sha256", authSecret()).update(`fake-salt:${email}`).digest("hex").slice(0, 32);

/** scrypt (N=16384, r=8, p=1) of the NFKC-normalised password. The database stores this value and the salt only. */
export function hashPassword(password: string, saltHex: string): Promise<string> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key.toString("hex")),
    ),
  );
}
