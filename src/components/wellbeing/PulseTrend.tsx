"use client";

import { useId, useState } from "react";
import { thisPeriod, type CheckinCadence, type PulsePeriod } from "@/lib/wellbeing";

const W = 480, H = 110;
const PAD = { l: 22, r: 30, t: 10, b: 20 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

function dayLabel(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Single-series trend of an average (1–5) over the last check-in periods.
 * Suppressed periods are gaps, never zeros. Hover/focus shows the period's value; a table view carries the
 * same numbers for screen readers and for anyone who prefers them.
 */
export default function PulseTrend({ periods: weeks, label, cadence }: { periods: PulsePeriod[]; label: string; cadence: CheckinCadence }) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  if (weeks.length === 0) return null;

  const step = weeks.length > 1 ? PLOT_W / (weeks.length - 1) : 0;
  const x = (i: number) => PAD.l + i * step;
  const y = (v: number) => PAD.t + PLOT_H - ((v - 1) / 4) * PLOT_H;

  let path = "";
  let penDown = false;
  weeks.forEach((w, i) => {
    if (w.overall == null) { penDown = false; return; }
    path += `${penDown ? "L" : "M"}${x(i).toFixed(1)},${y(w.overall).toFixed(1)} `;
    penDown = true;
  });

  const lastIdx = weeks.map((w) => w.overall != null).lastIndexOf(true);
  const hovered = hover != null ? weeks[hover] : null;

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-labelledby={titleId}
          style={{ display: "block", overflow: "visible" }}
          onMouseLeave={() => setHover(null)}
        >
          <title id={titleId}>{`${label}: average per check-in over the last ${weeks.length} check-ins`}</title>
          {[1, 2, 3, 4, 5].map((v) => (
            <line key={v} x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" strokeWidth={1} />
          ))}
          {[1, 3, 5].map((v) => (
            <text key={v} x={PAD.l - 6} y={y(v) + 3} textAnchor="end" style={{ fontSize: 9, fill: "var(--color-secondary)" }}>{v}</text>
          ))}
          <text x={PAD.l} y={H - 4} style={{ fontSize: 9, fill: "var(--color-secondary)" }}>{dayLabel(weeks[0].period)}</text>
          <text x={x(weeks.length - 1)} y={H - 4} textAnchor="end" style={{ fontSize: 9, fill: "var(--color-secondary)" }}>{thisPeriod(cadence) === "this week" ? "This week" : "This fortnight"}</text>

          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + PLOT_H} stroke="var(--color-secondary)" strokeWidth={1} opacity={0.4} />
          )}
          {path && <path d={path} fill="none" stroke="var(--chart-series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {weeks.map((w, i) => w.overall != null && (
            <circle key={w.period} cx={x(i)} cy={y(w.overall)} r={hover === i ? 5 : 4}
              fill="var(--chart-series)" stroke="var(--color-surface)" strokeWidth={2} />
          ))}
          {lastIdx >= 0 && weeks[lastIdx].overall != null && (
            <text x={x(lastIdx) + 8} y={y(weeks[lastIdx].overall!) + 3} style={{ fontSize: 10, fontWeight: 600, fill: "var(--color-body)" }}>
              {weeks[lastIdx].overall!.toFixed(1)}
            </text>
          )}
          {/* Hit targets: one full-height column per period, larger than the marks */}
          {weeks.map((w, i) => (
            <rect
              key={`hit-${w.period}`} x={x(i) - Math.max(step, 24) / 2} y={0} width={Math.max(step, 24)} height={H}
              fill="transparent" tabIndex={0} aria-label={`${dayLabel(w.period)}: ${w.overall != null ? w.overall.toFixed(1) : "not enough responses"}`}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            />
          ))}
        </svg>
        {hovered && hover != null && (
          <div
            role="status"
            style={{
              position: "absolute", top: 0, left: `${(x(hover) / W) * 100}%`,
              transform: `translateX(${hover > weeks.length / 2 ? "-105%" : "5%"})`,
              backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6,
              boxShadow: "var(--shadow-card)", padding: "6px 8px", fontSize: 11, color: "var(--color-body)",
              pointerEvents: "none", whiteSpace: "nowrap",
            }}
          >
            <div style={{ color: "var(--color-secondary)" }}>Check-in from {dayLabel(hovered.period)}</div>
            <div style={{ fontWeight: 600 }}>
              {hovered.overall != null ? `${hovered.overall.toFixed(2)} / 5` : "Not enough responses"}
            </div>
          </div>
        )}
      </div>
      <details style={{ marginTop: 4 }}>
        <summary style={{ fontSize: 11, color: "var(--color-secondary)", cursor: "pointer" }}>Show as table</summary>
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginTop: 6 }}>
          <thead>
            <tr style={{ color: "var(--color-secondary)", textAlign: "left" }}>
              <th scope="col" style={{ fontWeight: 600, padding: "2px 0" }}>Check-in from</th>
              <th scope="col" style={{ fontWeight: 600, padding: "2px 0", textAlign: "right" }}>Average</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.period} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td style={{ padding: "3px 0" }}>{dayLabel(w.period)}</td>
                <td style={{ padding: "3px 0", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {w.overall != null ? w.overall.toFixed(2) : "Not enough responses"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
