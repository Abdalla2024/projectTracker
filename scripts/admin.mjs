// Out-of-band admin management. Runs as the database owner; there is no equivalent in the web app.
//   npm run admin -- list
//   npm run admin -- grant person@example.com
//   npm run admin -- revoke person@example.com
//   npm run admin -- disable person@example.com   (blocks sign-in and ends access)
//   npm run admin -- enable person@example.com
import pg from "pg";

const [cmd, rawEmail] = process.argv.slice(2);
const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("DATABASE_ADMIN_URL is not set (see .env.example).");
  process.exit(1);
}
const email = rawEmail?.trim().toLowerCase();
if (cmd && cmd !== "list" && !(email && /^[^@\s]+@[^@\s]+$/.test(email))) {
  console.error(`Usage: npm run admin -- <list | grant | revoke | disable | enable> [email]`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (cmd === "list") {
    const r = await client.query(
      `select a.email as allowlisted_email, p.role, p.disabled
       from admin_emails a left join profiles p on p.email = a.email order by a.email`,
    );
    console.table(r.rows);
  } else if (cmd === "grant") {
    await client.query("insert into admin_emails (email) values ($1) on conflict do nothing", [email]);
    console.log(`${email} is on the admin allowlist. Their account (existing or future) gets role=admin.`);
  } else if (cmd === "revoke") {
    await client.query("delete from admin_emails where email = $1", [email]);
    console.log(`${email} removed from the admin allowlist; any existing account is now a member.`);
  } else if (cmd === "disable" || cmd === "enable") {
    const r = await client.query("update profiles set disabled = $2 where email = $1", [email, cmd === "disable"]);
    console.log(r.rowCount ? `${email} ${cmd}d.` : `No account for ${email}.`);
  } else {
    console.error("Usage: npm run admin -- <list | grant | revoke | disable | enable> [email]");
    process.exit(1);
  }
} finally {
  await client.end();
}
