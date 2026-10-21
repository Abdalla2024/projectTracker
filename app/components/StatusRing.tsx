import type { CSSProperties } from "react";
import { STATUS_LABELS } from "@/lib/constants";

// Progress wheel: the arc fills as the project moves along, and its color runs from red (start)
// through amber to green (done). A white knob marks where the project is now.
const STOPS: [number, [number, number, number]][] = [
  [0, [239, 68, 68]], [0.5, [245, 158, 11]], [1, [34, 197, 94]],
];
const GRADIENT = "conic-gradient(from 0deg, #ef4444 0%, #f59e0b 50%, #22c55e 100%)";
const GRAY = "conic-gradient(from 0deg, #cbd0d8, #cbd0d8)";

function colorAt(t: number): string {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const k = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(",")})`;
    }
  }
  return "rgb(34,197,94)";
}

export function StatusRing({ status, progress, size = 104 }: { status: string; progress: number; size?: number }) {
  // A finished project always shows a full ring; otherwise the slider value decides.
  const pct = status === "done" ? 100 : Math.max(0, Math.min(100, progress));
  const cancelled = status === "cancelled";
  const stroke = Math.round(size * 0.115);
  const label = STATUS_LABELS[status] ?? status;
  const sizeClass = label.length > 17 ? "xs" : label.length > 10 ? "sm" : "";
  const style = {
    "--size": `${size}px`, "--stroke": `${stroke}px`, "--pct": pct,
    "--grad": cancelled ? GRAY : GRADIENT,
    "--start": cancelled ? "#cbd0d8" : "#ef4444",
    "--end": cancelled ? "#cbd0d8" : colorAt(pct / 100),
  } as CSSProperties;
  return (
    <div className="ring" style={style} role="img" aria-label={`${label}, ${pct}% complete, ${STATUS_LABELS[status] ?? status}`}>
      <div className="ring-track" />
      {pct > 0 ? <div className="ring-arc" /> : null}
      {pct > 0 ? <div className="ring-cap start"><i /></div> : null}
      <div className="ring-cap end"><i /><b /></div>
      <span className={`ring-label ${sizeClass}`}>{label}</span>
    </div>
  );
}
