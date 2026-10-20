# Access rules

## Identity vs. role

- **Email verification** proves the person controls a mailbox at an allowed domain. It never grants admin.
- **Role** (`member` or `admin`) is stored server-side in `profiles.role`. It is set by a database trigger from the `admin_emails` allowlist and nothing else. The web app's database role has **no** INSERT/UPDATE privilege on `profiles`, so there is no request that can change a role. Every role change is logged in `role_changes`.
- Every new account is a `member` unless its (verified) email is on the allowlist.

## Permission matrix

| Action | Visitor | Member | Admin |
|---|---|---|---|
| See sign-in pages | ✅ | ✅ | ✅ |
| Request a code / sign up | Only for an allowed domain, no `+` alias | — | — |
| See any project, comment, history | ❌ | Projects they created, or an admin assigned to them | All |
| Create a project | ❌ | ✅ (creator = self) | ✅ |
| Edit all fields | ❌ | Own created projects | Any |
| Update status + next step | ❌ | Projects assigned to them | Any |
| Assign / reassign (one or many), set stores | ❌ | ❌ | ✅ |
| Archive / restore | ❌ | Own created projects | Any |
| Comment | ❌ | On projects they can see | On any |
| Delete anything | ❌ | ❌ | ❌ (archive/cancel instead) |
| Weekly summary | ❌ | Only projects they can see | All |
| Change roles / disable accounts | ❌ | ❌ | ❌ in the app (owner scripts only) |

Edit and assignment rules are **recommended defaults** to validate with Ekiben.

## Where each rule is enforced

1. **Database (authoritative)** — [db/migrations/002_security.sql](../db/migrations/002_security.sql): row-level security policies decide which rows each user can read or write; triggers decide which *columns* an assignee may change, require admin for assignment/stores, stamp creator/assigner, and write the history; privileges are narrow (no DELETE on projects/comments/history, column-limited INSERT/UPDATE).
2. **Server code** — server actions re-check the signed-in user and limit what each form may send.
3. **Interface** — hides controls the user can't use. This is convenience only.

The web app connects as the restricted `tracker_app` role and sets `app.user_id` per transaction. The app refuses to run queries on a connection that is superuser, has BYPASSRLS, or owns the tables ([lib/db.ts](../lib/db.ts)). No privileged key is ever sent to the browser (the browser receives HTML only; the database URL is server-side).

## History

`project_events` is append-only (triggers block UPDATE/DELETE/TRUNCATE; the app role cannot insert). Events are created by triggers in the same transaction as the change, so a change cannot commit without its record, and an acting user is required for any change.
