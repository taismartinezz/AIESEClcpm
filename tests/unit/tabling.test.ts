import { describe, it, expect } from "vitest";
import { groupByDay, isFull, slotHours, startOfWeek } from "@/lib/tabling";
import type { TablingSlot } from "@/types";

const slot = (id: string, start: Date, hours = 2, taken = 0, capacity = 3): TablingSlot => ({
  id, projectId: "lc", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + hours * 3_600_000).toISOString(),
  location: "Hall", purpose: "Recruitment", capacity, taken, departmentId: null, seriesId: null, createdBy: null,
});

describe("tabling helpers", () => {
  it("starts weeks on Monday", () => {
    const wednesday = new Date(2026, 9, 14, 15, 0);
    const monday = startOfWeek(wednesday);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(12);
  });

  it("groups a week's slots by day, in time order", () => {
    const monday = new Date(2026, 9, 12);
    const days = groupByDay([
      slot("b", new Date(2026, 9, 14, 15)), slot("a", new Date(2026, 9, 14, 10)), slot("next-week", new Date(2026, 9, 20, 10)),
    ], monday);
    expect(days).toHaveLength(7);
    expect(days[2].slots.map((s) => s.id)).toEqual(["a", "b"]);
    expect(days.flatMap((d) => d.slots).map((s) => s.id)).not.toContain("next-week");
  });

  it("knows a slot's length and when it's full", () => {
    expect(slotHours(slot("x", new Date(), 2.5))).toBe(2.5);
    expect(isFull(slot("x", new Date(), 2, 3, 3))).toBe(true);
    expect(isFull(slot("x", new Date(), 2, 2, 3))).toBe(false);
  });
});
