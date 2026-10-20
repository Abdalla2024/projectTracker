// Same logic as lib/db-ssl.ts, for the owner-level scripts. The CA comes from DATABASE_CA_CERT
// (PEM text, "\n" allowed) or DATABASE_CA_CERT_FILE (path to a downloaded .crt). Public certificate, not a secret.
import fs from "node:fs";

const URL_SSL_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "sslnegotiation"];

export function normalizePem(raw) {
  const pem = raw?.replace(/\\n/g, "\n").trim();
  if (!pem) return undefined;
  if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("DATABASE_CA_CERT must contain a PEM certificate (-----BEGIN CERTIFICATE-----).");
  }
  return pem;
}

export function pgConfig(url, env = process.env) {
  const file = env.DATABASE_CA_CERT_FILE?.trim();
  const ca = normalizePem(env.DATABASE_CA_CERT || (file ? fs.readFileSync(file, "utf8") : undefined));
  if (!ca) return { connectionString: url };
  const u = new URL(url);
  for (const p of URL_SSL_PARAMS) u.searchParams.delete(p);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}
