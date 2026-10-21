// The weekly "when I'm usually free for AIESEC" grid, for people who don't
// connect Google Calendar. Times are in the person's own time zone.
//
// Keys are "<day>-<HH:MM>" with day 0 = Monday … 6 = Sunday, one per half hour
// between 08:00 and 22:00. The first version of the grid only covered Mon–Fri
// 9:00–16:30 and stored "<day>-<slot index>" (slot 0 = 9:00); parseSlotKey still
// reads those.

export const GRID_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const GRID_START_MIN = 8 * 60;
export const GRID_END_MIN = 22 * 60;
export const GRID_STEP_MIN = 30;
export const GRID_SLOTS = (GRID_END_MIN - GRID_START_MIN) / GRID_STEP_MIN;

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes after midnight → "HH:MM". */
export function minToHHMM(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function slotKey(day: number, startMin: number): string {
  return `${day}-${minToHHMM(startMin)}`;
}

/** { day: 0–6 (Mon–Sun), startMin } for a stored key, or null if it isn't one. */
export function parseSlotKey(key: string): { day: number; startMin: number } | null {
  const m = /^([0-6])-(?:(\d{2}):(\d{2})|(\d{1,2}))$/.exec(key);
  if (!m) return null;
  const day = Number(m[1]);
  if (m[4] !== undefined) {
    // Legacy: slot index from 9:00 in 30-minute steps, Mon–Fri only.
    const slot = Number(m[4]);
    return day <= 4 && slot < 16 ? { day, startMin: 9 * 60 + slot * 30 } : null;
  }
  return { day, startMin: Number(m[2]) * 60 + Number(m[3]) };
}

/** Old keys rewritten in the current format (others kept, unknown ones dropped). */
export function normaliseSlots(keys: string[]): string[] {
  const out = new Set<string>();
  for (const k of keys) {
    const p = parseSlotKey(k);
    if (p) out.add(slotKey(p.day, p.startMin));
  }
  return [...out];
}

// ── Time zones ────────────────────────────────────────────────────────────────

/** How far `timeZone` is ahead of UTC at instant `ms`, in minutes. */
function offsetMinutes(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The instant (ms) when it is y-m-d h:min on the wall clock in `timeZone`. */
export function zonedToUtc(y: number, m: number, d: number, minOfDay: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, 0, minOfDay);
  const first = guess - offsetMinutes(guess, timeZone) * 60_000;
  // Second pass settles days when the offset changes (daylight saving).
  return guess - offsetMinutes(first, timeZone) * 60_000;
}

/** The wall-clock date in `timeZone` at instant `ms`: { y, m, d, dow (0 = Mon) }. */
export function zonedDate(ms: number, timeZone: string): { y: number; m: number; d: number; dow: number; minOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), dow, minOfDay: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export interface Interval { start: number; end: number }

/** The grid's free half-hours as absolute intervals between `from` and `to` (ms), merged. */
export function gridToIntervals(keys: string[], timeZone: string, from: number, to: number): Interval[] {
  const byDay = new Map<number, number[]>();
  for (const k of keys) {
    const p = parseSlotKey(k);
    if (p) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p.startMin]);
  }
  const out: Interval[] = [];
  // Walk each local calendar day in the range (one extra day either side for zone offsets).
  const seen = new Set<string>();
  for (let t = from - 86_400_000; t <= to + 86_400_000; t += 43_200_000) {   // half-day steps never skip a date
    const { y, m, d, dow } = zonedDate(t, timeZone);
    if (seen.has(`${y}-${m}-${d}`)) continue;
    seen.add(`${y}-${m}-${d}`);
    for (const startMin of byDay.get(dow) ?? []) {
      const start = zonedToUtc(y, m, d, startMin, timeZone);
      const end = start + GRID_STEP_MIN * 60_000;
      if (end > from && start < to) out.push({ start, end });
    }
  }
  return mergeIntervals(out);
}

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}
