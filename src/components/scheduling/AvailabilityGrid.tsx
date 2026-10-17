"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
// 9:00 AM – 4:30 PM in 30-min steps = 16 slots (slot 0 = 9:00, slot 15 = 4:30)
export const SLOT_COUNT = 16;
export const HOUR_START = 9;

export function slotToLabel(slot: number): string {
  const totalMins = HOUR_START * 60 + slot * 30;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${suffix}`;
}

export function slotKey(day: number, slot: number): string {
  return `${day}-${slot}`;
}

// ── AvailabilityGrid ─────────────────────────────────────────────────────────

interface Props {
  slots: string[];            // currently selected slot keys
  onChange: (slots: string[]) => void;
  readOnly?: boolean;
}

export default function AvailabilityGrid({ slots, onChange, readOnly = false }: Props) {
  const selected = new Set(slots);
  const isDragging = useRef(false);
  const dragToggle = useRef<boolean>(true); // true = adding, false = removing
  const [hovered, setHovered] = useState<string | null>(null);

  const toggle = useCallback((key: string, forceValue?: boolean) => {
    if (readOnly) return;
    const next = new Set(slots);
    const val = forceValue !== undefined ? forceValue : !next.has(key);
    if (val) next.add(key);
    else next.delete(key);
    onChange(Array.from(next));
  }, [slots, onChange, readOnly]);

  function onCellMouseDown(key: string) {
    if (readOnly) return;
    isDragging.current = true;
    dragToggle.current = !selected.has(key);
    toggle(key, dragToggle.current);
  }

  function onCellMouseEnter(key: string) {
    setHovered(key);
    if (!isDragging.current || readOnly) return;
    toggle(key, dragToggle.current);
  }

  useEffect(() => {
    function onUp() { isDragging.current = false; }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  return (
    <div
      className="select-none overflow-x-auto"
      style={{ WebkitUserSelect: "none", cursor: readOnly ? "default" : "pointer" }}
      onMouseLeave={() => setHovered(null)}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `52px repeat(${DAYS.length}, minmax(64px, 1fr))`,
          minWidth: 380,
        }}
      >
        {/* Header row */}
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

        {/* Time slot rows */}
        {Array.from({ length: SLOT_COUNT }, (_, slot) => {
          const isHourBoundary = slot % 2 === 0;
          const label = isHourBoundary ? slotToLabel(slot) : "";
          return (
            <>
              {/* Time label */}
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

              {/* Day cells */}
              {DAYS.map((_, day) => {
                const key = slotKey(day, slot);
                const isSelected = selected.has(key);
                const isHov = hovered === key && !readOnly;

                return (
                  <div
                    key={key}
                    onMouseDown={() => onCellMouseDown(key)}
                    onMouseEnter={() => onCellMouseEnter(key)}
                    style={{
                      height: 22,
                      borderTop: isHourBoundary ? "1px solid var(--color-border)" : "1px solid transparent",
                      borderLeft: day === 0 ? "1px solid var(--color-border)" : undefined,
                      borderRight: "1px solid var(--color-border)",
                      backgroundColor: isSelected
                        ? isHov ? "rgba(27,46,75,0.75)" : "var(--color-navy)"
                        : isHov ? "rgba(27,46,75,0.10)" : "rgba(27,46,75,0.03)",
                      transition: "background-color 0.08s",
                    }}
                  />
                );
              })}
            </>
          );
        })}

        {/* Bottom border row */}
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

      {!readOnly && (
        <p style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 8 }}>
          Click or drag to mark when you&apos;re generally available.
        </p>
      )}
    </div>
  );
}
