// Connection settings for a hosted database whose TLS certificate is signed by the provider's own CA
// (e.g. Supabase), which Node does not trust by default. Supplying that CA keeps full verification
// (certificate chain AND host name) on; it never turns verification off. The CA certificate is public.
// scripts/lib/pgconfig.mjs is the same logic for the setup/admin scripts; tests/db-ssl.test.ts covers both.

export interface PgConnectionConfig {
  connectionString: string;
  ssl?: { ca: string; rejectUnauthorized: true };
}

const URL_SSL_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "sslnegotiation"];

function normalizePem(raw: string | undefined): string | undefined {
  const pem = raw?.replace(/\\n/g, "\n").trim();
  if (!pem) return undefined;
  if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("DATABASE_CA_CERT must contain a PEM certificate (-----BEGIN CERTIFICATE-----).");
  }
  return pem;
}

/** With a CA: verify the server against it. Without one: use the URL as given (sslmode in the URL still applies). */
export function connectionConfig(url: string, caPem?: string): PgConnectionConfig {
  const ca = normalizePem(caPem);
  if (!ca) return { connectionString: url };
  const u = new URL(url);
  // The URL's own ssl settings would override the explicit ones, so remove them.
  for (const p of URL_SSL_PARAMS) u.searchParams.delete(p);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}
