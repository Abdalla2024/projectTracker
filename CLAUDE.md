# Ekiben Project Tracker — working rules

Context and requirements: [docs/tracker-brief.md](docs/tracker-brief.md). Setup, commands, limits: [README.md](README.md). Permissions: [docs/ACCESS.md](docs/ACCESS.md).

## Rules
- **Protect sensitive data.** Use synthetic data only (`[DEMO]`, `ekiben-demo.example`). No employee, customer, financial, or payroll data in code, seeds, tests, or docs. Never invent people or admin emails.
- **Never commit secrets.** All `.env*` files stay ignored; no example env files with URLs or passwords. Check staged files before committing.
- **Ask before** deploying, creating accounts or vendors, sending invitations or email, or adding admins.
- **Commit after each coherent addition**, with a message saying what and why. End with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Report only checks actually run.** Give failures with their output, and say what was not verified. Label assumptions; don't present defaults as Ekiben requirements.
- Keep the first version small. Update docs in the same change as behavior.

## Security invariants (don't weaken without asking)
- Access is enforced in the database (row-level security + triggers in `db/migrations`), not only in the UI or server code. Change rules in a new migration, with a test that tries the forbidden action as the restricted `tracker_app` role.
- Roles come only from the `admin_emails` allowlist, managed out of band. The app must never offer role selection or changes.
- Project history is written only by triggers and is append-only.
- The web app never uses the owner connection or exposes database credentials to the browser.
