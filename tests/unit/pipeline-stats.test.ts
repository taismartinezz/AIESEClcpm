import { describe, it, expect } from "vitest";
import { pipelineStats, stuckExchanges, weekOverWeek, weekStart, formatPct } from "@/lib/pipeline";
import type { Exchange } from "@/types";

const ex = (over: Partial<Exchange>): Exchange => ({
  id: Math.random().toString(36), projectId: "p", product: "ogv", stage: "applied", personName: "x",
  email: null, phone: null, opportunity: null, hostEntity: null, expaId: null, expaUrl: null, departmentId: null, ownerId: null, notes: null,
  signedUpAt: null, appliedAt: null, acceptedAt: null, approvedAt: null, realizedAt: null, finishedAt: null, completedAt: null,
  updatedAt: "", ...over,
});

describe("pipeline numbers", () => {
  const list = [
    ex({ stage: "realized", appliedAt: "2026-02-05", acceptedAt: "2026-02-10", approvedAt: "2026-02-20", realizedAt: "2026-06-01" }),
    ex({ stage: "approved", appliedAt: "2026-02-07", acceptedAt: "2026-02-12", approvedAt: "2026-03-01" }),
    ex({ stage: "accepted", appliedAt: "2026-03-01", acceptedAt: "2026-03-05" }),
    ex({ stage: "applied", appliedAt: "2026-03-02" }),
    ex({ stage: "approved", appliedAt: "2025-12-01", acceptedAt: "2026-01-01", approvedAt: "2026-01-15" }),
  ];

  it("counts by the date each stage was reached, inside the term", () => {
    const s = pipelineStats(list, "2026-02-01", "2027-01-31");
    expect(s).toMatchObject({ applied: 4, approved: 2, realized: 1 });
    expect(formatPct(s.appliedToAccepted)).toBe("75%");
    expect(formatPct(s.appliedToApproved)).toBe("50%");
    expect(formatPct(s.approvedToRealized)).toBe("50%");
    expect(formatPct(pipelineStats([], "2026-02-01", "2027-01-31").appliedToApproved)).toBe("-");
  });

  it("flags applications and acceptances waiting 14+ days", () => {
    const stuck = stuckExchanges(list, new Date("2026-03-20T12:00:00"));
    expect(stuck.map((s) => [s.exchange.stage, s.days])).toEqual([["applied", 18], ["accepted", 15]]);
  });

  it("compares this week with last week, Monday to Sunday", () => {
    expect(weekStart(new Date("2026-10-15T10:00:00"))).toBe("2026-10-12");
    const w = weekOverWeek([ex({ approvedAt: "2026-10-13" }), ex({ approvedAt: "2026-10-06" }), ex({ approvedAt: "2026-10-11" })], new Date("2026-10-15T10:00:00"));
    expect(w).toMatchObject({ approvedThisWeek: 1, approvedLastWeek: 2 });
  });
});
