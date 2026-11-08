"use client";

import { useId, useRef, useState } from "react";
import { monthLabel } from "@/lib/finance";

// Charts for the National Finance Tracker. Colours are the app's own tokens so
// light and dark themes both work: the accent (navy) carries the data, below
// zero is the error colour (a status, always with a label), grid and axes are
// hairlines in the border colour, and text never wears the data colour.

const ACCENT = "var(--color-navy)";
const NEGATIVE = "var(--color-error)";
const GRID = "var(--color-border)";
const TEXT = "var(--color-secondary)";

/** Clean axis ticks between min and max (always including 0 when the range crosses it). */
function ticks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min), hi = Math.max(0, max);
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  // From the step at or below the minimum up to the step at or above the maximum, so every point fits.
  const out: number[] = [];
  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  for (let v = first; v <= last + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const compact = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, notation: Math.abs(n) >= 10000 ? "compact" : "standard", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${Math.round(n)}`;
  }
};

/** Balance at the end of each month: a 2px line over a 10% wash, crosshair + tooltip on hover/focus. */
export function BalanceTrend({ series, currency, format, label }: {
  series: { month: string; balance: number }[];
  currency: string;
  format: (n: number) => string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientId = useId();
  const W = 640, H = 200, L = 56, R = 16, T = 12, B = 26;
  const values = series.map((s) => s.balance);
  const yTicks = ticks(Math.min(...values, 0), Math.max(...values, 0));
  if (series.length === 0) return null;
  const yMin = yTicks[0], yMax = yTicks[yTicks.length - 1];
  const x = (i: number) => (series.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (series.length - 1));
  const y = (v: number) => T + ((yMax - v) / (yMax - yMin || 1)) * (H - T - B);
  const path = series.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s.balance).toFixed(1)}`).join(" ");
  const area = `${path} L${x(series.length - 1).toFixed(1)},${y(Math.max(yMin, 0)).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(yMin, 0)).toFixed(1)} Z`;
  const every = Math.ceil(series.length / 8);
  const last = series.length - 1;

  function pick(clientX: number) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((clientX - box.left) / box.width) * W;
    let best = 0;
    series.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setHover(best);
  }

  const shown = hover ?? last;
  return (
    <figure style={{ margin: 0, position: "relative" }}>
      <svg
        ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" tabIndex={0}
        aria-label={`${label}: ${series.map((s) => `${monthLabel(s.month)} ${format(s.balance)}`).join(", ")}`}
        onPointerMove={(e) => pick(e.clientX)} onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? last) - 1));
          if (e.key === "ArrowRight") setHover((h) => Math.min(last, (h ?? last) + 1));
        }}
        onBlur={() => setHover(null)}
        style={{ display: "block", overflow: "visible", touchAction: "pan-y" }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.12} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={L - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={TEXT} style={{ fontVariantNumeric: "tabular-nums" }}>{compact(t, currency)}</text>
          </g>
        ))}
        {series.map((s, i) => (i % every === 0 || i === last) && (
          <text key={s.month} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill={TEXT}>{monthLabel(s.month, series.length <= 12 ? false : true)}</text>
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={path} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke={TEXT} strokeWidth={1} />}
        <circle cx={x(shown)} cy={y(series[shown].balance)} r={4.5} fill={series[shown].balance < 0 ? NEGATIVE : ACCENT} stroke="var(--color-surface)" strokeWidth={2} />
      </svg>
      <figcaption
        aria-live="polite"
        style={{
          position: "absolute", top: 0, left: `${(x(shown) / W) * 100}%`, transform: shown > series.length / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
          pointerEvents: "none", backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8,
          padding: "6px 9px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", whiteSpace: "nowrap",
        }}
      >
        <strong style={{ display: "block", fontSize: 14, color: "var(--color-body)" }}>{format(series[shown].balance)}</strong>
        <span style={{ fontSize: 11, color: TEXT }}>{hover === null ? "Now" : `End of ${monthLabel(series[shown].month)}`}</span>
      </figcaption>
    </figure>
  );
}

/** Every LC's balance at a glance: ranked horizontal bars from one zero line; below zero is flagged. */
export function BalanceBars({ items, format, onSelect }: {
  items: { id: string; label: string; value: number; note?: string }[];
  format: (n: number) => string;
  onSelect?: (id: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const max = Math.max(0, ...sorted.map((i) => i.value));
  const min = Math.min(0, ...sorted.map((i) => i.value));
  const span = max - min || 1;
  const zero = (-min / span) * 100;                       // where 0 sits, in % of the track
  if (sorted.length === 0) return null;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
      {sorted.map((it) => {
        const width = (Math.abs(it.value) / span) * 100;
        const negative = it.value < 0;
        const active = hover === it.id;
        const Row = onSelect ? "button" : "div";
        return (
          <li key={it.id}>
            <Row
              {...(onSelect ? { type: "button" as const, onClick: () => onSelect(it.id) } : {})}
              onPointerEnter={() => setHover(it.id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(it.id)} onBlur={() => setHover(null)}
              aria-label={`${it.label}: ${format(it.value)}${negative ? " (below zero)" : ""}${it.note ? `. ${it.note}` : ""}`}
              style={{
                display: "grid", gridTemplateColumns: "minmax(110px, 30%) 1fr auto", alignItems: "center", gap: 10, width: "100%",
                padding: "5px 6px", border: "none", borderRadius: 6, textAlign: "left", font: "inherit", color: "inherit",
                backgroundColor: active ? "var(--color-dimmed-bg)" : "transparent", cursor: onSelect ? "pointer" : "default",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--color-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
              <span style={{ position: "relative", height: 16 }} aria-hidden="true">
                {min < 0 && <span style={{ position: "absolute", left: `${zero}%`, top: -3, bottom: -3, width: 1, backgroundColor: GRID }} />}
                <span style={{
                  position: "absolute", top: 2, height: 12,
                  left: negative ? `${zero - width}%` : `${zero}%`, width: `${Math.max(width, it.value === 0 ? 0 : 0.6)}%`,
                  backgroundColor: negative ? NEGATIVE : ACCENT, opacity: active ? 1 : 0.88,
                  borderRadius: negative ? "4px 0 0 4px" : "0 4px 4px 0",
                }} />
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", fontVariantNumeric: "tabular-nums", textAlign: "right", minWidth: 84 }}>
                {format(it.value)}{negative && <span style={{ display: "block", fontSize: 10, fontWeight: 600, color: NEGATIVE }}>Below zero</span>}
              </span>
            </Row>
          </li>
        );
      })}
    </ul>
  );
}

/** A 12-point-ish trend in a table row: de-emphasised line, the latest point in the accent. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const W = 90, H = 24;
  const lo = Math.min(...values, 0), hi = Math.max(...values, 0);
  const x = (i: number) => 2 + (i * (W - 4)) / (values.length - 1);
  const y = (v: number) => 2 + ((hi - v) / (hi - lo || 1)) * (H - 4);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastV = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} style={{ display: "block" }}>
      {lo < 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke={GRID} strokeWidth={1} />}
      <path d={d} fill="none" stroke={TEXT} strokeOpacity={0.55} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(lastV)} r={3} fill={lastV < 0 ? NEGATIVE : ACCENT} />
    </svg>
  );
}
