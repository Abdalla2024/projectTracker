import { describe, expect, it } from "vitest";
import { buildDashboard, dateRange, trendLine, type ReportRow } from "@/lib/dashboard";

const A = { id: "a", name: "Demo Store A", color: "#2a78d6" };
const B = { id: "b", name: "Demo Store B", color: "#eb6834" };
const r = (location_id: string, report_date: string, sales: number, extra: Partial<ReportRow> = {}): ReportRow => ({
  location_id, report_date, sales, weather: "sunny", temperature_f: 70, longest_ticket_minutes: 10, ...extra,
});

describe("dashboard maths", () => {
  it("lists every day in a range, inclusive, across a month end", () => {
    expect(dateRange("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("fits a straight line and refuses one with too few or flat points", () => {
    const t = trendLine([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])!;
    expect(t).toEqual({ x1: 0, y1: 1, x2: 2, y2: 5 });
    expect(trendLine([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
    expect(trendLine([{ x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }])).toBeNull();
  });

  const reports = [
    r("a", "2026-10-19", 1000, { weather: "sunny", temperature_f: 80, longest_ticket_minutes: 12 }), // Mon
    r("a", "2026-10-20", 2000, { weather: "rain", temperature_f: 50, longest_ticket_minutes: 30 }),
    r("b", "2026-10-19", 3000, { weather: "sunny", temperature_f: 82, longest_ticket_minutes: null }),
    r("b", "2026-10-25", 500, { weather: "rain", temperature_f: 48 }), // outside the range
  ];
  const d = buildDashboard({
    reports, previous: [r("a", "2026-10-12", 400), r("b", "2026-10-12", 600)], locations: [A, B],
    from: "2026-10-19", to: "2026-10-21", missingFrom: "2026-10-19",
  });

  it("totals, averages, worst ticket and completeness", () => {
    expect(d.kpis).toEqual({
      totalSales: 6000, previousSales: 1000, avgDailySales: 2000, avgTicket: 21,
      worstTicket: { minutes: 30, date: "2026-10-20", location: "Demo Store A" }, submitted: 3, expected: 6,
    });
  });

  it("one series per location, with a gap (null) where a night has no report", () => {
    expect(d.salesByDay.map((s) => s.name)).toEqual(["Demo Store A", "Demo Store B"]);
    expect(d.salesByDay[0].points).toEqual([{ x: "2026-10-19", y: 1000 }, { x: "2026-10-20", y: 2000 }, { x: "2026-10-21", y: null }]);
    expect(d.ticketByDay[1].points[0].y).toBeNull(); // no ticket time recorded
  });

  it("averages sales by weather (fixed order) and by weekday, with counts", () => {
    expect(d.salesByWeather).toEqual([
      { key: "sunny", label: "Sunny", value: 2000, count: 2 },
      { key: "rain", label: "Rain", value: 2000, count: 1 },
    ]);
    expect(d.salesByWeekday).toEqual([
      { key: "Mon", label: "Mon", value: 2000, count: 2 },
      { key: "Tue", label: "Tue", value: 2000, count: 1 },
    ]);
  });

  it("totals per location, temperature points, and missing reports", () => {
    expect(d.salesByLocation.map((b) => [b.label, b.value, b.count])).toEqual([["Demo Store A", 3000, 2], ["Demo Store B", 3000, 1]]);
    expect(d.salesVsTemp).toHaveLength(3);
    expect(d.missing).toEqual([
      { date: "2026-10-20", location: "Demo Store B", locationId: "b" },
      { date: "2026-10-21", location: "Demo Store A", locationId: "a" },
      { date: "2026-10-21", location: "Demo Store B", locationId: "b" },
    ]);
  });

  it("narrows to one location and handles no reports at all", () => {
    const one = buildDashboard({ reports, previous: null, locations: [A], from: "2026-10-19", to: "2026-10-20", missingFrom: "2026-10-19" });
    expect(one.kpis.totalSales).toBe(3000);
    expect(one.kpis.previousSales).toBeNull();
    const none = buildDashboard({ reports: [], previous: [], locations: [A, B], from: "2026-10-19", to: "2026-10-19", missingFrom: "2026-10-19" });
    expect(none.kpis).toMatchObject({ totalSales: 0, avgDailySales: null, avgTicket: null, worstTicket: null, submitted: 0, expected: 2 });
    expect(none.salesByWeather).toEqual([]);
    expect(none.trend).toBeNull();
  });
});

describe("missing reports window", () => {
  it("does not count tonight as missing when the check stops at yesterday", () => {
    const d = buildDashboard({
      reports: [r("a", "2026-10-20", 100)], previous: null, locations: [A], from: "2026-10-19", to: "2026-10-21",
      missingFrom: "2026-10-19", missingTo: "2026-10-20",
    });
    expect(d.missing.map((m) => m.date)).toEqual(["2026-10-19"]);
  });
});
