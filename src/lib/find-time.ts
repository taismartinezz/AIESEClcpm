// "Find a time": the best meeting slots for a group, from each person's busy
// times (Google Calendar free/busy, app events) or their weekly availability
// grid. Pure functions, so they run in tests and on the server alike.

import { zonedDate, zonedToUtc, type Interval } from "@/lib/availability";

export type Source = "google" | "grid" | "none";

export interface PersonAvailability {
  id: string;
  source: Source;
  /** Known busy times (Google, app events and meetings). */
  busy: Interval[];
  /** Grid people: when they said they're usually free. Ignored for other sources. */
  free?: Interval[];
}

export interface Suggestion {
  start: number;
  end: number;
  free: string[];
  busy: string[];
  /** No calendar and no grid: we can't tell. */
  unknown: string[];
}

export interface FindTimeOptions {
  durationMin: number;
  from: number;
  to: number;
  /** The organiser's time zone: candidate times are on its half hours, within dayStart–dayEnd. */
  timeZone: string;
  dayStartMin?: number;
  dayEndMin?: number;
  stepMin?: number;
  max?: number;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const covered = (slot: Interval, windows: Interval[]) => windows.some((w) => w.start <= slot.start && w.end >= slot.end);

function status(p: PersonAvailability, slot: Interval): "free" | "busy" | "unknown" {
  if (p.busy.some((b) => overlaps(b, slot))) return "busy";
  if (p.source === "google") return "free";
  if (p.source === "grid") return covered(slot, p.free ?? []) ? "free" : "busy";
  return "unknown";
}

/**
 * Up to `max` slots, best first: everyone free beats one person busy, and so
 * on; ties go to the earliest. Suggestions are spread over different days when
 * the scores allow, so you get real alternatives rather than 18:00, 18:30, 19:00.
 */
export function findTimes(people: PersonAvailability[], o: FindTimeOptions): Suggestion[] {
  const step = o.stepMin ?? 30;
  const dayStart = o.dayStartMin ?? 8 * 60;
  const dayEnd = o.dayEndMin ?? 22 * 60;
  const dur = o.durationMin * 60_000;

  const candidates: (Suggestion & { day: string; score: number })[] = [];
  const seenDays = new Set<string>();
  for (let t = o.from; t < o.to; t += 43_200_000) {
    const { y, m, d } = zonedDate(t, o.timeZone);
    const day = `${y}-${m}-${d}`;
    if (seenDays.has(day)) continue;
    seenDays.add(day);
    for (let min = dayStart; min + o.durationMin <= dayEnd; min += step) {
      const start = zonedToUtc(y, m, d, min, o.timeZone);
      const slot = { start, end: start + dur };
      if (slot.start < o.from || slot.end > o.to) continue;
      const s: Suggestion = { ...slot, free: [], busy: [], unknown: [] };
      for (const p of people) s[status(p, slot)].push(p.id);
      candidates.push({ ...s, day, score: s.free.length * 2 + s.unknown.length });
    }
  }

  // Nobody free at all isn't a suggestion.
  const ranked = candidates.filter((c) => c.free.length > 0).sort((a, b) => b.score - a.score || a.start - b.start);
  const max = o.max ?? 3;
  const picked: typeof ranked = [];
  const usedDays = new Set<string>();
  // First pass: the best slot of each day, as long as it's as good as the best overall.
  for (const c of ranked) {
    if (picked.length >= max) break;
    if (usedDays.has(c.day) || c.score < (ranked[0]?.score ?? 0)) continue;
    picked.push(c); usedDays.add(c.day);
  }
  // Then fill with whatever ranks next.
  for (const c of ranked) {
    if (picked.length >= max) break;
    if (!picked.includes(c) && !picked.some((p) => overlaps(p, c))) picked.push(c);
  }
  // In the order picked: best first, other days before a second time on the same day.
  return picked.map((c) => ({ start: c.start, end: c.end, free: c.free, busy: c.busy, unknown: c.unknown }));
}
