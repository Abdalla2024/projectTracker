"use client";

// Small dependency-free SVG charts for the dashboard. Thin marks, recessive axes, hover tooltips,
// a legend for two or more series, and a table view for every chart.
import { useEffect, useRef, useState } from "react";

import { fmt, type Fmt } from "@/lib/number-format";

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step) ticks.push(Math.round(t * 1000) / 1000);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export interface LineSeries { id: string; name: string; color: string; points: { x: string; y: number | null }[] }

function Legend({ items }: { items: { name: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="legend">
      {items.map((i) => <li key={i.name}><i style={{ background: i.color }} aria-hidden="true" />{i.name}</li>)}
    </ul>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="chart-table">
      <summary>Show as table</summary>
      <div className="table-scroll">
        <table>
          <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

const M = { top: 12, right: 16, bottom: 26, left: 52 };

/** Shorten a category label so it fits its band (about 6.2px per character at 11px). */
const fit = (label: string, band: number) => {
  const max = Math.max(4, Math.floor((band - 8) / 6.2));
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
};

/** Lines over days, one per series, with a crosshair tooltip. Missing nights are gaps. */
export function LineChart({ series, format, height = 240, label }: { series: LineSeries[]; format: Fmt; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const xs = series[0]?.points.map((p) => p.x) ?? [];
  const values = series.flatMap((s) => s.points.map((p) => p.y).filter((v): v is number => v !== null));
  const ticks = niceTicks(Math.max(0, ...values));
  const top = ticks[ticks.length - 1] || 1;
  const iw = width - M.left - M.right, ih = height - M.top - M.bottom;
  const x = (i: number) => M.left + (xs.length <= 1 ? iw / 2 : (i / (xs.length - 1)) * iw);
  const y = (v: number) => M.top + ih - (v / top) * ih;
  const every = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor(iw / 70))));

  const path = (s: LineSeries) => {
    let d = "";
    let pen = false;
    s.points.forEach((p, i) => {
      if (p.y === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = xs.length <= 1 ? 0 : Math.round((px / box.width) * (xs.length - 1));
    setHover(Math.max(0, Math.min(xs.length - 1, i)));
  };

  if (!values.length) return <p className="chart-empty">No data in this period.</p>;
  return (
    <div className="chart" ref={ref}>
      <Legend items={series} />
      <div className="chart-wrap">
        <svg width={width} height={height} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className="grid" />
              <text x={M.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">{fmt(t, format, true)}</text>
            </g>
          ))}
          {xs.map((d, i) => (i % every === 0 ? <text key={d} x={x(i)} y={height - 8} className="tick" textAnchor="middle">{shortDate(d)}</text> : null))}
          {series.map((s) => <path key={s.id} d={path(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
          {series.map((s) => {
            // A lone point between gaps would be invisible as a line; give it a dot.
            return s.points.map((p, i) => p.y !== null && (s.points[i - 1]?.y ?? null) === null && (s.points[i + 1]?.y ?? null) === null
              ? <circle key={`${s.id}-${i}`} cx={x(i)} cy={y(p.y)} r={3} fill={s.color} /> : null);
          })}
          {hover !== null ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} className="crosshair" />
              {series.map((s) => s.points[hover].y !== null
                ? <circle key={s.id} cx={x(hover)} cy={y(s.points[hover].y!)} r={4.5} fill={s.color} className="ring-dot" /> : null)}
            </g>
          ) : null}
          <rect x={M.left} y={M.top} width={iw} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
        {hover !== null ? (
          <div className="tip" style={{ left: Math.min(x(hover) + 12, width - 180), top: M.top }}>
            <b>{shortDate(xs[hover])}</b>
            {series.map((s) => (
              <span key={s.id}><i style={{ background: s.color }} aria-hidden="true" />{s.name}<em>{fmt(s.points[hover].y, format)}</em></span>
            ))}
          </div>
        ) : null}
      </div>
      <Table head={["Date", ...series.map((s) => s.name)]} rows={xs.map((d, i) => [d, ...series.map((s) => fmt(s.points[i].y, format))])} />
    </div>
  );
}

export interface BarDatum { key: string; label: string; value: number; count?: number; color?: string }

/** Vertical bars with the value on each cap; hover shows the detail. */
export function BarChart({ data, format, height = 220, label, countLabel = "nights", color = "#2a78d6" }: {
  data: BarDatum[]; format: Fmt; height?: number; label: string; countLabel?: string; color?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="chart-empty">No data in this period.</p>;
  const ticks = niceTicks(Math.max(0, ...data.map((d) => d.value)));
  const top = ticks[ticks.length - 1] || 1;
  const m = { ...M, top: 22 };
  const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
  const band = iw / data.length;
  const bw = Math.min(24, band * 0.6);
  const y = (v: number) => m.top + ih - (v / top) * ih;
  const r = 4;
  const bar = (cx: number, v: number) => {
    const h = Math.max(0, m.top + ih - y(v));
    const x0 = cx - bw / 2, y0 = y(v), rr = Math.min(r, h);
    return `M${x0},${m.top + ih}V${y0 + rr}Q${x0},${y0} ${x0 + rr},${y0}H${x0 + bw - rr}Q${x0 + bw},${y0} ${x0 + bw},${y0 + rr}V${m.top + ih}Z`;
  };
  return (
    <div className="chart" ref={ref}>
      <div className="chart-wrap">
        <svg width={width} height={height} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className="grid" />
              <text x={m.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">{fmt(t, format, true)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = m.left + band * i + band / 2;
            return (
              <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={m.left + band * i} y={m.top} width={band} height={ih} fill="transparent" />
                <path d={bar(cx, d.value)} fill={d.color ?? color} opacity={hover === null || hover === i ? 1 : 0.55} />
                <text x={cx} y={y(d.value) - 6} className="cap" textAnchor="middle">{fmt(d.value, format, true)}</text>
                <text x={cx} y={height - 8} className="tick" textAnchor="middle">{fit(d.label, band)}</text>
              </g>
            );
          })}
        </svg>
        {hover !== null ? (
          <div className="tip" style={{ left: Math.min(m.left + band * hover + band / 2 + 10, width - 180), top: 0 }}>
            <b>{data[hover].label}</b>
            <span><em>{fmt(data[hover].value, format)}</em></span>
            {data[hover].count !== undefined ? <span className="muted">{data[hover].count} {countLabel}</span> : null}
          </div>
        ) : null}
      </div>
      <Table head={["", "Value", ...(data[0].count !== undefined ? [countLabel[0].toUpperCase() + countLabel.slice(1)] : [])]}
        rows={data.map((d) => [d.label, fmt(d.value, format), ...(d.count !== undefined ? [d.count] : [])])} />
    </div>
  );
}

/** Scatter with a least-squares trend line. One colour: the location is in the tooltip and table. */
export function ScatterChart({ points, trend, xLabel, format, height = 240, label, color = "#2a78d6" }: {
  points: { x: number; y: number; label: string }[]; trend: { x1: number; y1: number; x2: number; y2: number } | null;
  xLabel: string; format: Fmt; height?: number; label: string; color?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return <p className="chart-empty">No data in this period.</p>;
  const ticks = niceTicks(Math.max(0, ...points.map((p) => p.y)));
  const top = ticks[ticks.length - 1] || 1;
  const xmin = Math.floor(Math.min(...points.map((p) => p.x)) / 10) * 10;
  const xmax = Math.max(xmin + 10, Math.ceil(Math.max(...points.map((p) => p.x)) / 10) * 10);
  const iw = width - M.left - M.right, ih = height - M.top - M.bottom;
  const x = (v: number) => M.left + ((v - xmin) / (xmax - xmin)) * iw;
  const y = (v: number) => M.top + ih - (v / top) * ih;
  const xticks: number[] = [];
  for (let t = xmin; t <= xmax; t += (xmax - xmin) > 60 ? 20 : 10) xticks.push(t);
  return (
    <div className="chart" ref={ref}>
      <div className="chart-wrap">
        <svg width={width} height={height} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className="grid" />
              <text x={M.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">{fmt(t, format, true)}</text>
            </g>
          ))}
          {xticks.map((t) => <text key={t} x={x(t)} y={height - 8} className="tick" textAnchor="middle">{t}{xLabel}</text>)}
          {points.map((p, i) => (
            <circle key={i} cx={x(p.x)} cy={y(p.y)} r={hover === i ? 6 : 4.5} fill={color} fillOpacity={hover === null || hover === i ? 0.75 : 0.35}
              className="ring-dot" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
          {trend ? <line x1={x(trend.x1)} y1={y(Math.max(0, trend.y1))} x2={x(trend.x2)} y2={y(Math.max(0, trend.y2))} className="trend" /> : null}
        </svg>
        {hover !== null ? (
          <div className="tip" style={{ left: Math.min(x(points[hover].x) + 12, width - 180), top: Math.max(0, y(points[hover].y) - 50) }}>
            <b>{points[hover].label}</b>
            <span>{points[hover].x}{xLabel}<em>{fmt(points[hover].y, format)}</em></span>
          </div>
        ) : null}
      </div>
      {trend ? <p className="hint">The line is the overall trend (least squares).</p> : null}
      <Table head={["Night", `Temperature (${xLabel})`, "Sales"]} rows={points.map((p) => [p.label, p.x, fmt(p.y, format)])} />
    </div>
  );
}
