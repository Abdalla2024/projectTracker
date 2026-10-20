# Online demo on Vercel: setup, verification, rollback

**Status (Oct 20, 2026): deployed but not yet usable, and not yet auto-deploying.**
- Vercel project `ekiben-project-tracker` exists in the `abdalla-abdelmagids-projects` team (Hobby plan). A production deployment built in 23 s and is **Ready** at **https://ekiben-project-tracker.vercel.app**. Anyone can open the sign-in page (the production domain is public), but **sign-in cannot work** until a database and SMTP sender are configured. `/api/health` returns `503 {"ok":false}`; the Vercel runtime log says `DATABASE_URL is not set`.
- **GitHub auto-deploy is not connected.** `vercel git connect` fails ("Failed to connect Abdalla2024/projectTracker"). Most likely the Vercel GitHub app has no access to this new repo; see section 1, item 2. Until then, pushes to `main` do **not** deploy.
- Production environment variables set so far: `AUTH_SECRET` (new, generated and sent straight to Vercel), `ALLOWED_EMAIL_DOMAINS=ekibenbaltimore.com` (provisional until Ekiben confirms), `APP_TIME_ZONE`, `DATABASE_POOL_MAX=3`, `EMAIL_TRANSPORT=smtp`. Still missing: `DATABASE_URL`, `EMAIL_FROM`, `SMTP_*`.

The demo uses the existing app and its PostgreSQL security model (row-level security, triggers, restricted role). It does not need a rewrite or another database product, but it does need a **hosted PostgreSQL** and an **SMTP sender**, because a serverless host has no local database and the sign-in code must be emailed.

## 1. What is still needed

| # | Needed | Why | Default I recommend |
|---|---|---|---|
| 1 | **Decision on the commit author email.** The 14 commits pushed on Oct 20 show your personal Gmail as the author in the **public** repo. Removing it now means rewriting history and force-pushing; copies, forks and caches may remain. | Privacy | Decide whether that matters; commits made after that use the GitHub no-reply address (see below) |
| 2 | **Give Vercel access to the repo.** GitHub → Settings → Applications → Installed GitHub Apps → **Vercel** → Configure → under Repository access, add `projectTracker` (or choose All repositories) → Save. If Vercel isn't listed, install it from the Vercel project's Settings → Git. | The connection fails without it, so pushes can't deploy | Then I rerun `vercel git connect` and test a push |
| 3 | A **hosted PostgreSQL** you approve and own, with an **owner** URL (direct) and a **pooled** URL | The app needs a database | Any provider with roles, row-level security, triggers, TLS |
| 4 | An **SMTP provider** and a verified sender address (host, port, user, password) | Sign-in codes are emailed; there is no other login | Any SMTP service you already use |
| 5 | The **admin emails**, sent privately | Admins come only from the allowlist; none are invented | Give them when ready |
| 6 | Ekiben's confirmation that **`ekibenbaltimore.com`** is the right domain | It is configured, but provisional | Single domain |

**Plan note:** the project is on a Hobby plan. As I understand Vercel's terms, Hobby is for personal, non-commercial use, and a business demo may need a paid plan. Check Vercel's current terms. (Also, a Hobby team cannot deploy from a private repository owned by a GitHub organization: [Vercel Git docs](https://vercel.com/docs/git).)

**Protection, as observed:** the production domain answers anonymously (HTTP 200) so testers need no Vercel login. The unique per-deployment URLs redirect to a Vercel login (HTTP 302). Both are public-facing only as far as the app's own sign-in, which stays in force.

Only for item 1, if you choose to scrub the address (not run; they rewrite history and need a force-push, so only you should approve). For future commits, set the identity first:
```bash
git config user.email "161538926+Abdalla2024@users.noreply.github.com"   # the address your first commit used
# To rewrite already-pushed commits you would additionally need: git rebase --root --exec 'git commit --amend --no-edit --reset-author', then git push --force-with-lease
```
As a further safeguard, GitHub has (as I recall; confirm in your GitHub email settings) an option to block command-line pushes that expose your private email address. The new commit `d9c0328` already uses the no-reply address.

**Plan note (verify before you sign up):** as I understand Vercel's terms, the free Hobby plan is for personal, non-commercial use, and a business demo may need a paid plan. Check Vercel's current terms. Also, a Hobby team cannot deploy from a private repository owned by a GitHub organization ([Vercel Git docs](https://vercel.com/docs/git)).

## 2. One-time setup (in this order)

**A. Database**
1. Create the hosted Postgres. Note two URLs: the **owner** URL (direct, not pooled; used only from your machine) and a **pooled** URL for the app (a serverless host opens many short connections).
2. Require TLS. Put `?sslmode=verify-full` on the URLs. The `pg` driver is documented to be moving away from the meaning of `sslmode=require`, so `verify-full` is explicit. I confirmed the driver refuses a non-TLS server with this setting; I could not test certificate checking against a real provider.
3. From your machine (not Vercel), create the runtime role and apply migrations:
   ```bash
   DATABASE_ADMIN_URL='postgres://OWNER:PASSWORD@HOST/DB?sslmode=verify-full' \
   APP_DB_PASSWORD='<new long random password>' npm run db:setup
   ```
   This works with an existing database and a non-superuser owner (it does not need CREATEDB). It fails loudly if the runtime role would be privileged. It does **not** run on deploys; migrations are a separate, deliberate step.
4. Check the result:
   ```sql
   select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls from pg_roles where rolname = 'tracker_app';  -- all false
   select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity;  -- 9
   ```
5. Make admins (after you provide the emails): `DATABASE_ADMIN_URL=… npm run admin -- grant person@ekibenbaltimore.com`. Admin changes always use the owner URL from a trusted machine, never from Vercel.

**B. Vercel project** (steps 1 and the non-database variables are already done; see Status)
1. Vercel dashboard → **Add New → Project → Import Git Repository** → pick `Abdalla2024/projectTracker`. Framework is detected as Next.js; keep the default build command (`npm run build`) and output. Production branch: `main`.
2. Before the first deploy, add the environment variables below under **Settings → Environment Variables**, scoped to **Production** only. Mark secrets as Sensitive.

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgres://tracker_app:<APP_DB_PASSWORD, URL-encoded>@<POOLED_HOST>/<db>?sslmode=verify-full` |
| `DATABASE_POOL_MAX` | `3` (per instance; each serverless instance has its own pool) |
| `AUTH_SECRET` | a new value from `openssl rand -hex 32` (never reuse the local one) |
| `ALLOWED_EMAIL_DOMAINS` | `ekibenbaltimore.com` (once confirmed) |
| `APP_TIME_ZONE` | `America/New_York` |
| `EMAIL_TRANSPORT` | `smtp` |
| `EMAIL_FROM` | `Ekiben Project Tracker <verified-sender@your-domain>` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | from your provider. Port 587 uses STARTTLS; port 465 uses implicit TLS (handled by the app) |

Do **not** set: `DEV_ALLOWED_EMAIL` (the app refuses all sign-in if it is set in production), `DATABASE_ADMIN_URL`, or `APP_DB_PASSWORD` (owner credentials never go to Vercel). Do not add the `ekiben-demo.example` domain. Previews: leave the variables unset for Preview, so pull-request deployments build but cannot reach the database.
3. Deploy. Done once from the CLI (`vercel deploy --prod`); after the Git connection works, every push to `main` deploys.

**Gotchas seen with the Vercel CLI:** `vercel link` rewrote local `.env.local` (added a `VERCEL_OIDC_TOKEN` line) and appended an `.env*` rule to `.gitignore` that would hide `.env.example`; both were reverted by hand. `.vercelignore` keeps local env files out of CLI uploads (checked: the deployment contains `.env.example` only). Set Vercel env vars with `printf '%s' value | vercel env add NAME production`, which keeps secrets out of shell history and files.

## 3. Verify the deployment

1. `GET https://<your-url>/api/health` → `{"ok":true,"database":"connected","rowLevelSecurity":true}`. Any failure (including a privileged `DATABASE_URL`) returns `503 {"ok":false}`; the cause is in the Vercel function logs.
2. Sign in with a real Ekiben address: the 6-digit code arrives by email; sign in; you land as a **member** unless the address is on the admin allowlist.
3. With two accounts (one admin, one member), repeat the checks in [ACCESS.md](ACCESS.md): the member cannot see another member's unassigned project (a direct URL gives "Project not found"); the admin assigns a project to two people; the assignees can see it and update status and next step; history records every change; the weekly summary shows each person only their own projects.
4. Use synthetic projects only. Do not enter real Ekiben, customer, or financial data without approval.

**Confirm automatic deployments:** Vercel deploys every push to the production branch, and other branches and pull requests become preview deployments ([docs](https://vercel.com/docs/git)). To check it: push a small commit (for example a doc typo) to `main`, then open **Deployments** in the Vercel project. A new **Production** deployment should appear with that commit's message and SHA. Also check **Settings → Git** to confirm the repository is connected and the production branch is `main`. This cannot be confirmed until the project exists.

## 4. Releasing changes
- **Code-only change:** push to `main`; Vercel builds and promotes it.
- **Change with a migration:** migrations only move forward. Make the migration backward-compatible with the code currently live, run `npm run db:setup` against the hosted database first, then push the code. Never edit an applied migration; add a new numbered file.
- Run `npm test` and `npm run typecheck` before pushing.

## 5. Rollback
- **Bad deployment:** in Vercel, **Deployments → ⋯ on a previous good deployment → Instant Rollback** (or `vercel rollback <deployment-url>`). It re-points the production domain without rebuilding, so **environment variable changes are not applied by a rollback**, and while a rollback is active new pushes to `main` do **not** go live until you promote a deployment again (**Undo Rollback**, or `vercel promote <deployment>`). On the Hobby plan only the immediately previous deployment is eligible ([docs](https://vercel.com/docs/deployments/instant-rollback)).
- **Bad environment variable:** fix it in Settings and redeploy (a rollback will not pick it up).
- **Bad migration:** there is no automatic undo. Restore from the database provider's backup/point-in-time recovery if one exists, or write a new corrective migration. Check your provider's backup options before inviting testers.
- **Stop access quickly:** `npm run admin -- disable <email>` blocks one person immediately. To take the whole demo offline, remove `DATABASE_URL` from Vercel and redeploy (the app then returns errors and no data is reachable), or pause/delete the project in the Vercel dashboard.
- **Rotate secrets:** change `AUTH_SECRET` (signs out nobody directly but invalidates pending codes) and the SMTP password in Vercel and redeploy; change the database password with `npm run db:setup` (new `APP_DB_PASSWORD`) and update `DATABASE_URL`.

## 6. What was verified before deployment
Run locally; see [tracker-brief.md](tracker-brief.md) for the full, current list.
- The existing 81 tests plus 4 for the health endpoint pass (85), also against a throwaway Postgres whose owner is **not a superuser** and cannot create databases.
- `db:setup` applied all migrations to an existing database as that limited owner, and re-running it did nothing.
- A production build runs with **no environment variables** at build time; served with `next start` it sent sign-in codes over real SMTP (to a local test receiver), set a `Secure; HttpOnly; SameSite=Lax` session cookie, and passed the same Chrome walkthrough at desktop and phone sizes as the dev build (47 checks each).
- The SMTP implicit-TLS fix was reproduced against a TLS-only test server (old settings timed out; the fix delivered).

## 7. Not verified (needs the real accounts)
Hosting itself; the GitHub–Vercel connection and push-to-deploy; a real hosted Postgres (provider-specific role rules, pooler behavior in transaction mode, certificate checks); a real SMTP provider and deliverability (spam folders, sender verification); Vercel plan terms; backups and restore; behavior from a phone on real networks.

## 8. Before any production use (not designed here)
A named owner after the fellowship, who pays for and owns each account, backups and a tested restore, secret rotation, data retention, an incident contact, and whether to use Google/Microsoft sign-in instead of email codes. A password-protected preview or deployment-protection setting adds a layer but does not replace the app's own sign-in.
