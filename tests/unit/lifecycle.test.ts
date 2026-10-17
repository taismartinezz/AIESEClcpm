import { describe, it, expect } from "vitest";
import { activityFlags, stepsFor, type MemberActivity } from "@/lib/lifecycle";

const base: MemberActivity = {
  userId: "u", departmentId: "d", role: "member", termStart: null, termEnd: null, lastSeenAt: "2026-10-14T10:00:00Z",
  eventsHeld: 0, eventsAttended: 0, tablingNoShows: 0, overdueTasks: 0, onboardingDone: 0, onboardingTotal: 5,
};
const now = new Date("2026-10-15T12:00:00Z");

describe("activity flags", () => {
  it("flag nothing for an active member", () => {
    expect(activityFlags(base, now)).toEqual([]);
  });
  it("flag long absences, low attendance, no-shows, overdue work and terms ending", () => {
    const kinds = activityFlags({ ...base, lastSeenAt: "2026-09-20T00:00:00Z", eventsHeld: 4, eventsAttended: 1, tablingNoShows: 2, overdueTasks: 3, termEnd: "2026-11-01" }, now)
      .map((f) => f.kind);
    expect(kinds).toEqual(["inactive", "attendance", "no_shows", "overdue", "term_ending"]);
  });
  it("don't judge attendance on one or two events", () => {
    expect(activityFlags({ ...base, eventsHeld: 2, eventsAttended: 0 }, now)).toEqual([]);
  });
});

describe("onboarding steps", () => {
  it("include LC-wide steps plus the member's department's, in order", () => {
    const steps = [
      { id: "b", title: "B", description: null, departmentId: null, sortOrder: 2 },
      { id: "a", title: "A", description: null, departmentId: null, sortOrder: 1 },
      { id: "m", title: "Marketing tools", description: null, departmentId: "mkt", sortOrder: 3 },
    ];
    expect(stepsFor(steps, "mkt").map((s) => s.id)).toEqual(["a", "b", "m"]);
    expect(stepsFor(steps, "ogv").map((s) => s.id)).toEqual(["a", "b"]);
  });
});
