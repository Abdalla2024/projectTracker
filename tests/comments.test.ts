import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser, asUser, closePools, createProject, owner, resetDatabase } from "./helpers/db";

// Synthetic users on the reserved .test TLD.
let admin: string, m1: string, m2: string, m3: string;
let p1: string, p2: string; // p1 by m1 (admin sees it), p2 by m2 (m1 cannot see it)

beforeAll(async () => {
  await resetDatabase();
  await owner.query("insert into admin_emails (email) values ('admin@tracker.test')");
  admin = (await addUser("admin@tracker.test", "Test Admin")).id;
  m1 = (await addUser("one@tracker.test", "Member One")).id;
  m2 = (await addUser("two@tracker.test", "Member Two")).id;
  m3 = (await addUser("three@tracker.test", "Member Three")).id;
  p1 = await createProject(m1, "P1 by member one");
  p2 = await createProject(m2, "P2 by member two");
});
afterAll(closePools);

const post = (uid: string, project: string, body: string, parent: string | null = null) =>
  asUser(uid, async (c) =>
    (await c.query("insert into comments (project_id, author_id, body, parent_id) values ($1,$2,$3,$4) returning id", [project, uid, body, parent])).rows[0].id as string);
const events = async (project: string) =>
  (await owner.query("select event_type from project_events where project_id = $1 order by id", [project])).rows.map((r) => r.event_type as string);

describe("comment threads", () => {
  let top: string, reply: string;

  it("an admin who can see a member's project can reply to a comment; so can the author", async () => {
    top = await post(m1, p1, "top comment");
    reply = await post(admin, p1, "admin reply", top);
    const again = await post(m1, p1, "author reply", top);
    const rows = (await owner.query("select id, parent_id from comments where project_id = $1", [p1])).rows;
    expect(rows.find((r) => r.id === reply).parent_id).toBe(top);
    expect(rows.find((r) => r.id === again).parent_id).toBe(top);
  });

  it("replies must answer a top-level comment of the same project", async () => {
    await expect(post(m1, p1, "reply to a reply", reply)).rejects.toThrow(/top-level comment/);
    const other = await post(m2, p2, "other project");
    await expect(post(admin, p1, "cross-project", other)).rejects.toThrow(/top-level comment/);
    await expect(post(m1, p1, "missing parent", "00000000-0000-0000-0000-000000000000")).rejects.toThrow();
  });

  it("in the shared workspace any member can reply on any project", async () => {
    const r = await post(m3, p1, "reply from a colleague", top);
    expect(r).toBeTruthy();
  });
});

describe("editing and deleting comments", () => {
  let c1: string;
  beforeAll(async () => { c1 = await post(m1, p1, "first draft"); });

  it("the author can edit; edited_at is set by the database and an event is logged", async () => {
    await asUser(m1, (c) => c.query("update comments set body = 'second draft' where id = $1", [c1]));
    const r = (await owner.query("select body, edited_at from comments where id = $1", [c1])).rows[0];
    expect(r.body).toBe("second draft");
    expect(r.edited_at).not.toBeNull();
    expect(await events(p1)).toContain("comment_edited");
  });

  it("nobody else can edit or delete it, not even an admin", async () => {
    for (const uid of [admin, m2, m3]) {
      const edit = await asUser(uid, (c) => c.query("update comments set body = 'hijack' where id = $1", [c1]));
      expect(edit.rowCount, "edit by " + uid).toBe(0);
      const del = await asUser(uid, (c) => c.query("update comments set deleted_at = now() where id = $1", [c1]));
      expect(del.rowCount, "delete by " + uid).toBe(0);
    }
    expect((await owner.query("select body from comments where id = $1", [c1])).rows[0].body).toBe("second draft");
  });

  it("only the text can change: author, project, parent and time are fixed", async () => {
    await expect(asUser(m1, (c) => c.query("update comments set author_id = $2 where id = $1", [c1, admin]))).rejects.toThrow(/permission denied/);
    await expect(asUser(m1, (c) => c.query("update comments set project_id = $2 where id = $1", [c1, p2]))).rejects.toThrow(/permission denied/);
    await expect(asUser(m1, (c) => c.query("update comments set created_at = now() where id = $1", [c1]))).rejects.toThrow(/permission denied/);
  });

  it("a blank edit is refused", async () => {
    await expect(asUser(m1, (c) => c.query("update comments set body = '   ' where id = $1", [c1]))).rejects.toThrow(/comments_body_check/);
  });

  it("deleting erases the text but keeps the row, its replies, and logs an event", async () => {
    const parent = await post(m1, p1, "to be deleted");
    const kid = await post(admin, p1, "reply stays", parent);
    await asUser(m1, (c) => c.query("update comments set deleted_at = now() where id = $1", [parent]));
    const r = (await owner.query("select body, deleted_at from comments where id = $1", [parent])).rows[0];
    expect(r.body).toBe("");
    expect(r.deleted_at).not.toBeNull();
    expect((await owner.query("select parent_id from comments where id = $1", [kid])).rows[0].parent_id).toBe(parent);
    expect(await events(p1)).toContain("comment_deleted");
  });

  it("a deleted comment cannot be edited, restored or replied to", async () => {
    const gone = await post(m1, p1, "gone soon");
    await asUser(m1, (c) => c.query("update comments set deleted_at = now() where id = $1", [gone]));
    await expect(asUser(m1, (c) => c.query("update comments set body = 'back' where id = $1", [gone]))).rejects.toThrow(/deleted comment/);
    await expect(asUser(m1, (c) => c.query("update comments set deleted_at = null where id = $1", [gone]))).rejects.toThrow(/deleted comment/);
    await expect(post(admin, p1, "reply to deleted", gone)).rejects.toThrow(/top-level comment/);
  });

  it("history records who edited or deleted, never the text", async () => {
    const rows = (await owner.query("select * from project_events where event_type in ('comment_edited','comment_deleted')")).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect([r.old_value, r.new_value]).toEqual([null, null]);
  });

  it("the app role still cannot delete comment rows or rewrite history", async () => {
    await expect(asUser(m1, (c) => c.query("delete from comments where id = $1", [c1]))).rejects.toThrow(/permission denied/);
    await expect(asUser(m1, (c) => c.query("update project_events set field = 'x'"))).rejects.toThrow(/permission denied/);
  });
});

describe("phase and progress come from tasks (migration 011)", () => {
  it("a typed-in phase, progress or status is replaced by the computed values", async () => {
    const id = await asUser(m1, async (c) =>
      (await c.query("insert into projects (name, status, created_by, phase, progress) values ('Phased', 'in_progress', $1, 'Typed phase', 40) returning id", [m1])).rows[0].id as string);
    expect((await owner.query("select status, phase, progress from projects where id = $1", [id])).rows[0]).toEqual({ status: "not_started", phase: "", progress: 0 });
    await asUser(m2, (c) => c.query("update projects set phase = 'Tasting', progress = 70, status = 'done' where id = $1", [id]));
    expect((await owner.query("select status, phase, progress from projects where id = $1", [id])).rows[0]).toEqual({ status: "not_started", phase: "", progress: 0 });
  });
});
