import { describe, it, expect } from "vitest";
import { balanceAt, flowBetween, growthSince, monthlyBalances, monthLabel, totals, withRunningBalance } from "@/lib/finance";
import type { FinanceEntry } from "@/types";

// AIESEC in Northwestern's statement (National Finance Tracker, Aug 2026 export).
const rows: [string, FinanceEntry["type"], number][] = [
  ["2025-09-01", "opening", 3381.0],
  ["2025-10-04", "expense", 9.77],
  ["2025-12-13", "expense", 1737.9],
  ["2026-01-12", "income", 840.0],
  ["2026-03-03", "expense", 503.83],
  ["2026-03-03", "expense", 433.6],
  ["2026-03-03", "expense", 53.94],
  ["2026-03-25", "income", 157.5],
  ["2026-04-06", "expense", 180.0],
  ["2026-07-27", "income", 1117.43],
  ["2026-09-22", "expense", 545.83],
  ["2026-10-28", "expense", 629.9],
];
const entries = rows.map(([date, type, amount], i) => ({
  id: String(i), projectId: "lc", type, amount, currency: "USD", date, categoryId: null, departmentId: null,
  description: "", recordedBy: null, receiptPath: null, claimId: null, createdAt: `${date}T00:00:0${i % 10}Z`,
  account: "lc" as const, paymentMethod: null, processedVia: null, area: null, notes: null,
}));

describe("the tracker's numbers", () => {
  it("ends at the statement's balance, with the opening balance counted as money in", () => {
    expect(balanceAt(entries, "2026-11-08")).toBe(1401.16);
    expect(withRunningBalance(entries).map((e) => e.runningBalance.toFixed(2)).slice(0, 3)).toEqual(["3381.00", "3371.23", "1633.33"]);
    expect(totals(entries, new Date("2026-11-08")).balance).toBeCloseTo(1401.16, 2);
  });

  it("an opening balance is not income", () => {
    const t = totals(entries, new Date("2025-09-15"));
    expect(t.yearIn).toBe(0);
    expect(flowBetween(entries, "2025-01-01", "2025-12-31")).toEqual({ income: 0, expense: 1747.67 });
  });

  it("growth since a date compares the balance then with now", () => {
    // 1 July 2026: 1,459.46 → 1,401.16
    expect(growthSince(entries, "2026-07-01", "2026-11-08")).toBeCloseTo(-0.03995, 4);
    expect(growthSince(entries, null)).toBeNull();
    expect(growthSince(entries, "2025-01-01", "2026-11-08")).toBeNull();     // nothing to grow from
  });

  it("gives an end-of-month balance for each month, for the trend chart", () => {
    const series = monthlyBalances(entries, "2026-02-01", "2026-05-15");
    expect(series).toEqual([
      { month: "2026-02", balance: 2473.33 },
      { month: "2026-03", balance: 1639.46 },
      { month: "2026-04", balance: 1459.46 },
      { month: "2026-05", balance: 1459.46 },
    ]);
    expect(monthLabel("2026-03")).toBe("Mar 2026");
  });
});
