import { describe, it, expect } from "vitest";
import { needsAttention, pace, sourceLabel, termProgress, type LcHealth } from "@/lib/mcPace";

const today = new Date("2026-08-02T12:00:00");                 // half a year into a 1 Feb term
const health = (over: Partial<LcHealth> = {}): LcHealth => ({
  project_id: "x", last_approved: "2026-07-30", approved_30d: 2, stuck_approved: 0,
  last_activity: "2026-08-01T10:00:00Z", from_expa: 0, total: 10, last_expa_sync: null, ...over,
});

describe("pace", () => {
  it("measures progress through the term", () => {
    expect(termProgress("2026-02-01", today)).toBeCloseTo(182 / 365, 2);
    expect(termProgress("2026-09-01", today)).toBe(0);
    expect(termProgress("2025-01-01", today)).toBe(1);
  });

  it("compares actuals with what's expected by now", () => {
    const half = 0.5;
    expect(pace(15, 30, half)).toEqual({ status: "on-track", expected: 15, pct: 50 });
    expect(pace(20, 30, half)?.status).toBe("ahead");
    expect(pace(12, 30, half)?.status).toBe("slightly-behind");
    expect(pace(5, 30, half)).toEqual({ status: "behind", expected: 15, pct: 17 });
    expect(pace(0, 30, 0)?.status).toBe("on-track");             // first day: nothing expected yet
    expect(pace(3, 0, half)).toBeNull();                         // no target
  });
});

describe("needs attention", () => {
  const progress = termProgress("2026-02-01", today);
  it("flags no recent approvals, stuck approvals, stale data, low conversion and falling behind", () => {
    const list = needsAttention([
      { id: "ok", name: "Fine LC", applied: 40, approved: 20, approvedTarget: 40, health: health() },
      { id: "quiet", name: "Quiet LC", applied: 40, approved: 4, approvedTarget: 40,
        health: health({ approved_30d: 0, last_approved: "2026-05-01", stuck_approved: 3, last_activity: "2026-06-01T00:00:00Z" }) },
      { id: "new", name: "New LC", applied: 0, approved: 0, approvedTarget: null, health: health({ approved_30d: 0, last_approved: null, last_activity: null, total: 0 }) },
    ], progress, today);
    expect(list.map((l) => l.id)).toEqual(["quiet", "new"]);
    expect(list[0].reasons).toEqual([
      "No approvals in 93 days",
      "3 approved 60+ days ago, not realized yet",
      "Pipeline not updated in 62 days",
      "Applied → approved 10% (national 30%)",
      "Behind pace: 4 / 40 approvals (20 expected by now)",
    ]);
    expect(list[1].reasons).toEqual(["No approvals yet", "No pipeline data yet"]);
  });

  it("doesn't flag 'no approvals in 30 days' in a term's first month", () => {
    const early = termProgress("2026-02-01", new Date("2026-02-10T12:00:00"));
    expect(needsAttention([{ id: "a", name: "A", applied: 0, approved: 0, approvedTarget: null, health: health({ approved_30d: 0, last_approved: null }) }], early, new Date("2026-02-10T12:00:00"))).toEqual([]);
  });
});

describe("source line", () => {
  it("says when the numbers changed and where they come from", () => {
    expect(sourceLabel(health({ last_expa_sync: "2026-07-31T09:00:00Z" }), today)).toBe("Updated 1d ago · EXPA sync 2d ago");
    expect(sourceLabel(health(), today)).toBe("Updated 1d ago · entered by hand");
    expect(sourceLabel(health({ last_activity: null, total: 0 }), today)).toBe("No data yet");
  });
});
