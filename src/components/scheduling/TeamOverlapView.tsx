"use client";

import { useState } from "react";
import { DAYS, SLOT_COUNT, slotKey, slotToLabel } from "./AvailabilityGrid";
import type { WeeklyAvailability, User } from "@/types";

interface Props {
  availabilities: WeeklyAvailability[];
  teamMembers: User[];
  onProposeMeeting?: () => void;
}

function heatColor(count: number, total: number): string {
  if (total === 0 || count === 0) return "rgba(27,46,75,0.04)";
  const ratio = count / total;
  if (ratio <= 0.2)  return "rgba(27,46,75,0.18)";
  if (ratio <= 0.4)  return "rgba(27,46,75,0.36)";
  if (ratio <= 0.6)  return "rgba(27,46,75,0.54)";
  if (ratio <= 0.8)  return "rgba(27,46,75,0.72)";
  return "rgba(27,46,75,0.90)";
}

function textColor(count: number, total: number): string {
  if (total === 0 || count === 0) return "transparent";
  const ratio = count / total;
  return ratio >= 0.6 ? "#fff" : "var(--color-navy)";
}

export default function TeamOverlapView({ availabilities, teamMembers, onProposeMeeting }: Props) {
  const [tooltip, setTooltip] = useState<{ key: string; names: string[] } | null>(null);
  // Use teamMembers.length so the subtitle matches the title (which lists selected members),
  // regardless of how many have actually submitted availability data.
  const total = teamMembers.length;

  // Build a map: slotKey → array of userId who are available
  const slotMap: Record<string, string[]> = {};
  for (const av of availabilities) {
    for (const key of av.slots) {
      if (!slotMap[key]) slotMap[key] = [];
      slotMap[key].push(av.userId);
    }
  }

  function getName(userId: string): string {
    const u = teamMembers.find((m) => m.id === userId);
    return u ? u.name.split(" ")[0] : userId;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>
            Showing overlapping availability for {total} team member{total !== 1 ? "s" : ""}.
            Darker cells = more people free.
          </p>
        </div>
        {onProposeMeeting && (
          <button
            onClick={onProposeMeeting}
            style={{
              backgroundColor: "var(--color-navy)",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 600,
              padding: "8px 16px",
              cursor: "pointer",
              fontFamily: "var(--font-roboto)",
            }}
          >
            + Propose Meeting
          </button>
        )}
      </div>

      {/* Legend - steps scaled to actual member count */}
      {(() => {
        const intermediates: number[] = total <= 5
          ? Array.from({ length: total }, (_, i) => i)
          : [0, Math.round(total * 0.25), Math.round(total * 0.5), Math.round(total * 0.75)];
        const swatch = (n: number, label: string) => (
          <div key={label} className="flex items-center gap-1">
            <div style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: heatColor(n, total), border: "1px solid rgba(27,46,75,0.15)" }} />
            <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{label}</span>
          </div>
        );
        return (
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span style={{ fontSize: 11, color: "var(--color-secondary)", fontWeight: 600 }}>Free:</span>
            {intermediates.map((n) => swatch(n, String(n)))}
            {swatch(total, `All (${total})`)}
          </div>
        );
      })()}

      <div className="relative select-none overflow-x-auto">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `52px repeat(${DAYS.length}, minmax(64px, 1fr))`,
            minWidth: 380,
          }}
        >
          {/* Header */}
          <div style={{ height: 32 }} />
          {DAYS.map((d) => (
            <div
              key={d}
              style={{
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--color-navy)",
                letterSpacing: "0.04em",
              }}
            >
              {d}
            </div>
          ))}

          {/* Slot rows */}
          {Array.from({ length: SLOT_COUNT }, (_, slot) => {
            const isHourBoundary = slot % 2 === 0;
            const label = isHourBoundary ? slotToLabel(slot) : "";
            return (
              <>
                <div
                  key={`label-${slot}`}
                  style={{
                    height: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: 8,
                    fontSize: 10,
                    color: "var(--color-secondary)",
                    whiteSpace: "nowrap",
                    borderTop: isHourBoundary ? "1px solid var(--color-border)" : undefined,
                  }}
                >
                  {label}
                </div>

                {DAYS.map((_, day) => {
                  const key = slotKey(day, slot);
                  const freeUsers = slotMap[key] ?? [];
                  const count = freeUsers.length;
                  const bg = heatColor(count, total);
                  const isHovered = tooltip?.key === key;

                  return (
                    <div
                      key={key}
                      onMouseEnter={() => {
                        if (count > 0) {
                          setTooltip({ key, names: freeUsers.map(getName) });
                        }
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        height: 22,
                        position: "relative",
                        borderTop: isHourBoundary ? "1px solid var(--color-border)" : "1px solid transparent",
                        borderLeft: day === 0 ? "1px solid var(--color-border)" : undefined,
                        borderRight: "1px solid var(--color-border)",
                        backgroundColor: bg,
                        outline: isHovered ? "2px solid var(--color-navy)" : undefined,
                        zIndex: isHovered ? 2 : undefined,
                        cursor: count > 0 ? "default" : "default",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {count > 0 && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: textColor(count, total), pointerEvents: "none" }}>
                          {count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })}

          {/* Bottom border */}
          <div style={{ borderTop: "1px solid var(--color-border)", height: 0 }} />
          {DAYS.map((_, day) => (
            <div
              key={`bottom-${day}`}
              style={{
                borderTop: "1px solid var(--color-border)",
                borderLeft: day === 0 ? "1px solid var(--color-border)" : undefined,
                borderRight: "1px solid var(--color-border)",
                height: 0,
              }}
            />
          ))}
        </div>

        {/* Tooltip */}
        {tooltip && tooltip.names.length > 0 && (
          <div
            className="pointer-events-none animate-fade-in"
            style={{
              position: "fixed",
              zIndex: 50,
              backgroundColor: "var(--color-navy)",
              color: "#fff",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 12,
              boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              left: "50%",
              bottom: 8,
              transform: "translateX(-50%)",
              whiteSpace: "nowrap",
            }}
          >
            Free: {tooltip.names.join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}
