import { describe, expect, it } from "vitest";
import {
  budgetCsvRows, defaultPaymentDate, fyLabel, fyOf, monthIndex, parseAmount, parsePastedBudget, spreadEvenly, summarize, tagTotals, totals,
  type BudgetLine, type BudgetPayment,
} from "@/lib/mcBudget";

const line = (id: string, code: string, budget: number, extra: Partial<BudgetLine> = {}): BudgetLine =>
  ({ id, code, name: `Line ${code}`, parentId: null, prevBudget: null, budget, monthBudgets: null, notes: null, sortOrder: 0, ...extra });
const pay = (lineId: string, paidOn: string, amount: number, tags: string[] = []): BudgetPayment =>
  ({ id: `${lineId}-${paidOn}-${amount}`, lineId, paidOn, amount, description: "Payment", tags, comment: null });

describe("fiscal year", () => {
  it("runs July to June and is labelled like the sheet", () => {
    expect(fyLabel(2026)).toBe("26.27");
    expect(fyLabel(2099)).toBe("99.00");
    expect(fyOf("2026-07-01")).toBe(2026);
    expect(fyOf("2027-06-30")).toBe(2026);
    expect(fyOf("2026-06-30")).toBe(2025);
    expect(monthIndex("2026-07-15")).toBe(0);
    expect(monthIndex("2026-12-01")).toBe(5);
    expect(monthIndex("2027-06-30")).toBe(11);
  });

  it("suggests a payment date inside the year", () => {
    expect(defaultPaymentDate(2026, null, "2026-11-19")).toBe("2026-11-19");
    expect(defaultPaymentDate(2027, null, "2026-11-19")).toBe("2027-07-01");
    expect(defaultPaymentDate(2026, 3, "2026-11-19")).toBe("2026-10-01");
    expect(defaultPaymentDate(2026, 4, "2026-11-19")).toBe("2026-11-19");
    expect(defaultPaymentDate(2026, 7, "2026-11-19")).toBe("2027-02-01");
  });
});

describe("budget v actuals", () => {
  const lines = [
    line("hotel", "6300", 12000, { monthBudgets: [0, 0, 0, 6000, 0, 0, 0, 0, 0, 6000, 0, 0] }),
    line("fund", "6251", 999),
    line("fund-02", "6251-02", 500, { parentId: "fund", prevBudget: 400 }),
    line("fund-01", "6251-01", 1500, { parentId: "fund", prevBudget: 1000 }),
    line("travel", "6304", 3000),
  ];
  const payments = [
    pay("hotel", "2026-10-03", 5000, ["FallCo 2026"]),
    pay("hotel", "2026-10-20", 1500, ["FallCo 2026"]),
    pay("travel", "2026-10-02", 800, ["FallCo 2026", "Travel"]),
    pay("fund-01", "2027-01-10", 300),
    pay("travel", "2026-11-05", -50),
  ];

  it("orders lines by code, with sub-lines adding up into their line", () => {
    const tree = summarize(lines, payments);
    expect(tree.map((t) => t.line.code)).toEqual(["6251", "6300", "6304"]);
    const fund = tree[0];
    expect(fund.children.map((c) => c.line.code)).toEqual(["6251-01", "6251-02"]);
    expect(fund.budget).toBe(2000);            // its own 999 is ignored: the sub-lines decide
    expect(fund.prevBudget).toBe(1400);
    expect(fund.spent).toBe(300);
    expect(fund.actual[6]).toBe(300);           // January
    expect(fund.remaining).toBe(1700);
  });

  it("adds several payments in a month, refunds included", () => {
    const tree = summarize(lines, payments);
    const hotel = tree.find((t) => t.line.code === "6300")!;
    expect(hotel.actual[3]).toBe(6500);          // October: 5000 + 1500
    expect(hotel.payments).toBe(2);
    expect(hotel.plan?.[3]).toBe(6000);
    expect(hotel.remaining).toBe(5500);
    const travel = tree.find((t) => t.line.code === "6304")!;
    expect(travel.spent).toBe(750);
    expect(totals(tree)).toMatchObject({ budget: 17000, spent: 7550, remaining: 9450 });
  });

  it("with a tag, counts only payments carrying it", () => {
    const tree = summarize(lines, payments, { tag: "FallCo 2026" });
    expect(totals(tree).spent).toBe(7300);
    expect(tree.find((t) => t.line.code === "6251")!.spent).toBe(0);
    expect(tagTotals(payments)).toEqual([
      { tag: "FallCo 2026", spent: 7300, count: 3 },
      { tag: "Travel", spent: 800, count: 1 },
    ]);
  });

  it("takes last year's budget from last year's line with the same code", () => {
    const tree = summarize([line("t", "6304", 3000)], [], { prevLines: [line("old", "6304", 2500)] });
    expect(tree[0].prevBudget).toBe(2500);
  });

  it("exports a Budget and an Actuals row per line, as in the sheet", () => {
    const rows = budgetCsvRows(summarize(lines, payments), 2026);
    expect(rows[0].slice(0, 5)).toEqual(["Code", "Account", "Row", "Budget 25.26", "Budget 26.27"]);
    expect(rows[0]).toHaveLength(19);
    expect(rows.filter((r) => r[2] === "Actuals")).toHaveLength(5);
    const hotelActuals = rows.find((r) => r[0] === "6300" && r[2] === "Actuals")!;
    expect(hotelActuals[8]).toBe(6500);
    expect(hotelActuals.slice(-2)).toEqual([6500, 5500]);
  });
});

describe("numbers from a sheet", () => {
  it("reads the usual formats", () => {
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("1.234,50")).toBe(1234.5);
    expect(parseAmount("$ 12,000")).toBe(12000);
    expect(parseAmount("€80,5")).toBe(80.5);
    expect(parseAmount("(250)")).toBe(-250);
    expect(parseAmount("-75")).toBe(-75);
    expect(parseAmount("1.000.000")).toBe(1000000);
    expect(parseAmount("-")).toBe(0);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("n/a")).toBeNull();
  });

  it("spreads a budget over 12 months to the cent", () => {
    const months = spreadEvenly(1000);
    expect(months).toHaveLength(12);
    expect(Math.round(months.reduce((a, b) => a + b, 0) * 100)).toBe(100000);
    expect(months[0]).toBe(83.33);
  });

  it("reads pasted budget rows, skipping headers and ACTUALS, nesting sub-lines", () => {
    const months = ["0", "0", "0", "6,000", "0", "0", "0", "0", "0", "6,000", "0", "0"].join("\t");
    const text = [
      "Code\tAccount\tBudget 25.26\tBudget 26.27",
      "6251 Strategic Fund\t5,000\t6,000",
      "6251-01\tNational projects\t2,000\t2,500",
      "\tACTUALS\t\t",
      "6300\tConference Hotel\t12,000\t12,000\t" + months,
      "6300\tACTUALS\t\t\t5000",
      "Total\t\t17,000\t18,000",
    ].join("\n");
    const { lines, skipped } = parsePastedBudget(text);
    expect(skipped).toBe(4);
    expect(lines.map((l) => [l.code, l.name, l.prevBudget, l.budget, l.parentCode])).toEqual([
      ["6251", "Strategic Fund", 5000, 6000, null],
      ["6251-01", "National projects", 2000, 2500, "6251"],
      ["6300", "Conference Hotel", 12000, 12000, null],
    ]);
    expect(lines[2].monthBudgets?.[3]).toBe(6000);
    expect(lines[0].monthBudgets).toBeNull();
  });

  it("nests under a line that's already in the budget, and reads commas too", () => {
    const { lines } = parsePastedBudget("6304-02,Taxis,,\"1,200\"", ["6304"]);
    expect(lines).toEqual([{ code: "6304-02", name: "Taxis", prevBudget: null, budget: 1200, monthBudgets: null, parentCode: "6304" }]);
  });
});
