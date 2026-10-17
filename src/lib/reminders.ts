// When each automatic email is due, and who gets it. Pure functions so the
// rules are unit-tested; /api/cron/notify does the sending.

export type EmailKind =
  | "event_invite" | "event_24h" | "event_1h"
  | "task_due" | "task_overdue" | "task_overdue_vp"
  | "checkin_open" | "checkin_nudge"
  | "digest" | "announcement";

export type EmailMode = "all" | "digest" | "important";

const IMPORTANT: EmailKind[] = ["event_invite", "event_24h", "event_1h", "task_overdue", "task_overdue_vp", "announcement"];

/** Event reminders, overdue tasks, invites and announcements always go out. */
export function wantsEmail(mode: EmailMode | null | undefined, kind: EmailKind): boolean {
  if (IMPORTANT.includes(kind)) return true;
  const m = mode ?? "all";
  if (kind === "digest") return m === "all" || m === "digest";
  return m === "all";
}

/** When an event starts: its time, or 09:00 UTC on its first day for all-day events. */
export function eventStart(ev: { starts_at: string | null; starts_on: string }): Date {
  return new Date(ev.starts_at ?? `${ev.starts_on}T09:00:00Z`);
}

/** Which event reminder is due now: 24 h before, then 1 h before (timed events only). */
export function eventReminderDue(ev: { starts_at: string | null; starts_on: string }, now: Date): "event_24h" | "event_1h" | null {
  const ms = eventStart(ev).getTime() - now.getTime();
  if (ms <= 0) return null;
  if (ev.starts_at && ms <= 3_600_000) return "event_1h";
  if (ms <= 24 * 3_600_000 && ms > (ev.starts_at ? 3_600_000 : 0)) return "event_24h";
  return null;
}

/** People who should get an event reminder: everyone invited except those who said they're not going. */
export function reminderRecipients(audience: string[], rsvps: { user_id: string; response: string }[]): string[] {
  const out = new Set(rsvps.filter((r) => r.response === "not_going").map((r) => r.user_id));
  return audience.filter((u) => !out.has(u));
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

/** Task emails due today for a task: the day before it's due, once when overdue, the VP when 3+ days late. */
export function taskEmailsDue(dueDate: string, now: Date): { due: boolean; overdue: boolean; escalate: boolean } {
  const today = isoDay(now);
  const lateDays = Math.floor((Date.parse(today) - Date.parse(dueDate)) / 86_400_000);
  return { due: dueDate === isoDay(addDays(now, 1)), overdue: lateDays >= 1, escalate: lateDays >= 3 };
}

/** Check-in emails: "it's open" on the period's first day, a nudge 2 days before it closes. */
export function checkinEmailDue(periodStart: Date, cadenceWeeks: 1 | 2, now: Date): "checkin_open" | "checkin_nudge" | null {
  const today = isoDay(now);
  if (today === isoDay(periodStart)) return "checkin_open";
  const lastDay = addDays(periodStart, cadenceWeeks * 7 - 1);
  if (today === isoDay(addDays(lastDay, -2))) return "checkin_nudge";
  return null;
}

/** The weekly digest goes out on Monday from 07:00 UTC; ref = that Monday. */
export function digestWeek(now: Date): string | null {
  return now.getUTCDay() === 1 && now.getUTCHours() >= 7 ? isoDay(now) : null;
}
