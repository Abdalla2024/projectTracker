# Ekiben Project Tracker (demo)

An internal web app for tracking company projects at Ekiben (a Baltimore restaurant group) — including the work done during the AI Builder fellowship. Staff sign in with a verified Ekiben email address, create projects, and comment on them; admins see everything, assign projects to one or more people, and attach stores. A weekly summary compares where every project stood at Monday 12:00 AM (America/New_York) with where it stands now.

**Status: initial demo.** Built to run locally and to be shown to Ekiben. Production deployment is a separate, deliberate decision (see [docs/PRIVATE-DEMO.md](docs/PRIVATE-DEMO.md)).

> Don't enter customer, employee-personal, or financial details. The app says this in the UI too.

## Stack (and why)

| Piece | Choice | Reason |
|---|---|---|
| App | Next.js (App Router) + TypeScript | One codebase for UI and server; widely known |
| Database | PostgreSQL, plain SQL migrations in [db/migrations](db/migrations) | Access rules live in the database (row-level security + triggers), and run on any Postgres |
| Auth | Passwordless email code, implemented in SQL functions + [lib/auth.ts](lib/auth.ts) | No passwords to store; proves control of an Ekiben mailbox; no vendor chosen yet |
| Email | SMTP via nodemailer (any provider) | Provider not decided; `console` mode for local dev only |

Supabase (the earlier suggestion) was not used for the demo because its local stack needs Docker, which isn't installed here, and its hosted version needs an account. The SQL is portable to a managed Postgres later.

## Run it locally

Requires Node 20.9+ and a local PostgreSQL (tested with Postgres.app 18) where you can create a database.

```bash
npm install
cp .env.example .env.local          # then edit; see "Configuration"
npm run db:setup                    # creates the database + restricted app role, applies migrations
npm run db:seed-demo                # optional: synthetic demo accounts and projects
npm run dev                         # http://localhost:3000
```

**Signing in locally:** with `EMAIL_TRANSPORT=console` no email is sent. Enter an email, then read the 6-digit code from the terminal running `npm run dev`. To sign in as the synthetic demo users, add `ekiben-demo.example` to `ALLOWED_EMAIL_DOMAINS` **in your local `.env.local` only**:

| Account | Role |
|---|---|
| demo.admin@ekiben-demo.example | admin (via the admin allowlist — same mechanism as real admins) |
| demo.member1@, member2@, member3@ekiben-demo.example | member |

Everything seeded is labeled `[DEMO]` / `(synthetic)`. `npm run db:seed-demo -- --reset` replaces it.

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

All settings are environment variables; see [.env.example](.env.example) (placeholders only — never commit `.env.local`).

| Variable | Purpose |
|---|---|
| `DATABASE_ADMIN_URL` | Owner connection, used only by migrations and admin scripts |
| `DATABASE_URL` | Restricted `tracker_app` role used by the web app. The app refuses to start queries on a superuser/owner connection |
| `APP_DB_PASSWORD` | Password `db:setup` gives the `tracker_app` role |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated. **`ekibenbaltimore.com` is a provisional value — confirm with Ekiben** |
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

`npm test` runs 59 checks in 6 files against a real throwaway Postgres, as the same restricted role the app uses:
- [tests/access.test.ts](tests/access.test.ts) — who can see/change what (members, assignees, admins, disabled users, no-user), role cannot be self-assigned, history is written with every change and cannot be edited, failed changes leave no history.
- [tests/auth.test.ts](tests/auth.test.ts) — login codes (one-time, expiry, attempt lock, throttle), domain enforcement, admin allowlist, disabled users, session end.
- [tests/summary.test.ts](tests/summary.test.ts), [tests/time.test.ts](tests/time.test.ts) — start-of-week vs now reconstruction, deadline flags, Monday boundary, both daylight-saving transitions.
- [tests/email-address.test.ts](tests/email-address.test.ts), [tests/config-guards.test.ts](tests/config-guards.test.ts) — email/domain rules, refusal of privileged DB connections and of dev-only email in production.

## Known limitations (initial demo)

- No in-app screens for managing admins, users, or stores — those are scripts/SQL by design (see ADMIN.md). Store list is provisional (Fells Point, Hampden, South Baltimore, Catering), set in migration 001.
- A person appears in the assignee picker only after signing in once. Display names are derived from the email (`jane.doe@…` → "Jane Doe"); there is no profile editing yet.
- Comments can't be edited or deleted; projects are archived/cancelled, never deleted.
- The weekly summary is an in-app page only (no email/Slack). It is deterministic (no AI), and a person should review it before it is shared outside the app.
- Login throttling is per email address; there is no per-IP limit and no multi-factor step. Sessions last 7 days.
- No pagination or search yet; fine for dozens of projects, not thousands.
- Verified by automated tests and by driving the running app over HTTP; the UI has not been visually reviewed in a browser or on a phone.
- `AGENTS.md` was generated by Next.js (`next dev`); it is a framework note and can be kept or removed.
