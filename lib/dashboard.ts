// Nightly-report analytics. Pure functions over report rows, so they are easy to test.
import { DateTime } from "luxon";
import { WEATHER_LABELS, WEATHER_ORDER } from "./weather";

export interface ReportRow {
  report_date: string; // YYYY-MM-DD
  location_id: string;
  sales: number;
  weather: string;
  temperature_f: number;
  longest_ticket_minutes: number | null;
}
export interface Loc { id: string; name: string; color: string }

export interface Series { id: string; name: string; color: string; points: { x: string; y: number | null }[] }
export interface Bar { key: string; label: string; value: number; count: number }
export interface Point { x: number; y: number; label: string; color: string }

export interface Dashboard {
  days: string[];
  kpis: {
    totalSales: number;
    previousSales: number | null;
    avgDailySales: number | null; // per location-night
    avgTicket: number | null;
    worstTicket: { minutes: number; date: string; location: string } | null;
    submitted: number;
    expected: number;
  };
  salesByDay: Series[];
  ticketByDay: Series[];
  salesByLocation: Bar[];
  salesByWeather: Bar[];
  salesByWeekday: Bar[];
  salesVsTemp: Point[];
  trend: { x1: number; y1: number; x2: number; y2: number } | null;
  missing: { date: string; location: string; locationId: string }[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Every date from `from` to `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = DateTime.fromISO(from); d <= DateTime.fromISO(to); d = d.plus({ days: 1 })) out.push(d.toISODate()!);
  return out;
}

/** Least-squares line through the points, drawn across their x-range. Null with fewer than 3 points or no spread. */
export function trendLine(points: { x: number; y: number }[]) {
  if (points.length < 3) return null;
  const mx = avg(points.map((p) => p.x))!;
  const my = avg(points.map((p) => p.y))!;
  const sxx = sum(points.map((p) => (p.x - mx) ** 2));
  if (sxx === 0) return null;
  const slope = sum(points.map((p) => (p.x - mx) * (p.y - my))) / sxx;
  const xs = points.map((p) => p.x);
  const x1 = Math.min(...xs), x2 = Math.max(...xs);
  return { x1, y1: my + slope * (x1 - mx), x2, y2: my + slope * (x2 - mx) };
}

export function buildDashboard(input: {
  reports: ReportRow[];
  previous: ReportRow[] | null; // same-length period before, for the comparison
  locations: Loc[]; // active locations in scope (one when filtered)
  from: string;
  to: string;
  missingFrom: string; // check for missing reports from this date (e.g. the last 7 days)
  missingTo?: string; // ...up to this date (default: `to`); pass yesterday so tonight's report is not counted as missing
}): Dashboard {
  const { reports, locations, from, to } = input;
  const days = dateRange(from, to);
  const byLoc = new Map(locations.map((l) => [l.id, l]));
  const inScope = reports.filter((r) => byLoc.has(r.location_id) && r.report_date >= from && r.report_date <= to);
  const key = (loc: string, day: string) => `${loc}|${day}`;
  const index = new Map(inScope.map((r) => [key(r.location_id, r.report_date), r]));

  const series = (pick: (r: ReportRow) => number | null): Series[] =>
    locations.map((l) => ({
      id: l.id, name: l.name, color: l.color,
      points: days.map((d) => ({ x: d, y: index.has(key(l.id, d)) ? pick(index.get(key(l.id, d))!) : null })),
    }));

  const tickets = inScope.filter((r) => r.longest_ticket_minutes !== null);
  const worst = tickets.reduce<ReportRow | null>((w, r) => (!w || r.longest_ticket_minutes! > w.longest_ticket_minutes! ? r : w), null);

  const bars = (groups: Map<string, number[]>, order: string[], label: (k: string) => string): Bar[] =>
    order.filter((k) => groups.get(k)?.length).map((k) => ({ key: k, label: label(k), value: avg(groups.get(k)!)!, count: groups.get(k)!.length }));

  const weather = new Map<string, number[]>();
  const weekday = new Map<string, number[]>();
  for (const r of inScope) {
    weather.set(r.weather, [...(weather.get(r.weather) ?? []), r.sales]);
    const wd = WEEKDAYS[DateTime.fromISO(r.report_date).weekday - 1];
    weekday.set(wd, [...(weekday.get(wd) ?? []), r.sales]);
  }

  const points = inScope.map((r) => ({
    x: r.temperature_f, y: r.sales,
    label: `${byLoc.get(r.location_id)!.name}, ${DateTime.fromISO(r.report_date).toFormat("LLL d")}`,
    color: byLoc.get(r.location_id)!.color,
  }));

  const today = DateTime.fromISO(input.missingTo ?? to);
  const missing: Dashboard["missing"] = [];
  for (const d of dateRange(input.missingFrom > from ? input.missingFrom : from, to)) {
    if (DateTime.fromISO(d) > today) continue;
    for (const l of locations) if (!index.has(key(l.id, d))) missing.push({ date: d, location: l.name, locationId: l.id });
  }

  return {
    days,
    kpis: {
      totalSales: sum(inScope.map((r) => r.sales)),
      previousSales: input.previous ? sum(input.previous.filter((r) => byLoc.has(r.location_id)).map((r) => r.sales)) : null,
      avgDailySales: avg(inScope.map((r) => r.sales)),
      avgTicket: avg(tickets.map((r) => r.longest_ticket_minutes!)),
      worstTicket: worst ? { minutes: worst.longest_ticket_minutes!, date: worst.report_date, location: byLoc.get(worst.location_id)!.name } : null,
      submitted: inScope.length,
      expected: days.length * locations.length,
    },
    salesByDay: series((r) => r.sales),
    ticketByDay: series((r) => r.longest_ticket_minutes),
    salesByLocation: locations.map((l) => {
      const xs = inScope.filter((r) => r.location_id === l.id).map((r) => r.sales);
      return { key: l.id, label: l.name, value: sum(xs), count: xs.length };
    }),
    salesByWeather: bars(weather, [...WEATHER_ORDER], (k) => WEATHER_LABELS[k] ?? k),
    salesByWeekday: bars(weekday, WEEKDAYS, (k) => k),
    salesVsTemp: points,
    trend: trendLine(points),
    missing,
  };
}

