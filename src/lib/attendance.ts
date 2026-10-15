import type { AttendanceRecord, LcEvent, LcEventType } from "@/types";

export const EVENT_TYPES: LcEventType[] = [
  "local_event", "local_conference", "national_conference", "international_conference", "info_session", "other",
];

export const EVENT_TYPE_LABELS: Record<LcEventType, string> = {
  local_event: "Local event",
  local_conference: "Local conference",
  national_conference: "National conference",
  international_conference: "International conference",
  info_session: "Info session",
  other: "Other",
};

export function mapEvent(row: Record<string, unknown>): LcEvent {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    type: row.type as LcEventType,
    startsOn: row.starts_on as string,
    endsOn: row.ends_on as string,
    location: (row.location as string | null) ?? null,
    departmentId: (row.department_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
  };
}

export function mapAttendance(row: Record<string, unknown>): AttendanceRecord {
  return {
    eventId: row.event_id as string,
    userId: row.user_id as string,
    recordedBy: (row.recorded_by as string | null) ?? null,
    recordedAt: row.recorded_at as string,
  };
}

export function formatEventDates(e: Pick<LcEvent, "startsOn" | "endsOn">): string {
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return e.startsOn === e.endsOn ? fmt(e.startsOn) : `${fmt(e.startsOn)} – ${fmt(e.endsOn)}`;
}

export interface MemberAttendance {
  userId: string;
  total: number;
  byType: Record<LcEventType, number>;
}

function emptyByType(): Record<LcEventType, number> {
  return Object.fromEntries(EVENT_TYPES.map((t) => [t, 0])) as Record<LcEventType, number>;
}

/** Count attendance per member, optionally limited to events in [from, to] and of some types. */
export function attendanceByMember(
  records: AttendanceRecord[], events: LcEvent[],
  opts: { from?: string; to?: string; types?: LcEventType[] } = {},
): Map<string, MemberAttendance> {
  const eventById = new Map(events.map((e) => [e.id, e]));
  const out = new Map<string, MemberAttendance>();
  for (const r of records) {
    const e = eventById.get(r.eventId);
    if (!e) continue;
    if (opts.from && e.startsOn < opts.from) continue;
    if (opts.to && e.startsOn > opts.to) continue;
    if (opts.types && opts.types.length && !opts.types.includes(e.type)) continue;
    const m = out.get(r.userId) ?? { userId: r.userId, total: 0, byType: emptyByType() };
    m.total += 1;
    m.byType[e.type] += 1;
    out.set(r.userId, m);
  }
  return out;
}
