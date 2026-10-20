import { setupDatabase } from "./lib/migrate.mjs";

try {
  const applied = await setupDatabase({
    adminUrl: process.env.DATABASE_ADMIN_URL,
    appPassword: process.env.APP_DB_PASSWORD,
    log: (m) => console.log(m),
  });
  console.log(applied.length ? `Done. Applied ${applied.length} migration(s).` : "Database is up to date.");
} catch (err) {
  console.error(`db:setup failed: ${err.message}`);
  process.exit(1);
}
