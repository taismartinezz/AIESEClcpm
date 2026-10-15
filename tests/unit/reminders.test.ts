// @vitest-environment node
import { describe, it, expect } from "vitest";
import { checkinEmailDue, digestWeek, eventReminderDue, reminderRecipients, taskEmailsDue, wantsEmail } from "@/lib/reminders";
import { buildIcs } from "@/lib/ics";
import { rsvpToken, verifyRsvpToken } from "@/lib/rsvp-token";

const now = new Date("2026-10-15T10:00:00Z");   // a Thursday

describe("preferences", () => {
  it("important emails always go out; the digest for all/digest; the rest only for all", () => {
    expect(wantsEmail("important", "event_1h")).toBe(true);
    expect(wantsEmail("important", "task_overdue")).toBe(true);
    expect(wantsEmail("important", "digest")).toBe(false);
    expect(wantsEmail("digest", "digest")).toBe(true);
    expect(wantsEmail("digest", "checkin_open")).toBe(false);
    expect(wantsEmail(null, "task_due")).toBe(true);
  });
});

describe("event reminders", () => {
  it("24 hours, then 1 hour before a timed event", () => {
    expect(eventReminderDue({ starts_at: "2026-10-16T09:00:00Z", starts_on: "2026-10-16" }, now)).toBe("event_24h");
    expect(eventReminderDue({ starts_at: "2026-10-15T10:45:00Z", starts_on: "2026-10-15" }, now)).toBe("event_1h");
    expect(eventReminderDue({ starts_at: "2026-10-17T10:00:00Z", starts_on: "2026-10-17" }, now)).toBeNull();
    expect(eventReminderDue({ starts_at: "2026-10-15T09:00:00Z", starts_on: "2026-10-15" }, now)).toBeNull();
  });
  it("all-day events get only the day-before reminder", () => {
    expect(eventReminderDue({ starts_at: null, starts_on: "2026-10-16" }, now)).toBe("event_24h");
  });
  it("skip people who said they're not going", () => {
    expect(reminderRecipients(["a", "b", "c"], [{ user_id: "b", response: "not_going" }, { user_id: "c", response: "going" }])).toEqual(["a", "c"]);
  });
});

describe("task, check-in and digest timing", () => {
  it("tasks: the day before, then overdue, then the VP after 3 days", () => {
    expect(taskEmailsDue("2026-10-16", now)).toEqual({ due: true, overdue: false, escalate: false });
    expect(taskEmailsDue("2026-10-14", now)).toEqual({ due: false, overdue: true, escalate: false });
    expect(taskEmailsDue("2026-10-12", now).escalate).toBe(true);
  });
  it("check-in: open on day one, nudge two days before the end", () => {
    expect(checkinEmailDue(new Date("2026-10-15T00:00:00Z"), 2, now)).toBe("checkin_open");
    expect(checkinEmailDue(new Date("2026-10-05T00:00:00Z"), 2, new Date("2026-10-16T10:00:00Z"))).toBe("checkin_nudge");   // period ends Sun 18th
    expect(checkinEmailDue(new Date("2026-10-12T00:00:00Z"), 2, now)).toBeNull();
  });
  it("digest: Mondays from 07:00 UTC", () => {
    expect(digestWeek(now)).toBeNull();
    expect(digestWeek(new Date("2026-10-19T08:00:00Z"))).toBe("2026-10-19");
    expect(digestWeek(new Date("2026-10-19T06:00:00Z"))).toBeNull();
  });
});

describe("calendar invites", () => {
  it("timed and all-day events, escaped and folded", () => {
    const timed = buildIcs({ uid: "e1@aiesec", title: "GA; room 2, floor 3", startsAt: "2026-10-20T17:00:00Z", startsOn: "2026-10-20", endsOn: "2026-10-20", url: "https://zoom.example/j/1" }, now);
    expect(timed).toContain("DTSTART:20261020T170000Z");
    expect(timed).toContain("DTEND:20261020T180000Z");
    expect(timed).toContain("SUMMARY:GA\; room 2\\, floor 3");
    const allDay = buildIcs({ uid: "e2@aiesec", title: "Conference", startsOn: "2026-11-01", endsOn: "2026-11-02", description: "x".repeat(200) }, now);
    expect(allDay).toContain("DTSTART;VALUE=DATE:20261101");
    expect(allDay).toContain("DTEND;VALUE=DATE:20261103");
    expect(allDay.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
});

describe("RSVP links", () => {
  it("are bound to one event and one person", () => {
    process.env.RSVP_SECRET = "test-secret";
    const t = rsvpToken("ev1", "u1");
    expect(verifyRsvpToken("ev1", "u1", t)).toBe(true);
    expect(verifyRsvpToken("ev1", "u2", t)).toBe(false);
    expect(verifyRsvpToken("ev2", "u1", t)).toBe(false);
    expect(verifyRsvpToken("ev1", "u1", "nope")).toBe(false);
  });
});
