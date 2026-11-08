import { describe, it, expect } from "vitest";
import { mcTermStart, mcWeek, type DigestExchange } from "@/lib/mcDigest";
import { buildMcDigest } from "@/lib/member-emails";

const now = new Date("2026-11-09T08:00:00Z");                // a Monday
const ex = (project_id: string, over: Partial<DigestExchange>): DigestExchange =>
  ({ project_id, stage: "applied", applied_at: "2026-03-01", approved_at: null, realized_at: null, updated_at: "2026-11-08T10:00:00Z", ...over });

describe("the MC's weekly email", () => {
  const lcs = [{ id: "a", name: "AIESEC in Lisbon" }, { id: "b", name: "AIESEC in Porto" }];
  const exchanges = [
    ex("a", { stage: "approved", approved_at: "2026-11-05" }),
    ex("a", { stage: "approved", approved_at: "2026-11-07" }),
    ex("a", { stage: "realized", approved_at: "2026-09-01", realized_at: "2026-11-06" }),
    ex("a", { stage: "approved", approved_at: "2026-10-30" }),                       // the week before
    ex("b", { stage: "approved", approved_at: "2026-08-01", updated_at: "2026-08-01T00:00:00Z" }),
  ];

  it("counts last week per LC against the week before, and flags what needs attention", () => {
    const w = mcWeek(lcs, exchanges, {}, mcTermStart(null, now), now);
    expect(w.lcs.find((l) => l.id === "a")).toMatchObject({ approvedWeek: 2, approvedPrev: 1, realizedWeek: 1 });
    expect(w.totals).toEqual({ approvedWeek: 2, approvedPrev: 1, realizedWeek: 1 });
    expect(w.attention.map((x) => x.name)).toEqual(["AIESEC in Porto"]);
    expect(w.attention[0].reasons).toContain("1 approved 60+ days ago, not realized yet");
  });

  it("writes it up with the numbers in the subject", () => {
    const w = mcWeek(lcs, exchanges, {}, mcTermStart(null, now), now);
    const mail = buildMcDigest({ to: "mcp@x.org", recipientName: "Ana", mcName: "AIESEC in Portugal", week: w });
    expect(mail.subject).toBe("2 approvals last week, 1 LC needs attention (AIESEC in Portugal)");
    expect(mail.text).toContain("up 1 on the week before");
    expect(mail.text).toContain("- AIESEC in Lisbon: 2 / 1");
    expect(mail.html).toContain("/mc");
  });

  it("uses the MC's own term start, or the latest 1 February", () => {
    expect(mcTermStart(null, now)).toBe("2026-02-01");
    expect(mcTermStart(null, new Date("2026-01-15T00:00:00Z"))).toBe("2025-02-01");
    expect(mcTermStart("2026-07-01", now)).toBe("2026-07-01");
  });
});
