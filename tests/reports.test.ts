import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser, asUser, closePools, owner, resetDatabase } from "./helpers/db";

// Synthetic locations and numbers only.
let admin: string, m1: string, m2: string, gone: string, loc: string, oldLoc: string;
const fields = "location_id, report_date, sales, manager_on_duty, weather, temperature_f, longest_ticket_minutes, submitted_by";
const add = (uid: string, l: string, date: string, extra: Partial<Record<string, unknown>> = {}) =>
  asUser(uid, async (c) => (await c.query(
    `insert into nightly_reports (${fields}) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [l, date, extra.sales ?? 1234.5, extra.mod ?? "Demo Manager", extra.weather ?? "sunny", extra.temp ?? 70, extra.ticket ?? 12.5, extra.by ?? uid],
  )).rows[0].id as string);

beforeAll(async () => {
  await resetDatabase();
  await owner.query("insert into admin_emails (email) values ('admin@tracker.test')");
  admin = (await addUser("admin@tracker.test", "Test Admin")).id;
  m1 = (await addUser("one@tracker.test", "Member One")).id;
  m2 = (await addUser("two@tracker.test", "Member Two")).id;
  gone = (await addUser("gone@tracker.test", "Gone Person")).id;
  await owner.query("update profiles set disabled = true where id = $1", [gone]);
  loc = await asUser(admin, async (c) => (await c.query("insert into locations (name) values ('Demo Store A') returning id")).rows[0].id);
  oldLoc = await asUser(admin, async (c) => (await c.query("insert into locations (name) values ('Demo Closed') returning id")).rows[0].id);
  await asUser(admin, (c) => c.query("update locations set archived_at = now() where id = $1", [oldLoc]));
});
afterAll(closePools);

describe("nightly reports", () => {
  let r1: string;
  it("any active member can submit a report for themselves, not for someone else", async () => {
    r1 = await add(m1, loc, "2026-10-20");
    await expect(add(m1, loc, "2026-10-21", { by: m2 })).rejects.toThrow(/row-level security/);
    await expect(add(gone, loc, "2026-10-22")).rejects.toThrow(/row-level security/);
  });

  it("one report per location per night", async () => {
    await expect(add(m2, loc, "2026-10-20")).rejects.toThrow(/duplicate key/);
  });

  it("every active member sees every report (migration 010); a disabled user sees none", async () => {
    await add(m2, loc, "2026-10-19", { sales: 999 });
    const all = await asUser(m1, (c) => c.query("select report_date::text d from nightly_reports order by 1"));
    expect(all.rows).toEqual([{ d: "2026-10-19" }, { d: "2026-10-20" }]);
    expect((await asUser(admin, (c) => c.query("select * from nightly_reports"))).rowCount).toBe(2);
    expect((await asUser(gone, (c) => c.query("select * from nightly_reports"))).rowCount).toBe(0);
  });

  it("the submitter and an admin can correct a report; others cannot; the editor is stamped", async () => {
    const other = await asUser(m2, (c) => c.query("update nightly_reports set sales = 1 where id = $1", [r1]));
    expect(other.rowCount).toBe(0);
    await asUser(m1, (c) => c.query("update nightly_reports set sales = 2000 where id = $1", [r1]));
    await asUser(admin, (c) => c.query("update nightly_reports set general_notes = 'checked' where id = $1", [r1]));
    const r = (await owner.query("select sales, general_notes, updated_by from nightly_reports where id = $1", [r1])).rows[0];
    expect(r).toEqual({ sales: "2000.00", general_notes: "checked", updated_by: admin });
    await expect(asUser(admin, (c) => c.query("update nightly_reports set submitted_by = $2 where id = $1", [r1, admin]))).rejects.toThrow(/permission denied/);
  });

  it("nobody can delete a report", async () => {
    await expect(asUser(admin, (c) => c.query("delete from nightly_reports where id = $1", [r1]))).rejects.toThrow(/permission denied/);
  });

  it("validates the values in the database", async () => {
    await expect(add(m1, loc, "2026-10-01", { sales: -5 })).rejects.toThrow(/sales_check/);
    await expect(add(m1, loc, "2026-10-02", { weather: "hail" })).rejects.toThrow(/weather_check/);
    await expect(add(m1, loc, "2026-10-03", { temp: 200 })).rejects.toThrow(/temperature_f_check/);
    await expect(add(m1, loc, "2026-10-04", { ticket: 9999 })).rejects.toThrow(/longest_ticket_minutes_check/);
    await expect(add(m1, loc, "2026-10-05", { mod: " " })).rejects.toThrow(/manager_on_duty_check/);
  });

  it("refuses new reports for an archived location", async () => {
    await expect(add(m1, oldLoc, "2026-10-06")).rejects.toThrow(/archived/);
  });
});
