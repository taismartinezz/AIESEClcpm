"use client";

import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import type { WorkingHours } from "@/types";

// ── IANA timezone list ─────────────────────────────────────────────────────────

const FALLBACK_TIMEZONES = [
  "Africa/Abidjan","Africa/Accra","Africa/Addis_Ababa","Africa/Algiers","Africa/Cairo",
  "Africa/Casablanca","Africa/Johannesburg","Africa/Lagos","Africa/Nairobi","Africa/Tunis",
  "America/Anchorage","America/Argentina/Buenos_Aires","America/Bogota","America/Chicago",
  "America/Denver","America/Havana","America/Honolulu","America/Lima","America/Los_Angeles",
  "America/Mexico_City","America/New_York","America/Phoenix","America/Santiago",
  "America/Sao_Paulo","America/Toronto","America/Vancouver",
  "Asia/Almaty","Asia/Baghdad","Asia/Bangkok","Asia/Colombo","Asia/Dhaka","Asia/Dubai",
  "Asia/Hong_Kong","Asia/Jakarta","Asia/Jerusalem","Asia/Karachi","Asia/Kolkata",
  "Asia/Kuala_Lumpur","Asia/Manila","Asia/Riyadh","Asia/Seoul","Asia/Shanghai",
  "Asia/Singapore","Asia/Taipei","Asia/Tehran","Asia/Tokyo","Asia/Ulaanbaatar",
  "Atlantic/Azores","Atlantic/Cape_Verde","Atlantic/Reykjavik",
  "Australia/Adelaide","Australia/Brisbane","Australia/Melbourne","Australia/Perth","Australia/Sydney",
  "Europe/Amsterdam","Europe/Athens","Europe/Belgrade","Europe/Berlin","Europe/Brussels",
  "Europe/Bucharest","Europe/Budapest","Europe/Copenhagen","Europe/Dublin","Europe/Helsinki",
  "Europe/Istanbul","Europe/Kiev","Europe/Lisbon","Europe/London","Europe/Madrid",
  "Europe/Moscow","Europe/Oslo","Europe/Paris","Europe/Prague","Europe/Rome",
  "Europe/Stockholm","Europe/Vienna","Europe/Warsaw","Europe/Zurich",
  "Indian/Mauritius","Indian/Maldives",
  "Pacific/Auckland","Pacific/Fiji","Pacific/Guam","Pacific/Honolulu","Pacific/Noumea",
  "Pacific/Tahiti","UTC",
];

function getAllTimezones(): string[] {
  try {
    if (typeof Intl !== "undefined" && typeof (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf === "function") {
      return (Intl as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
    }
  } catch {/* fall through */}
  return FALLBACK_TIMEZONES;
}

function utcOffset(tz: string): string {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: tz, timeZoneName: "shortOffset",
    }).formatToParts(now);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// ── Timezone combobox ─────────────────────────────────────────────────────────

function TimezoneCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (tz: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const allZones = useRef<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    allZones.current = getAllTimezones();
  }, []);

  // Show current value label when closed
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = query.length > 0
    ? allZones.current.filter((tz) =>
        tz.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 40)
    : allZones.current.slice(0, 40);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          padding: "0 12px",
          height: 40,
          backgroundColor: "var(--color-canvas)",
          cursor: "text",
        }}
        onClick={() => { setOpen(true); }}
      >
        <Search size={13} color="var(--color-secondary)" style={{ flexShrink: 0 }} />
        {open ? (
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search timezones…"
            style={{
              flex: 1, border: "none", outline: "none",
              background: "transparent", fontSize: 13,
              color: "var(--color-body)", fontFamily: "inherit",
            }}
          />
        ) : (
          <span style={{ flex: 1, fontSize: 13, color: "var(--color-body)" }}>
            {value} <span style={{ color: "var(--color-secondary)", fontSize: 12 }}>{utcOffset(value)}</span>
          </span>
        )}
      </div>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0, right: 0,
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            maxHeight: 260,
            overflowY: "auto",
            zIndex: 100,
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--color-secondary)" }}>
              No matches
            </div>
          ) : filtered.map((tz) => (
            <div
              key={tz}
              onMouseDown={(e) => { e.preventDefault(); onChange(tz); setOpen(false); }}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "9px 14px",
                fontSize: 13,
                cursor: "pointer",
                color: tz === value ? "var(--color-navy)" : "var(--color-body)",
                backgroundColor: tz === value ? "var(--color-navy-dim)" : "transparent",
                fontWeight: tz === value ? 600 : 400,
              }}
              onMouseEnter={(e) => {
                if (tz !== value) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-border)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = tz === value ? "var(--color-navy-dim)" : "transparent";
              }}
            >
              <span>{tz}</span>
              <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{utcOffset(tz)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── WorkingHoursEditor ─────────────────────────────────────────────────────────

const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DEFAULT_WORKING_HOURS: WorkingHours = {
  "0": { start: "09:00", end: "17:00" },
  "1": { start: "09:00", end: "17:00" },
  "2": { start: "09:00", end: "17:00" },
  "3": { start: "09:00", end: "17:00" },
  "4": { start: "09:00", end: "17:00" },
  "5": null,
  "6": null,
};

export interface WorkingHoursEditorProps {
  timezone: string;
  onTimezoneChange: (tz: string) => void;
  workingHours: WorkingHours;
  onWorkingHoursChange: (wh: WorkingHours) => void;
  /** When true, shows a "Detected: X — looks right?" banner */
  showDetectedBanner?: boolean;
}

export function WorkingHoursEditor({
  timezone,
  onTimezoneChange,
  workingHours,
  onWorkingHoursChange,
  showDetectedBanner = false,
}: WorkingHoursEditorProps) {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const detectedTz = useRef(detectTimezone());

  const inputStyle: React.CSSProperties = {
    height: 34,
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    padding: "0 8px",
    fontSize: 13,
    fontFamily: "inherit",
    backgroundColor: "var(--color-canvas)",
    color: "var(--color-body)",
    outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Detected timezone banner */}
      {showDetectedBanner && !bannerDismissed && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 14px",
          backgroundColor: "var(--color-navy-dim)",
          border: "1px solid rgba(10,132,255,0.2)",
          borderRadius: 8,
          fontSize: 13,
        }}>
          <span style={{ color: "var(--color-body)" }}>
            Detected: <strong style={{ color: "var(--color-navy)" }}>{detectedTz.current}</strong>. Looks right?
          </span>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => { onTimezoneChange(detectedTz.current); setBannerDismissed(true); }}
              style={{
                fontSize: 12, fontWeight: 700, color: "var(--color-navy)",
                background: "none", border: "none", cursor: "pointer", padding: "2px 8px",
              }}
            >
              Yes, use it
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              style={{
                fontSize: 12, color: "var(--color-secondary)",
                background: "none", border: "none", cursor: "pointer", padding: "2px 8px",
              }}
            >
              Change
            </button>
          </div>
        </div>
      )}

      {/* Timezone selector */}
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: "0 0 6px" }}>
          Timezone
        </p>
        <TimezoneCombobox value={timezone} onChange={onTimezoneChange} />
      </div>

      {/* Per-day working hours */}
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: "0 0 10px" }}>
          Working hours
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {DAY_LABELS.map((label, i) => {
            const key = String(i);
            const dayHours = workingHours[key];
            const enabled = dayHours !== null;
            return (
              <div
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 0",
                  borderBottom: i < 6 ? "1px solid var(--color-border)" : undefined,
                }}
              >
                <input
                  type="checkbox"
                  id={`day-${key}`}
                  checked={enabled}
                  onChange={(e) => {
                    const next = { ...workingHours };
                    next[key] = e.target.checked ? { start: "09:00", end: "17:00" } : null;
                    onWorkingHoursChange(next);
                  }}
                  style={{ width: 15, height: 15, cursor: "pointer", flexShrink: 0, accentColor: "var(--color-navy)" }}
                />
                <label
                  htmlFor={`day-${key}`}
                  style={{
                    fontSize: 13,
                    color: enabled ? "var(--color-body)" : "var(--color-secondary)",
                    width: 90,
                    cursor: "pointer",
                    flexShrink: 0,
                    fontWeight: enabled ? 500 : 400,
                  }}
                >
                  {label}
                </label>
                {enabled && dayHours ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="time"
                      value={dayHours.start}
                      onChange={(e) => {
                        const next = { ...workingHours };
                        next[key] = { start: e.target.value, end: dayHours.end };
                        onWorkingHoursChange(next);
                      }}
                      style={inputStyle}
                    />
                    <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>to</span>
                    <input
                      type="time"
                      value={dayHours.end}
                      onChange={(e) => {
                        const next = { ...workingHours };
                        next[key] = { start: dayHours.start, end: e.target.value };
                        onWorkingHoursChange(next);
                      }}
                      style={inputStyle}
                    />
                  </div>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>Off</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_WORKING_HOURS };
