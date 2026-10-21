export const STATUSES = ["not_started", "in_progress", "blocked", "done", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];
export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Stuck",
  done: "Done",
  cancelled: "Cancelled",
};
export const PRIORITY_LABELS: Record<string, string> = { low: "Low", normal: "Normal", high: "High" };

export const PHASE_MAX = 24;

/** Statuses where a deadline no longer needs attention. */
export const CLOSED_STATUSES: readonly string[] = ["done", "cancelled"];

/** "Approaching" window for deadline flags, in days. */
export const DEADLINE_SOON_DAYS = 7;
