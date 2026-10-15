import { describe, it, expect } from "vitest";
import { PRODUCTS, STAGES, STAGE_DATE_FIELD } from "@/lib/products";
import { daysSince, progressRatio } from "@/lib/pipeline";
import { followUpState } from "@/lib/partners";

describe("products and stages", () => {
  it("follow AIESEC's product colours", () => {
    const color = Object.fromEntries(PRODUCTS.map((p) => [p.code, p.color]));
    expect(color.ogv).toBe("#F85A40");
    expect(color.igta).toBe("#0CB9C1");
    expect(color.ogte).toBe("#F48924");
  });

  it("run Sign-up → Applied → Accepted → Approved → Realized → Finished, each with a date field", () => {
    expect(STAGES.map((s) => s.label)).toEqual(["Sign-up", "Applied", "Accepted", "Approved", "Realized", "Finished"]);
    expect(STAGES.every((s) => STAGE_DATE_FIELD[s.code])).toBe(true);
  });
});

describe("helpers", () => {
  it("caps goal progress between 0 and 1", () => {
    expect(progressRatio(5, 20)).toBe(0.25);
    expect(progressRatio(30, 20)).toBe(1);
    expect(progressRatio(3, 0)).toBe(0);
  });

  it("counts days in a stage", () => {
    expect(daysSince("2026-10-10", new Date("2026-10-15T12:00:00"))).toBe(5);
    expect(daysSince(null)).toBeNull();
  });
});


describe("partner follow-ups", () => {
  it("are overdue, due soon (within 7 days) or fine", () => {
    expect(followUpState("2026-10-10", "2026-10-15")).toBe("overdue");
    expect(followUpState("2026-10-20", "2026-10-15")).toBe("soon");
    expect(followUpState("2026-11-20", "2026-10-15")).toBeNull();
    expect(followUpState(null, "2026-10-15")).toBeNull();
  });
});
