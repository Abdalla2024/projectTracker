# Ekiben Project Tracker (demo)

An internal web app for tracking company projects at Ekiben (a Baltimore restaurant group) — including the work done during the AI Builder fellowship. Staff sign in with a verified Ekiben email address, create projects, and comment on them; admins see everything and assign projects to one or more people. A weekly summary compares where every project stood at Monday 12:00 AM (America/New_York) with where it stands now.

Project context, requirements, decisions, open questions, and what is unverified: [docs/tracker-brief.md](docs/tracker-brief.md). Contributor guidance: [CLAUDE.md](CLAUDE.md).

**Status: initial demo.** Built to run locally and to be shown to Ekiben. Production deployment is a separate, deliberate decision (see [docs/PRIVATE-DEMO.md](docs/PRIVATE-DEMO.md)).

> Don't enter customer, employee-personal, or financial details. The app says this in the UI too.

## Stack (and why)

| Piece | Choice | Reason |
|---|---|---|
| App | Next.js (App Router) + TypeScript | One codebase for UI and server; widely known |
| Database | PostgreSQL, plain SQL migrations in [db/migrations](db/migrations) | Access rules live in the database (row-level security + triggers), and run on any Postgres |
| Auth | Sign-up proves the email with a one-time code and sets a password; later sign-ins use email + password (scrypt hashes in a table the app role cannot read; 5 wrong attempts lock an account for 15 minutes; forgotten passwords are reset with a new code). SQL functions + [lib/auth.ts](lib/auth.ts) | Proves control of an Ekiben mailbox once, then no code each time; no vendor chosen yet |
| Email | SMTP via nodemailer (any provider) | Provider not decided; `console` mode for local dev only |

Supabase (the earlier suggestion) was not used for the demo because its local stack needs Docker, which isn't installed here, and its hosted version needs an account. The SQL is portable to a managed Postgres later.

## Run it locally

Requires Node 20.9+ and a local PostgreSQL (tested with Postgres.app 18) where you can create a database.

```bash
npm install
# create .env.local (ignored by git) with the variables in "Configuration" below
npm run db:setup                    # creates the database + restricted app role, applies migrations
npm run db:seed-demo                # optional: synthetic demo accounts and projects
npm run dev                         # http://localhost:3000
```

**Upgrading an older local database** (from before store selection was removed): `npm run db:setup` applies migration 003, which drops the store tables and links but keeps existing history rows; then `npm run db:seed-demo -- --reset` refreshes the demo data.

**Signing in locally:** with `EMAIL_TRANSPORT=console` no email is sent. Use **Create an account**, enter an email, then read the 6-digit code from the terminal running `npm run dev` and choose a password (10+ characters). After that, sign in with email and password. To sign in as the synthetic demo users, add `ekiben-demo.example` to `ALLOWED_EMAIL_DOMAINS` **in your local `.env.local` only**:

| Account | Role |
|---|---|
| demo.admin@ekiben-demo.example | admin (via the admin allowlist — same mechanism as real admins) |
| demo.member1@, member2@, member3@ekiben-demo.example | member |

Everything seeded is labeled `[DEMO]` / `(synthetic)`. `npm run db:seed-demo -- --reset` replaces it.

## Online demo

Deployed on Vercel (https://ekiben-project-tracker.vercel.app) with GitHub connected, using a Supabase-hosted PostgreSQL and an SMTP sender. Sign-in is not usable until the database and email sender are configured. What is needed, setup, verification, and rollback: [docs/PRIVATE-DEMO.md](docs/PRIVATE-DEMO.md). For the remote database use `npm run db:setup:remote` and `npm run admin:remote -- ...`, which read a git-ignored `.env.remote` (variables listed in [docs/PRIVATE-DEMO.md](docs/PRIVATE-DEMO.md)). `GET /api/health` reports whether a running instance reaches the database as the restricted role with row-level security on.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve the build |
| `npm test` | All automated checks (needs local Postgres; uses a throwaway `ekiben_tracker_test` database) |
| `npm run typecheck` | TypeScript check |
| `npm run db:setup` | Create database + app role, apply pending migrations (owner connection) |
| `npm run db:seed-demo` | Load synthetic demo data (local only; refuses non-local hosts and production) |
| `npm run admin -- grant\|revoke\|list\|disable\|enable [email]` | Out-of-band admin and account management — see [docs/ADMIN.md](docs/ADMIN.md) |

## Configuration

All settings are environment variables; kept in `.env.local` for local development and in Vercel's settings when deployed. Never commit env files (`.env*` is git-ignored). A local `.env.local` needs `DATABASE_ADMIN_URL` (your local Postgres owner, database `ekiben_tracker`), `DATABASE_URL` (the `tracker_app` role), `APP_DB_PASSWORD`, `ALLOWED_EMAIL_DOMAINS`, `AUTH_SECRET`, and `EMAIL_TRANSPORT=console`.

| Variable | Purpose |
|---|---|
| `DATABASE_ADMIN_URL` | Owner connection, used only by migrations and admin scripts |
| `DATABASE_URL` | Restricted `tracker_app` role used by the web app. The app refuses to start queries on a superuser/owner connection |
| `APP_DB_PASSWORD` | Password `db:setup` gives the `tracker_app` role |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated. **`ekibenbaltimore.com` is a provisional value — confirm with Ekiben** |
| `DEV_ALLOWED_EMAIL` | **Local development only.** One exact full email address allowed to sign in besides the allowed domains (set it in `.env.local` only). Not a domain or list; plus aliases still rejected; account is still a member; refused when `NODE_ENV=production` |
| `DATABASE_CA_CERT` | PEM text of the database provider's CA certificate (a public certificate). Needed when the provider signs with its own CA (e.g. Supabase); keeps full TLS verification on. Scripts also accept `DATABASE_CA_CERT_FILE` (a path) |
| `DATABASE_POOL_MAX` | Max database connections per server instance (default 10; use 3 on a serverless host) |
| `AUTH_SECRET` | Random string used to hash login codes |
| `APP_TIME_ZONE` | Reporting time zone (default `America/New_York`, handles daylight saving) |
| `EMAIL_TRANSPORT` | `console` (local dev only; refused in production) or `smtp` (+ `SMTP_*`, `EMAIL_FROM`) |

## Project layout

```
app/                  Pages and server actions (UI)
lib/                  auth, db access, project queries, weekly summary (pure), time helpers
db/migrations/        Schema, row-level security, triggers, auth functions
scripts/              db-setup, seed-demo, admin (owner-level tools, not part of the web app)
tests/                Automated checks (see below)
docs/                 ACCESS.md, ADMIN.md, PRIVATE-DEMO.md
```

## What is tested

`npm test` runs 127 checks in 12 files against a real throwaway Postgres, as the same restricted role the app uses:
- [tests/access.test.ts](tests/access.test.ts) — who can see/change what (members, assignees, admins, disabled users, no-user), role cannot be self-assigned, history is written with every change and cannot be edited, failed changes leave no history.
- [tests/auth.test.ts](tests/auth.test.ts) — login codes (one-time, expiry, attempt lock, throttle), domain enforcement, admin allowlist, disabled users, session end.
- [tests/summary.test.ts](tests/summary.test.ts), [tests/time.test.ts](tests/time.test.ts) — start-of-week vs now reconstruction, deadline flags, Monday boundary, both daylight-saving transitions.
- [tests/api-roles.test.ts](tests/api-roles.test.ts) — hosted-provider API roles (`anon`, `authenticated`, `service_role`) can reach none of our tables or functions, even with provider default grants in place; setup fails if they regain access.
- [tests/db-ssl.test.ts](tests/db-ssl.test.ts) — supplying a provider CA keeps TLS verification on; bad values are refused.
- [tests/health.test.ts](tests/health.test.ts) — the `/api/health` deployment check (connected as the restricted role, row-level security on; no detail on any failure).
- [tests/remove-stores.test.ts](tests/remove-stores.test.ts) — upgrading a database that had store data through migration 003 (history kept, feature removed).
- [tests/email-address.test.ts](tests/email-address.test.ts), [tests/config-guards.test.ts](tests/config-guards.test.ts) — email/domain rules, refusal of privileged DB connections and of dev-only email in production.

## Known limitations (initial demo)

- No in-app screens for managing admins or users — those are scripts by design (see ADMIN.md).
- A person appears in the assignee picker only after signing in once. Display names are derived from the email (`jane.doe@…` → "Jane Doe"); there is no profile editing yet.
- Comments can be edited and deleted only by their author (never by anyone else, including admins). A deleted comment keeps a placeholder so replies stay attached, and its text is erased; edits and deletions are recorded in the history without the text. Replies go one level deep. Projects are archived/cancelled, never deleted.
- The weekly summary is an in-app page only (no email/Slack). It is deterministic (no AI), and a person should review it before it is shared outside the app.
- Login throttling is per email address; there is no per-IP limit and no multi-factor step. Sessions last 7 days.
- No pagination or search yet; fine for dozens of projects, not thousands.
- Verified by automated tests and a scripted Chrome walkthrough at desktop and emulated-phone sizes (see the brief for what was and wasn't covered). Not yet tried on a physical phone, other browsers, or with accessibility tools.
- `AGENTS.md` was generated by Next.js (`next dev`); it is a framework note and can be kept or removed.
