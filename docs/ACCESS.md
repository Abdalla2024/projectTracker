# Access rules

## Identity vs. role

- **Email verification** proves the person controls a mailbox at an allowed domain. It never grants admin.
- **Role** (`member` or `admin`) is stored server-side in `profiles.role`. It is set by a database trigger from the `admin_emails` allowlist and nothing else. The web app's database role has **no** INSERT/UPDATE privilege on `profiles`, so there is no request that can change a role. Every role change is logged in `role_changes`.
- Every new account is a `member` unless its (verified) email is on the allowlist.

## Permission matrix (shared workspace, migration 008)

| Action | Visitor | Member | Admin |
|---|---|---|---|
| See sign-in pages | ✅ | ✅ | ✅ |
| Sign up | Allowed domain, or an exact address in `ALLOWED_EMAILS`; no `+` alias | — | — |
| See every project, task, comment, history | ❌ | ✅ | ✅ |
| Create a project, edit any project's details | ❌ | ✅ (creator = self) | ✅ |
| Assign / unassign people (projects and tasks) | ❌ | ✅ | ✅ |
| Add, edit, complete, delete tasks and sections | ❌ | ✅ | ✅ |
| Archive / restore a project | ❌ | Projects they created | Any |
| Comment and reply | ❌ | ✅ (as themselves) | ✅ |
| Edit or delete a comment | ❌ | Their own only | Their own only |
| Delete a project or history | ❌ | ❌ | ❌ (archive/cancel instead) |
| Create, rename, recolour, archive locations and teams | ❌ | ❌ | ✅ |
| Submit a nightly report | ❌ | ✅ (as themselves) | ✅ |
| See and correct nightly reports | ❌ | The ones they submitted | All |
| Dashboard (sales charts) and Settings | ❌ | ❌ | ✅ |
| Weekly summary | ❌ | All projects (no store snapshot) | All projects + store snapshot |
| Change roles / disable accounts | ❌ | ❌ | ❌ in the app (owner scripts only) |

Disabled accounts see and change nothing. **Defaults to confirm with Ekiben:** that every staff member may edit every project (as in Asana), and that only admins see sales.

## Where each rule is enforced

1. **Database (authoritative)** — [db/migrations](../db/migrations) (002 for the base rules, 008 for the shared workspace, 009 for nightly reports): row-level security policies decide which rows each user can read or write; triggers restrict archiving to the creator or an admin, keep tasks inside their project, stamp creators, assigners, completers and editors, and write the history; privileges are narrow (no DELETE on projects/comments/history, column-limited INSERT/UPDATE; comments can be changed only by their author, through migration 007).
2. **Server code** — server actions re-check the signed-in user and limit what each form may send.
3. **Interface** — hides controls the user can't use. This is convenience only.

The web app connects as the restricted `tracker_app` role and sets `app.user_id` per transaction. The app refuses to run queries on a connection that is superuser, has BYPASSRLS, or owns the tables ([lib/db.ts](../lib/db.ts)). No privileged key is ever sent to the browser (the browser receives HTML only; the database URL is server-side).

## History

`project_events` is append-only (triggers block UPDATE/DELETE/TRUNCATE; the app role cannot insert). Events are created by triggers in the same transaction as the change, so a change cannot commit without its record, and an acting user is required for any change.
