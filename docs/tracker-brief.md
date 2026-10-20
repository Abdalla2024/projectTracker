# Ekiben Project Tracker — brief

Status as of the initial demo commit (`4db2261`). Facts are labeled **Observed** (seen in the repo, a test run, or the running app), **Provided** (stated by the project owner), **Assumed** (my default, to confirm), or **Recommended**.

## 1. Context

- **Provided:** Ekiben is a Baltimore restaurant. The builder is on a 5-week AI Builder fellowship (mid-October to just before Thanksgiving 2026), running about 10 projects, and is in Ekiben's manager training program. Ekiben has given wide creative freedom; tools must solve real operating needs, be understandable to staff, and be maintainable after the fellowship.
- **Provided:** this tracker is one of the top three proposed projects. It tracks fellowship work *and* company projects used by Ekiben employees. Other possible projects (manager training, store dashboard, pricing, kitchen ordering, catering playbooks, reviews, store openings, labor reporting) are **not** in scope; reuse is considered only where it is free.
- **Observed (public web, one search):** Ekiben began as a food cart in 2014 and has three restaurants (Fells Point, Hampden, South Baltimore) plus catering; a Frederick location was reported as planned with no opening date. Sources disagree on whether the third location is "South Baltimore" or "Locust Point". Treat the store list as provisional.
- **Observed:** the repo started empty (README only). There were no Ekiben conventions, vendors, or accounts to follow.

## 2. Goal and users

A secure, easy-to-use web tracker Ekiben can try during the fellowship and may keep or expand. Users: Ekiben employees with a verified Ekiben email (**members**) and a known, small set of **admins** (**Provided:** admin list will be sent later; none are recorded here).

## 3. Requirements and acceptance criteria

"Evidence" says what was actually run. Test files are in [tests/](../tests).

| # | Requirement | Acceptance criterion | Status | Evidence |
|---|---|---|---|---|
| R1 | Only verified Ekiben-domain emails get accounts | A code is required; other domains, subdomains, `+` aliases are refused; the database re-checks the domain | Done | `auth.test.ts`, `email-address.test.ts`; live: gmail and `+` alias refused |
| R2 | Roles member/admin, never self-selected | New accounts are members; admin only via allowlist; the app role cannot write `profiles` | Done | `access.test.ts` "roles" group |
| R3 | Member sees own + admin-assigned projects only | Another member's unassigned project is invisible by list, direct URL, comments, events | Done | `access.test.ts` visibility group; live: 404 on direct URL |
| R4 | Admin sees all, creates, edits, assigns, sets stores | As stated | Done | `access.test.ts`; live flow as admin |
| R5 | Multiple assignees per project | Two members assigned in one action; both gain access | Done | `access.test.ts`; live: assigned m2 + m3 |
| R6 | Assignee may update status/next step and comment, nothing else | Other columns refused at the database | Done (**default, unconfirmed with Ekiben**) | `access.test.ts`; live: forged full-edit kept to status/next step |
| R7 | Comments visible to anyone who can see the project | No comments readable otherwise; no forged author | Done | `access.test.ts` |
| R8 | Append-only history; no change without a record | Every tracked change has an event with actor and old/new value; events can't be edited; failed change leaves no event | Done | `access.test.ts` history group |
| R9 | Archive/cancel instead of delete | No DELETE privilege on projects/comments/events | Done | `access.test.ts` |
| R10 | Weekly summary: Monday 00:00 `America/New_York` vs now, DST-correct | Boundary correct on both DST weeks (167 h / 169 h); member sees only accessible projects | Done | `time.test.ts`, `summary.test.ts`; live: admin vs member summaries differ correctly |
| R11 | No privileged keys in browser code | No DB URL/secret strings in client output | Done for the build checked | Searched the 12 files in `.next/static` from the last production build for 8 secret-related strings: 0 hits. Not checked: other builds, server logs |
| R12 | Synthetic data only; visible privacy reminder; no committed secrets | Seed uses reserved domain and `[DEMO]` labels; banner on pages; `.env.local` ignored | Done | Inspected; `git` shows only `.env.example` tracked |
| R13 | Local demo shortcut isolated | Console email refused when `NODE_ENV=production` | Done | `config-guards.test.ts`; live: production start returned 500 and refused |
| R14 | Private demo path then deliberate production decision | Documented checklist | **Documented only, never executed** | [PRIVATE-DEMO.md](PRIVATE-DEMO.md) |

## 4. Permissions (summary)

Full matrix and enforcement layers: [ACCESS.md](ACCESS.md). In short: visitors see only sign-in; members read/write projects they created or were assigned; creators edit all fields of their own projects; assignees change status and next step; only admins assign, reassign, and set stores; nobody deletes; roles and account disabling are owner-script only ([ADMIN.md](ADMIN.md)).

## 5. Decisions, trade-offs, assumptions

| Decision | Why | Cost / alternative not taken |
|---|---|---|
| Next.js + plain PostgreSQL, SQL migrations | One codebase; rules portable to any Postgres; runs locally with what was installed | Supabase was the earlier suggestion; not used because its local stack needs Docker (not installed, **Observed**) and hosted needs an account. Moving to a managed Postgres later is likely but untested |
| Access rules in the database (RLS + triggers) | Hiding buttons is not security; protects every code path including future ones | More SQL to learn and maintain; policies need tests (they have them) |
| Custom passwordless email-code sign-in | No passwords; proves mailbox control; no vendor chosen | Custom auth is a risk: no per-IP limits, no MFA, not independently reviewed. Alternative: Google/Microsoft SSO if Ekiben uses one (**unknown**) |
| Deterministic summary rebuilt from the event log | Reliable start-vs-now without snapshot jobs; auditable | Cost grows with event volume (fine for the expected scale; unmeasured) |
| Single time zone, `America/New_York` | **Provided** | Per-store zones not supported |
| Plain CSS, server-rendered pages, no client JS state | Fewer moving parts to hand over | Less polished UX; no live updates |
| No AI narrative in v1 | Adds a vendor, cost and data egress without proving the tracker | Revisit only after the deterministic summary is used |

**Assumptions (unconfirmed):** domain `ekibenbaltimore.com`; edit rules in R6 and "creators edit own projects"; statuses `not_started / in_progress / blocked / done / cancelled`; priorities low/normal/high; deadline "approaching" = within 7 days; store list; multiple assignees per project is **Provided**, not assumed; expected scale is dozens of projects and a handful of users.

## 6. What was not verified

- The UI was never viewed in a browser or on a phone; checks were HTTP responses and tests.
- The SMTP email path (`EMAIL_TRANSPORT=smtp`) has never been executed; only the console path ran.
- Behavior on a managed Postgres (role creation, connection pooling) is untested.
- No load, accessibility, or independent security review.
- Production backups, restore, ownership, and billing are undesigned by request.

## 7. Open questions (highest impact first)

| Question | Why it matters | Default if unanswered |
|---|---|---|
| Is `ekibenbaltimore.com` the full set of allowed domains? Do staff use Google Workspace or Microsoft 365? | Sign-up eligibility; SSO may be a better login | Single domain, email codes |
| Which admins? (send privately; do not commit) | Admin provisioning | None until provided |
| Do assignees and creators get the edit rights in R6? Is anyone else (e.g. store managers) a distinct role? | Changes triggers and tests | R6 as built; two roles only |
| Which hosting, Postgres, and email sender will Ekiben approve, and who will own them after the fellowship? | Gates any hosted demo with real users | Demo on temporary accounts with synthetic data only |
| Who are the real stores/locations and statuses? | Store picker and workflow fit | Provisional list; change by SQL |
| Where should the weekly summary be delivered (email, Slack, in-app)? Who reviews it? | Next feature after the demo | In-app, admin reviews |
| Must members see each other's names across projects? | Currently only people on shared projects are visible | Keep restricted |
