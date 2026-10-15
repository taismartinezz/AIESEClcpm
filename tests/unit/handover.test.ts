import { describe, it, expect } from "vitest";
import { termLabel, termOptions, mapHandoverNote } from "@/lib/handover";

describe("handover helpers", () => {
  it("labels a term by its start year", () => {
    expect(termLabel("2026-02-01")).toBe("2026/27");
    expect(termLabel("2099-08-01")).toBe("2099/00");
  });

  it("lists terms newest first, always with the current one", () => {
    expect(termOptions("2026/27", ["2024/25", "2025/26", "2025/26"])).toEqual(["2026/27", "2025/26", "2024/25"]);
    expect(termOptions("2026/27", [])).toEqual(["2026/27"]);
  });

  it("maps a row", () => {
    expect(mapHandoverNote({ id: "1", department_id: null, term_label: "2026/27", title: "LCP", body: null, updated_by: null, updated_at: "x" }))
      .toEqual({ id: "1", departmentId: null, termLabel: "2026/27", title: "LCP", body: "", updatedBy: null, updatedAt: "x" });
  });
});
