import { describe, it, expect } from "vitest";
import { evaluate, monthlyDeadline, semesterMonths, type ComplianceData } from "@/lib/compliance";

const base: ComplianceData = { balance: 120, currency: "USD", approvals_12m: 6, meetings_12m: 9, boa_members: 3, university_affiliated: true, debt_plan: null, checks: [] };
const status = (d: Partial<ComplianceData>, today = "2026-11-09") => Object.fromEntries(evaluate({ ...base, ...d }, today).map((c) => [c.key, c.status]));

describe("membership criteria", () => {
  it("are green when met, and yellow or red when they aren't", () => {
    const checks = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"].map((month) => ({ kind: "sona" as const, month, done_on: month }));
    const hr = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map((month) => ({ kind: "hr_report" as const, month, done_on: month.replace("-01", "-20") }));
    expect(status({ checks: [...checks, ...hr] })).toEqual({ balance: "ok", boa: "ok", university: "ok", approvals: "ok", meetings: "ok", sona: "ok", hr_report: "ok" });
    expect(status({ balance: -50, boa_members: 1, university_affiliated: false, approvals_12m: 3, meetings_12m: 2 }))
      .toMatchObject({ balance: "fail", boa: "warn", university: "fail", approvals: "warn", meetings: "fail" });
    expect(status({ balance: -50, debt_plan: "Pay back 50 a month from the conference budget" }).balance).toBe("warn");
  });

  it("count late or missing monthly reports per semester; more than 2 is a downgrade", () => {
    expect(semesterMonths("2026-11-09").map((m) => m.m)).toEqual([7, 8, 9, 10, 11]);
    expect(semesterMonths("2026-03-02").map((m) => m.m)).toEqual([1, 2, 3]);
    // SONA: July on time, August late, September missing, October on time, November missing (due the 1st).
    const checks = [
      { kind: "sona" as const, month: "2026-07-01", done_on: "2026-07-01" },
      { kind: "sona" as const, month: "2026-08-01", done_on: "2026-08-03" },
      { kind: "sona" as const, month: "2026-10-01", done_on: "2026-09-30" },
    ];
    const s = monthlyDeadline("sona", checks, "2026-11-09");
    expect(s.missed).toBe(3);
    expect(status({ checks }).sona).toBe("fail");
    const sona = evaluate({ ...base, checks }, "2026-11-09").find((c) => c.key === "sona")!;
    expect(sona.detail).toBe("3 missed this semester (more than 2 means a downgrade). November's wasn't sent on time.");
    // The HR report for this month isn't due until the month's last day.
    const hr = monthlyDeadline("hr_report", [], "2026-11-09");
    expect(hr.current).toMatchObject({ due: "2026-11-30", missed: false });
    expect(hr.missed).toBe(4);                       // July to October
  });

  it("don't count deadlines from before the LC existed", () => {
    // Created on November 9: July to October, and November's SONA (due the 1st), weren't its to miss.
    const sona = monthlyDeadline("sona", [], "2026-11-09", "2026-11-09");
    expect(sona.missed).toBe(0);
    expect(sona.months).toEqual([]);
    expect(evaluate(base, "2026-11-09", "2026-11-09").find((c) => c.key === "sona")).toMatchObject({
      status: "ok", detail: "0 missed this semester (more than 2 means a downgrade). The first one is due by 2026-12-01.",
    });
    // November's HR report is due the 30th, so it counts.
    const hr = monthlyDeadline("hr_report", [], "2026-11-09", "2026-11-09");
    expect(hr.months.map((x) => x.month)).toEqual(["2026-11-01"]);
    expect(hr.missed).toBe(0);
    // An LC from September: only September onwards.
    expect(monthlyDeadline("sona", [], "2026-11-09", "2026-08-20").missed).toBe(3);
  });
});
