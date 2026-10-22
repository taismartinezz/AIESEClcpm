import { describe, it, expect } from "vitest";
import { formatDay } from "@/lib/dates";

describe("formatDay", () => {
  const now = new Date(2026, 9, 22);
  it("shows a date this year as 'Oct 20' and other years with the year", () => {
    expect(formatDay("2026-10-20", now)).toBe("Oct 20");
    expect(formatDay("2025-12-13", now)).toBe("Dec 13, 2025");
  });
  it("accepts timestamps, and shows '-' for nothing", () => {
    expect(formatDay("2026-03-05T14:00:00Z", now)).toBe("Mar 5");
    expect(formatDay(null, now)).toBe("-");
  });
});
