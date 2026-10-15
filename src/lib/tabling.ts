import type { TablingReportRow, TablingSignup, TablingSlot } from "@/types";

export function mapSlot(row: Record<string, unknown>): TablingSlot {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    location: row.location as string,
    purpose: row.purpose as string,
    capacity: row.capacity as number,
    taken: row.taken as number,
    departmentId: (row.department_id as string | null) ?? null,
    seriesId: (row.series_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
  };
}

export function mapSignup(row: Record<string, unknown>): TablingSignup {
  return {
    slotId: row.slot_id as string,
    userId: row.user_id as string,
    status: row.status as TablingSignup["status"],
    walkIn: (row.walk_in as boolean) ?? false,
    signedUpAt: row.signed_up_at as string,
  };
}

export function mapReportRow(row: Record<string, unknown>): TablingReportRow {
  return {
    userId: row.user_id as string,
    hours: Number(row.hours),
    attended: row.attended as number,
    noShows: row.no_shows as number,
    upcoming: row.upcoming as number,
  };
}

export function slotHours(slot: Pick<TablingSlot, "startsAt" | "endsAt">): number {
  return (new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()) / 3_600_000;
}

export const isFull = (s: TablingSlot) => s.taken >= s.capacity;
export const hasStarted = (s: TablingSlot, now = new Date()) => new Date(s.startsAt) <= now;

/** Monday 00:00 (local time) of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Slots in the 7 days from `weekStart`, grouped by local day (Mon..Sun). */
export function groupByDay(slots: TablingSlot[], weekStart: Date): { day: Date; slots: TablingSlot[] }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i);
    const next = addDays(day, 1);
    return {
      day,
      slots: slots
        .filter((s) => { const t = new Date(s.startsAt); return t >= day && t < next; })
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    };
  });
}

export function formatTimeRange(slot: Pick<TablingSlot, "startsAt" | "endsAt">): string {
  const f = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${f(slot.startsAt)}–${f(slot.endsAt)}`;
}

export function formatHours(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}
