import { describe, expect, it } from "vitest";
import { localDateString, weekWindow } from "@/lib/time";

const Z = "America/New_York";

describe("weekWindow (America/New_York)", () => {
  it("starts the current week at Monday 00:00 local time (EDT = UTC-4)", () => {
    // Tue Oct 20 2026, 3pm EDT
    const w = weekWindow(new Date("2026-10-20T19:00:00Z"), Z);
    expect(w.start.toISOString()).toBe("2026-10-19T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-20T19:00:00.000Z"); // "now" for the current week
    expect(w.isCurrent).toBe(true);
  });

  it("treats Sunday night and Monday morning on either side of the boundary correctly", () => {
    // Sun Oct 25 2026 11:59pm EDT is still the week of Oct 19; Mon Oct 26 12:01am EDT is the next week.
    expect(weekWindow(new Date("2026-10-26T03:59:00Z"), Z).start.toISOString()).toBe("2026-10-19T04:00:00.000Z");
    expect(weekWindow(new Date("2026-10-26T04:01:00Z"), Z).start.toISOString()).toBe("2026-10-26T04:00:00.000Z");
  });

  it("handles the fall-back DST change (Nov 1 2026): the week is 169h and the next Monday is UTC-5", () => {
    const w = weekWindow(new Date("2026-11-04T17:00:00Z"), Z, 1); // last week relative to Wed Nov 4
    expect(w.start.toISOString()).toBe("2026-10-26T04:00:00.000Z"); // Mon 00:00 EDT
    expect(w.end.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // Mon 00:00 EST
    expect((w.end.getTime() - w.start.getTime()) / 3600000).toBe(169);
    expect(w.isCurrent).toBe(false);
  });

  it("handles the spring-forward DST change (Mar 8 2026): the week is 167h", () => {
    const w = weekWindow(new Date("2026-03-11T17:00:00Z"), Z, 1); // week of Mar 2
    expect(w.start.toISOString()).toBe("2026-03-02T05:00:00.000Z"); // EST
    expect(w.end.toISOString()).toBe("2026-03-09T04:00:00.000Z"); // EDT
    expect((w.end.getTime() - w.start.getTime()) / 3600000).toBe(167);
  });

  it("uses the local date, not the UTC date", () => {
    expect(localDateString(new Date("2026-10-21T02:30:00Z"), Z)).toBe("2026-10-20"); // 10:30pm EDT
  });
});
