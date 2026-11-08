import { describe as group, it, expect } from "vitest";
import { departmentForArea, describe, nextDue, ROUTINE_TEMPLATES } from "@/lib/routines";

group("routine schedules", () => {
  it("say when they happen in plain words", () => {
    expect(describe({ freq: "weekly", weekday: 1 })).toBe("Every Monday");
    expect(describe({ freq: "biweekly", weekday: 4, anchor: "2026-01-01" })).toBe("Every other Thursday");
    expect(describe({ freq: "monthly", month_day: 1 })).toBe("1st of every month");
    expect(describe({ freq: "monthly", month_day: -1 })).toBe("Last day of every month");
    expect(describe({ freq: "monthly", nth: -1, weekday: 1 })).toBe("Last Monday of every month");
    expect(describe({ freq: "monthly", month_day: 15, months: [2, 9] })).toBe("15th of February and September");
    expect(describe({ freq: "monthly", month_day: 15, months: [1, 4, 7, 10] })).toBe("15th of January, April, July and October");
  });

  it("know the next date", () => {
    expect(nextDue({ freq: "weekly", weekday: 1 }, "2026-11-09")).toBe("2026-11-09");                 // a Monday
    expect(nextDue({ freq: "monthly", nth: -1, weekday: 1 }, "2026-11-09")).toBe("2026-11-30");
    expect(nextDue({ freq: "monthly", month_day: 15, months: [2, 9] }, "2026-11-09")).toBe("2027-02-15");
    expect(nextDue({ freq: "biweekly", weekday: 4, anchor: "2026-01-01" }, "2026-11-09")).toBe("2026-11-19");
  });

  it("from the template go to the right department", () => {
    const deps = [
      { id: "ogv", name: "Outgoing Global Volunteer", products: ["ogv"] },
      { id: "fin", name: "Finance & Legality", products: [] },
      { id: "tm", name: "Talent Management", products: [] },
      { id: "mkt", name: "Marketing", products: [] },
      { id: "igt", name: "Incoming Global Talent/Teacher", products: ["igta", "igte"] },
    ];
    expect(departmentForArea("ogv", deps)).toBe("ogv");
    expect(departmentForArea("fin", deps)).toBe("fin");
    expect(departmentForArea("mxp", deps)).toBe("tm");
    expect(departmentForArea("mkt", deps)).toBe("mkt");
    expect(departmentForArea("igta", deps)).toBe("igt");
    expect(departmentForArea("lcp", deps)).toBeNull();
    expect(new Set(ROUTINE_TEMPLATES.map((t) => t.key)).size).toBe(ROUTINE_TEMPLATES.length);
  });
});
