import { describe, it, expect } from "vitest";
import { achieved, backwards, DEFAULT_RATES, lcRates, plan } from "@/lib/funnelPlan";

describe("working backwards from approvals", () => {
  it("turns an approvals goal into sign-ups, applicants and acceptances", () => {
    // 30 approvals at 55% → 55 accepted; at 47% → 118 applicants; at 15% → 787 sign-ups.
    expect(backwards(30, DEFAULT_RATES)).toEqual({ approved: 30, accepted: 55, applied: 118, signups: 787 });
  });

  it("uses the LC's own rates once there's enough history", () => {
    const ex = (signedUpAt: string, stage: number) => ({
      signedUpAt, appliedAt: stage >= 1 ? signedUpAt : null, acceptedAt: stage >= 2 ? signedUpAt : null, approvedAt: stage >= 3 ? signedUpAt : null,
    });
    const history = [
      ...Array.from({ length: 12 }, () => ex("2026-03-01", 0)),
      ...Array.from({ length: 4 }, () => ex("2026-03-01", 1)),
      ...Array.from({ length: 2 }, () => ex("2026-03-01", 2)),
      ...Array.from({ length: 2 }, () => ex("2026-03-01", 3)),
      ex("2024-01-01", 3),                                   // too old: not counted
    ];
    const r = lcRates(history, "2025-11-09")!;
    expect(r.signupToApplied).toBeCloseTo(8 / 20);
    expect(r.appliedToAccepted).toBeCloseTo(4 / 8);
    expect(r.acceptedToApproved).toBeCloseTo(2 / 4);
    expect(lcRates(history.slice(0, 5), "2025-11-09")).toBeNull();     // too little to go on
  });

  it("subtracts what's done this term and spreads the rest over the weeks left", () => {
    const done = achieved([
      { signedUpAt: "2026-03-01", appliedAt: "2026-03-05", acceptedAt: null, approvedAt: null },
      { signedUpAt: "2026-01-10", appliedAt: "2026-01-15", acceptedAt: "2026-02-10", approvedAt: "2026-02-20" },
    ], "2026-02-01");
    expect(done).toEqual({ signups: 1, applied: 1, accepted: 1, approved: 1 });
    const p = plan(30, DEFAULT_RATES, done, "2027-01-31", "2026-11-09");
    expect(p.weeksLeft).toBe(12);
    expect(p.left).toEqual({ signups: 786, applied: 117, accepted: 54, approved: 29 });
    expect(p.perWeek).toEqual({ signups: 66, applied: 10, accepted: 5, approved: 3 });
  });
});
