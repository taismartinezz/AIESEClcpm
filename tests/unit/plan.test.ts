import { describe, it, expect } from "vitest";
import { battleMonths } from "@/lib/plan";

const term = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 1 + i, 1)).toISOString().slice(0, 10)); // Feb 2026 → Jan 2027

describe("battleMonths", () => {
  it("shows this month and the next two, earlier months folded", () => {
    const { earlier, shown, later } = battleMonths(term, "2026-11-01");
    expect(shown).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
    expect(earlier).toHaveLength(9);
    expect(later).toEqual([]);
  });
  it("before the term, its first three months", () => {
    expect(battleMonths(term, "2025-12-01").shown).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
  });
  it("after the term, its last three months", () => {
    expect(battleMonths(term, "2027-06-01").shown).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });
});
