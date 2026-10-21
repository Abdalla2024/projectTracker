import { STATUS_LABELS } from "@/lib/constants";

// Progress wheel for a project's status: green is good, amber is moving, red is blocked.
const RING: Record<string, { pct: number; color: string; text: string }> = {
  not_started: { pct: 0, color: "#a1a1aa", text: "#6b7280" },
  in_progress: { pct: 55, color: "#f59e0b", text: "#b45309" },
  blocked: { pct: 28, color: "#dc2626", text: "#b91c1c" },
  done: { pct: 100, color: "#16a34a", text: "#15803d" },
  cancelled: { pct: 100, color: "#a1a1aa", text: "#6b7280" },
};

export function StatusRing({ status, size = 72, compact = false }: { status: string; size?: number; compact?: boolean }) {
  const { pct, color, text } = RING[status] ?? RING.not_started;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const label = STATUS_LABELS[status] ?? status;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`Status: ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0f3" strokeWidth={stroke} />
        {pct > 0 ? (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${(c * pct) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </svg>
      {compact ? null : <span className="ring-label" style={{ color: text }}>{label}</span>}
    </div>
  );
}
