# Ekiben Project Tracker — brief

## Context
Ekiben is a Baltimore restaurant. This tracker is part of a 5-week AI Builder fellowship (mid-October to just before Thanksgiving 2026). It tracks fellowship projects and company projects used by Ekiben employees. It should be understandable to staff and maintainable after the fellowship. Other candidate Ekiben tools are out of scope.

## Requirements (current)
- **Accounts:** sign in with a verified email at an allowed Ekiben domain (configurable; `ekibenbaltimore.com` is provisional). Roles are member and admin. Everyone defaults to member; admins come only from a private allowlist managed out of band.
- **Visibility:** a member sees projects they created and projects an admin assigned to them. An admin sees all. Enforced in the database.
- **Projects:** name, description, creator, multiple assignees, status (not started, in progress, blocked, done, cancelled), priority, optional deadline, next step, timestamps, comments, and dated history. Archive or cancel, never delete.
- **Editing (defaults to confirm):** creators edit their own projects; assignees update status and next step and comment; only admins assign and reassign; anyone who can see a project can comment.
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
- **Local-dev exact-email exception.** `DEV_ALLOWED_EMAIL` (set only in the ignored `.env.local`) lets one exact address sign in locally for testing. It is not a domain or list, plus aliases are still rejected, the account is a member, the code and throttle rules still apply, and the app refuses to sign anyone in when it is set in production. It is enforced in the same app check and database function as the domain rule (migration 004).
- **No store selection.** Removed at the project owner's direction; migration 003 drops the store tables and links but keeps existing history rows (history is append-only).

## Open questions (default if unanswered)
1. Allowed domain(s); do staff use Google Workspace or Microsoft 365 (SSO)? (single domain, email codes)
2. Which people are admins? (none until sent privately)
3. Are the edit and assignment defaults right? (as built)
4. Approved hosting, database, and email sender, and who owns them afterward? (temporary accounts, synthetic data only)
5. Do the workflow statuses fit how Ekiben works? (as built)
6. Where should the weekly summary be delivered, and who reviews it? (in-app, admin reviews)

## Verified and not verified
- **Automated, run:** 81 checks in 7 files against a throwaway Postgres (access rules, sign-in, summary logic, time zones, config guards, the store-removal upgrade, and the exact-email exception); typecheck; production build; a search of the built client files for database/secret strings and for store code (none found).
- **Store removal, run:** the upgrade test builds a database at migration 002 with store data and store history, applies migration 003, and checks that the store tables and functions are gone, the old history rows are kept (append-only), new store events are refused, and the rest of the app still works. On the real local database, `npm run db:setup` dropped 5 store links and kept 5 history rows; reseeding the demo data then cleared those demo-only rows. A repo-wide search finds no other store references outside migrations 001-003 and their test.
- **Exact-email exception, run:** tests cover the app rule, the database function, and the production/config guards (allowed: the exact address in any case or padding; rejected: another address on the same domain, lookalike domains, plus aliases, values that are a domain, wildcard, list or alias; refused in production; no admin rights; code limits and throttle unchanged). In Chrome on the local app, the exact address completed sign-up as a member, while another Gmail address, a plus alias, and another address on the same domain were each rejected with no code issued; a production build with the variable set refused sign-in and created no code. Not verified: real email delivery of the code (local mode prints it to the server log).
- **Browser walkthrough, run (seeded local data, `next dev`):** real Google Chrome 155 (headless, scripted with Playwright) at 1280×800 and at 390×844 with mobile emulation, on the five flows: admin sees all projects; a member can't see the private project; a member creates a project and an admin assigns it to two members, and all three can see it; comments and history; weekly summary as admin and as a member, each limited to accessible projects. 47 scripted checks passed at each size, including that no store UI appears on the list, forms, project page, history, or summary. No page-level horizontal scroll, no browser console errors, and the only error response was the deliberate hidden-project 404. I looked at the key screenshot of each flow at each size, not every one.
- **Found by the browser runs and fixed:** a missing favicon (404 and a "1 Issue" dev badge), a phone project list that hid its Assigned-to column off-screen, an awkward phone header, a sign-in card with no side margin, a bare framework 404 for hidden projects, a local-dev note styled as an error, and (on the store-removal rerun) overlapping queries on one database connection that `pg` deprecates and will remove in version 9.
- **Not verified:** a physical phone, Safari or Firefox (only emulated mobile in Chrome); dark mode; accessibility (keyboard, screen reader, contrast); the production build in a browser (the walkthrough used the dev server); the SMTP email path (only console mode ran); a managed Postgres; any hosted deployment; independent security review; load. The walkthrough script is a throwaway outside the repository, so it is not a repeatable check here.
