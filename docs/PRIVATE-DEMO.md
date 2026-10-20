# Preparing a private demo deployment (not done yet)

Nothing here has been run. No accounts, hosting, or invitations exist. This is the checklist for when you decide to show the tool to Ekiben on a hosted URL.

The app needs three things from outside this repo: **a Node.js host**, **a PostgreSQL database**, and **an SMTP sender** (to email login codes). Which providers to use is an open decision; the app doesn't depend on a particular one.

## Before you start (decisions)
1. Which host, Postgres, and email sender Ekiben will accept for the demo (can be temporary, under your own accounts, **with synthetic data only**).
2. Confirm the email domain (`ekibenbaltimore.com` is provisional) and get the list of admin emails privately.
3. Confirm the demo will contain only synthetic projects.

## Steps
1. **Create an empty Postgres database** and note an owner connection string → this becomes `DATABASE_ADMIN_URL`. If the provider doesn't allow `CREATE ROLE`/`CREATE DATABASE`, create the database and a `tracker_app` login role (NOSUPERUSER, NOBYPASSRLS) by hand, then run only the migrations (the SQL in `db/migrations` expects that role to exist).
2. **Run setup from your machine** with production values:
   `DATABASE_ADMIN_URL=… APP_DB_PASSWORD=<long random> npm run db:setup`
3. **Set environment variables on the host** (never commit them):
   `DATABASE_URL` (the `tracker_app` URL), `AUTH_SECRET` (new, long, random), `ALLOWED_EMAIL_DOMAINS=ekibenbaltimore.com`, `APP_TIME_ZONE=America/New_York`, `EMAIL_TRANSPORT=smtp`, `EMAIL_FROM`, `SMTP_HOST/PORT/USER/PASSWORD`. Do **not** add `ekiben-demo.example`.
4. **Build and run** with `npm run build` then `npm start` (host must set `NODE_ENV=production`; the app refuses `EMAIL_TRANSPORT=console` then, and sets `Secure` cookies, so serve over HTTPS).
5. **Create the admins:** `DATABASE_ADMIN_URL=… npm run admin -- grant <email>` for each admin.
6. **Optional extra layer:** put the host's password/SSO protection in front of the URL. It is an addition to, not a replacement for, the app's own sign-in.
7. **Seed data:** the demo accounts can't sign in on a hosted deployment (their domain isn't allowed). Either create a few synthetic projects by hand, or run `npm run db:seed-demo -- --allow-remote` against the demo database and look at them as a real admin (admins see all projects). Never seed a database that holds real data.
8. **Smoke test with two real accounts** (one admin, one member): member can't see the admin's unassigned project; admin assigns it to two people; assignee updates status and comments; open the weekly summary as each.
9. **Invite testers** only after steps 1–8 pass.

## Checks to run before and after
- `npm test` (local) and `npm run typecheck`.
- Confirm `DATABASE_URL` connects as `tracker_app`: the app refuses to query otherwise.
- Confirm a code email actually arrives from your sender, and that a non-Ekiben address is refused.

## Open before any *production* use (not designed yet)
Named owner after the fellowship, who pays and owns each account, backups and a tested restore, secret rotation, retention, support/incident contact, and whether to use the organization's Google/Microsoft sign-in instead of email codes. A protected preview URL does not answer these.
