import { describe, it, expect } from "vitest";
import { breakdown, totals, withRunningBalance } from "@/lib/finance";
import { toCsv } from "@/lib/csv";
import { isFinanceLead } from "@/lib/permissions";
import type { FinanceEntry } from "@/types";

const entry = (id: string, type: FinanceEntry["type"], amount: number, date: string, categoryId: string | null = null): FinanceEntry => ({
  id, projectId: "lc", type, amount, currency: "EUR", date, categoryId, departmentId: null,
  description: id, recordedBy: null, receiptPath: null, claimId: null, createdAt: `${date}T10:00:00Z`,
});

describe("finance totals", () => {
  const entries = [
    entry("sponsor", "income", 500, "2026-10-02", "c-sponsor"),
    entry("posters", "expense", 120, "2026-10-05", "c-mkt"),
    entry("old-trip", "expense", 80, "2025-12-20", "c-transport"),
    entry("fees", "income", 60, "2026-03-01", "c-fees"),
  ];

  it("computes balance, month and year-to-date", () => {
    expect(totals(entries, new Date("2026-10-15T12:00:00Z"))).toEqual({
      balance: 360, monthIn: 500, monthOut: 120, yearIn: 560, yearOut: 120,
    });
  });

  it("keeps a running balance in date order", () => {
    expect(withRunningBalance(entries).map((e) => [e.id, e.runningBalance])).toEqual([
      ["old-trip", -80], ["fees", -20], ["sponsor", 480], ["posters", 360],
    ]);
  });

  it("breaks spend down by category", () => {
    expect(Object.fromEntries(breakdown(entries, "expense", (e) => e.categoryId))).toEqual({ "c-mkt": 120, "c-transport": 80 });
  });
});

describe("CSV export", () => {
  it("quotes commas/quotes and neutralises formulas", () => {
    const csv = toCsv([{ a: 'He said "hi", ok', b: "=HYPERLINK(\"x\")", c: -12.5 }], [
      { header: "A", value: (r) => r.a }, { header: "B", value: (r) => r.b }, { header: "C", value: (r) => r.c },
    ]);
    expect(csv).toBe('A,B,C\r\n"He said ""hi"", ok","\'=HYPERLINK(""x"")",-12.5\r\n');
  });
});

describe("isFinanceLead (mirrors SQL is_finance_lead)", () => {
  const deps = [{ vpUserId: "fiona", isFinance: true }, { vpUserId: "vera", isFinance: false }];
  it("is the president or the finance department's VP", () => {
    expect(isFinanceLead("president", "anyone", deps)).toBe(true);
    expect(isFinanceLead("vp", "fiona", deps)).toBe(true);
    expect(isFinanceLead("vp", "vera", deps)).toBe(false);
    expect(isFinanceLead("member", "fiona", deps)).toBe(false);
  });
});
