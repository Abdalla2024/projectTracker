// Number formatting shared by the dashboard (server) and its charts (client).
export type Fmt = "money" | "minutes" | "count";

export function fmt(v: number | null, f: Fmt, compact = false): string {
  if (v === null || Number.isNaN(v)) return "—";
  if (f === "money") {
    if (compact && Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}K`;
    return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }
  if (f === "minutes") return `${Math.round(v * 10) / 10} min`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
