import { DateTime } from "luxon";

export const DEFAULT_TIME_ZONE = "America/New_York";

export function timeZone(): string {
  return process.env.APP_TIME_ZONE || DEFAULT_TIME_ZONE;
}

export interface WeekWindow {
  /** Monday 00:00 local time, as an instant. */
  start: Date;
  /** The next Monday 00:00 local time, or "now" for the current (unfinished) week. */
  end: Date;
  isCurrent: boolean;
  /** 0 = this week, 1 = last week, ... */
  weeksAgo: number;
  label: string;
}

/**
 * Week boundaries in the reporting time zone. Uses calendar arithmetic, so a week that contains a
 * daylight-saving change is 167 or 169 hours long, and still starts exactly at local Monday 00:00.
 */
export function weekWindow(now: Date, zone: string, weeksAgo = 0): WeekWindow {
  const local = DateTime.fromJSDate(now, { zone });
  const startLocal = local.startOf("week").minus({ weeks: weeksAgo }); // Luxon weeks start on Monday
  const nextLocal = startLocal.plus({ weeks: 1 });
  const isCurrent = weeksAgo === 0;
  const endLocal = isCurrent ? local : nextLocal;
  const lastDay = nextLocal.minus({ days: 1 });
  return {
    start: startLocal.toJSDate(),
    end: endLocal.toJSDate(),
    isCurrent,
    weeksAgo,
    label: `${startLocal.toFormat("MMM d")} – ${lastDay.toFormat("MMM d, yyyy")}`,
  };
}

export function localDateString(instant: Date, zone: string): string {
  return DateTime.fromJSDate(instant, { zone }).toISODate()!;
}

export function formatDateTime(instant: Date, zone: string): string {
  return DateTime.fromJSDate(instant, { zone }).toFormat("MMM d, h:mm a");
}

export function formatDate(isoDate: string): string {
  return DateTime.fromISO(isoDate).toFormat("MMM d, yyyy");
}
