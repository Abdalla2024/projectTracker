# Ekiben Project Tracker — brief

## Context
Ekiben is a Baltimore restaurant. This tracker is part of a 5-week AI Builder fellowship (mid-October to just before Thanksgiving 2026). It tracks fellowship projects and company projects used by Ekiben employees. It should be understandable to staff and maintainable after the fellowship. Other candidate Ekiben tools are out of scope.

## Requirements (current)
- **Accounts:** sign in with a verified email at an allowed Ekiben domain (configurable; `ekibenbaltimore.com` is provisional). Roles are member and admin. Everyone defaults to member; admins come only from a private allowlist managed out of band.
- **Visibility:** a member sees projects they created and projects an admin assigned to them. An admin sees all. Enforced in the database.
- **Projects:** name, description, creator, multiple assignees, stores, status (not started, in progress, blocked, done, cancelled), priority, optional deadline, next step, timestamps, comments, and dated history. Archive or cancel, never delete.
- **Editing (defaults to confirm):** creators edit their own projects; assignees update status and next step and comment; only admins assign, reassign, and set stores; anyone who can see a project can comment.
- **History:** append-only, written in the same transaction as each change.
- **Weekly summary:** in-app, compares each project at Monday 00:00 `America/New_York` with now; members see only their projects; deterministic, no AI.
- **Privacy:** synthetic demo data only; visible reminder not to enter customer or financial details; no secrets in git.
- **Deployment:** run locally now; private hosted demo later ([PRIVATE-DEMO.md](PRIVATE-DEMO.md)); production is a separate decision.

Permissions in detail: [ACCESS.md](ACCESS.md). Admin procedures: [ADMIN.md](ADMIN.md).

## Decisions
- **Next.js + PostgreSQL with SQL migrations.** Runs locally with what is installed; portable to a managed Postgres. Supabase was not used because its local stack needs Docker, which is not installed.
- **Rules in the database** (RLS + triggers), mirrored in server code and UI.
- **Passwordless email-code sign-in**, custom, because no identity vendor is chosen. Trade-off: custom auth needs outside review before real use.
- **Summary rebuilt from the event log**, so start-of-week state needs no snapshot job.
- **No AI narrative** in this version.

## Open questions (default if unanswered)
1. Allowed domain(s); do staff use Google Workspace or Microsoft 365 (SSO)? (single domain, email codes)
2. Which people are admins? (none until sent privately)
3. Are the edit and assignment defaults right? (as built)
4. Approved hosting, database, and email sender, and who owns them afterward? (temporary accounts, synthetic data only)
5. Real store list and workflow statuses? (provisional list; change by SQL)
6. Where should the weekly summary be delivered, and who reviews it? (in-app, admin reviews)

## Verified and not verified
- **Run:** 59 automated checks against a throwaway Postgres (access rules, sign-in, summary logic, time zones, config guards); typecheck; production build; the running app driven over HTTP as admin and members; a search of the built client files for database and secret strings (none found).
- **Not verified:** the UI in a browser or on a phone; the SMTP email path (only console mode ran); a managed Postgres; any hosted deployment; independent security review; load or accessibility.
