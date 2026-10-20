# Administering accounts and admins

There is deliberately no admin or role screen in the app. Admin status comes from an allowlist table changed only through the owner database connection (`DATABASE_ADMIN_URL`).

## Make someone an admin
```bash
npm run admin -- grant person@ekibenbaltimore.com
```
They become admin the next time they sign in (or immediately, if they already have an account). The list of admin emails is **not stored in this repository** — keep it in Ekiben's private records.

## Remove admin
```bash
npm run admin -- revoke person@ekibenbaltimore.com    # back to member
npm run admin -- list                                  # allowlist + account state
```

## Offboarding (someone leaves)
```bash
npm run admin -- disable person@ekibenbaltimore.com
```
A disabled account loses access immediately (existing sessions stop working), can't sign in again, and can't be assigned. Their past comments and history stay. `enable` reverses it. Also `revoke` them if they were an admin.

## Audit
`select * from role_changes order by id;` shows every role change with time and the database user that made it.

## Allowed domains
Set `ALLOWED_EMAIL_DOMAINS` (comma-separated; exact match, no subdomains). The database re-checks the same list when creating an account.
