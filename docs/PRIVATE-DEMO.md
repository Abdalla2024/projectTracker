# Online demo: Vercel + Supabase database + SMTP

The app is deployed on Vercel at **https://ekiben-project-tracker.vercel.app** (Hobby plan, project `ekiben-project-tracker`). The Git connection is set up. Sign-in does not work yet: it still needs the Supabase connection details and an email sender (section 1). Use synthetic data only. Do not enter real Ekiben, customer, or financial data without approval.

## 0. Status (Oct 20, 2026)
- **Done:** project created; **push-to-deploy confirmed** (pushing commit `0676051` to `main` created a production deployment with source `git`, which reached READY); production build succeeds on Vercel; GitHub repo `Abdalla2024/projectTracker` connected with `main` as the production branch (`vercel git connect` reported "Connected"; the project's Git link shows that repo and branch); production variables set for `AUTH_SECRET`, `ALLOWED_EMAIL_DOMAINS=ekibenbaltimore.com` (provisional until Ekiben confirms), `APP_TIME_ZONE`, `DATABASE_POOL_MAX`, `EMAIL_TRANSPORT=smtp`.
- **Not done:** `DATABASE_URL`, `DATABASE_CA_CERT`, `EMAIL_FROM`, `SMTP_*`; database setup; admin accounts (deliberately postponed). 
- **Protection, as observed:** the production domain answers anonymously (HTTP 200), so testers need no Vercel login. Per-deployment URLs redirect to a Vercel login.
- **Plan note:** Hobby is, as I understand Vercel's terms, for personal non-commercial use; a business demo may need a paid plan. Check Vercel's current terms.

## 1. What is needed from you

Fill these in **yourself**, in a file, so passwords never appear in chat.

1. **Create `.env.remote`**: create a file named `.env.remote` containing these variables: `DATABASE_ADMIN_URL` (Supabase Session pooler string, port 5432), `APP_DB_PASSWORD` (a new random password), `DATABASE_CA_CERT_FILE` (absolute path to Supabase's downloaded CA certificate), `DATABASE_URL` (Transaction pooler string, port 6543, with user `tracker_app.<project-ref>` and `APP_DB_PASSWORD`), `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`. `.env.*` is git-ignored. It is ignored by git and never uploaded to Vercel. Tell me when it is filled in; I run the setup and copy the right values into Vercel without printing them.
2. **From the Supabase dashboard** (click **Connect** at the top of the project):
   - **Session pooler** string (port 5432) → `DATABASE_ADMIN_URL`. Use this one from your computer, not "Direct connection", which is IPv6-only by default ([Supabase docs](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI)). The user looks like `postgres.<project-ref>`; the password is your database password.
   - **Transaction pooler** string (port 6543) → `DATABASE_URL`, but with the user changed to **`tracker_app.<project-ref>`** and the password set to your new `APP_DB_PASSWORD`. Transaction mode is Supabase's recommendation for serverless hosts and does not support prepared statements, which this app does not use.
   - **CA certificate**: Project Settings → Database → SSL configuration → download, and put the file path in `DATABASE_CA_CERT_FILE`. Supabase's certificates are signed by its own CA, which Node does not trust by default; without it the connection fails certificate verification (section 3).
3. **An email sender (SMTP).** See the next subsection. You need host, port, user, password, and a verified sender address for `EMAIL_FROM`.
4. **Confirmation from Ekiben** that `ekibenbaltimore.com` is the right domain (still provisional).
5. *(Later)* admin emails, sent privately, when you want admin accounts.

### About Supabase's custom SMTP feature
Supabase's custom SMTP setting configures emails sent by **Supabase Auth** (its own sign-up, magic-link and OTP flows); its docs tie it to those flows ([Supabase docs](https://supabase.com/docs/guides/auth/auth-smtp)). **This app does not use Supabase Auth**: it has its own sign-in codes, generated and emailed by the app, with only a hash stored in the database. So that setting will not send this app's emails. You still need an SMTP service, and the same provider can be used in both places. Any SMTP provider works: put its host, port, user, password and a verified sender in `.env.remote`. Sending as an Ekiben address usually requires the provider to verify the domain (DNS records) or at least a single sender address; follow the provider's instructions. Replacing the app's login with Supabase Auth would be a rewrite of the sign-in and its role rules, which this plan deliberately avoids.

## 2. Setup (after section 1)

**A. Database (from your machine)**
```bash
npm run db:setup:remote     # creates the restricted tracker_app role, applies migrations 001-005, then checks the result
```
It fails loudly if the app role would be privileged, or if any Supabase API role (`anon`, `authenticated`, `service_role`) can still reach our tables or functions. It is safe to re-run: it applies only what is missing and repeats the checks. To verify by hand:
```sql
select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls from pg_roles where rolname = 'tracker_app';  -- all false
select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity;  -- 9
```
Admins later: `npm run admin:remote -- grant person@ekibenbaltimore.com`.

**B. Vercel environment variables** (Production only; secrets as Sensitive). Already set: `AUTH_SECRET`, `ALLOWED_EMAIL_DOMAINS`, `APP_TIME_ZONE`, `DATABASE_POOL_MAX`, `EMAIL_TRANSPORT`. To add: `DATABASE_URL`, `DATABASE_CA_CERT` (the certificate's text), `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS or 465 implicit TLS; both supported), `SMTP_USER`, `SMTP_PASSWORD`. Do **not** set `DEV_ALLOWED_EMAIL` (production refuses all sign-in if it is set), `DATABASE_ADMIN_URL`, or `APP_DB_PASSWORD`. Set them with `printf '%s' value | vercel env add NAME production`, which keeps secrets out of files and shell history, then redeploy (a rollback does not pick up variable changes).

**C. Deploy and check.** Push to `main` (or `vercel deploy --prod`). Then:
1. `GET /api/health` → `{"ok":true,"database":"connected","rowLevelSecurity":true}`. Any failure returns `503 {"ok":false}`; the reason is in the Vercel runtime logs (`vercel logs`).
2. Sign in with a real Ekiben address: the code arrives by email; you are a **member** unless on the admin allowlist.
3. With two accounts, repeat the checks in [ACCESS.md](ACCESS.md) (members cannot see others' unassigned projects; assignment; history; summaries). Admin-only checks need an admin account.

**Confirm automatic deployments:** push a small commit to `main`, then open **Deployments** in the Vercel project: a new **Production** deployment should appear with that commit's SHA. Other branches and pull requests become preview deployments ([Vercel Git docs](https://vercel.com/docs/git)). Previews have no database variables, so they build but cannot sign anyone in.

## 3. Supabase-specific safeguards (why the app was changed)

- **API roles must not reach our database objects.** Supabase's public API runs as `anon`/`authenticated`/`service_role`, and by default those roles get privileges on everything the owner creates, including EXECUTE on functions. Our sign-in logic is in database functions that trust their caller to be the app's own role. In a model of that setup, an anonymous caller could request a login code with a hash they chose, then log in (as admin, for an allowlisted address) with no email verification. Migration 005 revokes those privileges and makes new functions closed by default; `db:setup` now fails if any remain. As extra protection, if the dashboard lets you turn off the Data API (REST/GraphQL), do so: this app does not use it. I could not check the dashboard's wording or whether the platform can re-grant defaults later, so re-run `npm run db:setup:remote` after any Supabase configuration change; it repeats the check.
- **TLS with the provider's CA.** With `DATABASE_CA_CERT` / `DATABASE_CA_CERT_FILE` set, the app and scripts verify the server's certificate chain **and** host name against that CA. Tested against a database using a private CA: no CA, a wrong CA, and a certificate for the wrong host name are all refused; the right CA connects.
- **Pooling.** Every request runs in one transaction and sets the acting user with a transaction-local setting, the pattern that is safe behind a transaction pooler. Not yet tested on Supabase's pooler.

## 4. Releasing and rollback
- **Code-only change:** push to `main`. **With a migration:** migrations only move forward and never run on deploy; make the change backward-compatible with the live code, run `npm run db:setup:remote` first, then push. Never edit an applied migration; add a new numbered file. Run `npm test` and `npm run typecheck` before pushing.
- **Bad deployment:** Vercel → Deployments → previous good deployment → **Instant Rollback** (or `vercel rollback <url>`). It re-points the domain without rebuilding, so environment variable changes are **not** applied, and while a rollback is active new pushes to `main` do not go live until you promote again (**Undo Rollback**, or `vercel promote <deployment>`). On Hobby only the immediately previous deployment is eligible ([docs](https://vercel.com/docs/deployments/instant-rollback)).
- **Bad variable:** fix it in Settings and redeploy.
- **Bad migration:** no automatic undo. Restore from Supabase's backups if your plan has them (check before inviting testers) or write a corrective migration.
- **Stop access quickly:** `npm run admin:remote -- disable <email>` blocks one person immediately. To take the demo offline, remove `DATABASE_URL` in Vercel and redeploy, or delete the Vercel project.
- **Rotate secrets:** change `AUTH_SECRET` (invalidates pending login codes only) and the SMTP password in Vercel; rotate the app database password by running `db:setup:remote` with a new `APP_DB_PASSWORD` and updating `DATABASE_URL`.
- **CLI gotchas:** `vercel link` rewrote local `.env.local` and appended an `.env*` rule to `.gitignore`; both were reverted. `.vercelignore` keeps env files out of CLI uploads (checked: the upload contained no env files).

## 5. Verified before the real database exists
Details and counts: [tracker-brief.md](tracker-brief.md).
- The full test suite passes locally, and on a throwaway Postgres whose owner is a non-superuser with Supabase-style API roles present (2 tests skip there by design: they need to impersonate roles).
- The Supabase-style exposure was reproduced (an anonymous caller became admin) and then blocked; the setup check was shown to fail when one grant is re-opened.
- The setup and admin scripts, and the production app (`/api/health`), connect over TLS with a private CA only when the CA is supplied.
- A production build with no environment variables; production-mode runs with SMTP delivery, `Secure; HttpOnly; SameSite=Lax` cookies, and the Chrome walkthrough at desktop and phone size (47 checks each).

## 6. Not verified (needs the real accounts)
Supabase itself (role creation as its `postgres` user, its pooler in transaction mode, its certificate chain with the downloaded CA, the Data API setting, default privileges re-applied by the platform); a real SMTP provider and deliverability; Vercel plan terms; backups and restore.

## 7. Before any production use (not designed here)
A named owner after the fellowship, who pays for and owns each account, backups and a tested restore, secret rotation, data retention, an incident contact, and whether to use Google/Microsoft sign-in instead of email codes. Deployment protection or a password adds a layer but does not replace the app's own sign-in.
