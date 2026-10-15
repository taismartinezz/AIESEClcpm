import { describe, it, expect } from "vitest";
import { attendanceByMember, formatEventDates } from "@/lib/attendance";
import type { AttendanceRecord, LcEvent } from "@/types";

const ev = (id: string, type: LcEvent["type"], startsOn: string): LcEvent =>
  ({ id, projectId: "lc", name: id, type, startsOn, endsOn: startsOn, location: null, departmentId: null, createdBy: null });
const rec = (eventId: string, userId: string): AttendanceRecord => ({ eventId, userId, recordedBy: null, recordedAt: "" });

const events = [ev("natco", "national_conference", "2026-03-10"), ev("info", "info_session", "2026-09-01"), ev("old", "local_event", "2025-11-01")];
const records = [rec("natco", "mo"), rec("info", "mo"), rec("old", "mo"), rec("info", "gia")];

describe("attendanceByMember", () => {
  it("counts per member and per event type", () => {
    const mo = attendanceByMember(records, events).get("mo")!;
    expect(mo.total).toBe(3);
    expect(mo.byType.national_conference).toBe(1);
    expect(mo.byType.local_event).toBe(1);
  });

  it("limits to this term and to chosen types", () => {
    expect(attendanceByMember(records, events, { from: "2026-02-01" }).get("mo")?.total).toBe(2);
    expect(attendanceByMember(records, events, { types: ["info_session"] }).get("gia")?.total).toBe(1);
    expect(attendanceByMember(records, events, { types: ["info_session"] }).get("mo")?.byType.national_conference).toBe(0);
  });
});

describe("formatEventDates", () => {
  it("shows one date for single-day events and a range otherwise", () => {
    expect(formatEventDates({ startsOn: "2026-03-10", endsOn: "2026-03-10" })).not.toContain("–");
    expect(formatEventDates({ startsOn: "2026-03-10", endsOn: "2026-03-12" })).toContain("–");
  });
});
