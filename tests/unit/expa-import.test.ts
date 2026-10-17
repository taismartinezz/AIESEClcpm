import { describe, it, expect } from "vitest";
import { buildImport, guessMapping, parseCsv, statusToStage, toIsoDate } from "@/lib/expa-import";

const CSV = `﻿Application ID,Full Name,Email,Status,Opportunity Title,Host LC,Date Applied,Date Approved,Date Realized
1001,"Silva, Ana",ana@example.com,Approved,"Teach English, Bogotá",AIESEC in Bogotá,2026-02-10T09:00:00Z,2026-03-01,
1002,Ben K.,ben@example.com,Realized,Climate camp,AIESEC in Nairobi,2026-02-12,2026-02-20,2026-06-01
1003,Cara L.,cara@example.com,Rejected,Climate camp,AIESEC in Nairobi,2026-02-15,,
,,,,,,,,
`;

describe("EXPA import", () => {
  it("parses quoted cells, commas inside quotes, BOM and blank lines", () => {
    const rows = parseCsv(CSV);
    expect(rows).toHaveLength(4);
    expect(rows[1][1]).toBe("Silva, Ana");
    expect(rows[1][4]).toBe("Teach English, Bogotá");
  });

  it("reads semicolon-separated files", () => {
    expect(parseCsv("Name;Status\nAna;Applied\n")).toEqual([["Name", "Status"], ["Ana", "Applied"]]);
  });

  it("guesses the columns by name", () => {
    const m = guessMapping(parseCsv(CSV)[0]);
    expect(m.expa_id).toBe(0);
    expect(m.person_name).toBe(1);
    expect(m.status).toBe(3);
    expect(m.host_entity).toBe(5);
    expect(m.applied_at).toBe(6);
    expect(m.approved_at).toBe(7);
    expect(m.realized_at).toBe(8);
    expect(m.accepted_at).toBe(-1);
  });

  it("maps EXPA statuses to stages and drops rejected ones", () => {
    expect(statusToStage("Approved")).toBe("approved");
    expect(statusToStage("matched")).toBe("accepted");
    expect(statusToStage("Approval broken")).toBeNull();
    expect(statusToStage("Withdrawn")).toBeNull();
    expect(statusToStage("")).toBeUndefined();
  });

  it("reads ISO timestamps and day-first dates", () => {
    expect(toIsoDate("2026-02-10T09:00:00Z")).toBe("2026-02-10");
    expect(toIsoDate("03/04/2026")).toBe("2026-04-03");
    expect(toIsoDate("12/25/2026")).toBe("2026-12-25");
    expect(toIsoDate("soon")).toBeNull();
  });

  it("builds the rows to import", () => {
    const [header, ...data] = parseCsv(CSV);
    const plan = buildImport(data, guessMapping(header));
    expect(plan.skipped).toBe(1);
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]).toMatchObject({ expa_id: "1001", person_name: "Silva, Ana", stage: "approved", applied_at: "2026-02-10", approved_at: "2026-03-01" });
    expect(plan.rows[1].stage).toBe("realized");
  });

  it("derives the stage from the latest date when there is no status column", () => {
    const plan = buildImport([["Ana", "2026-02-10", "2026-03-01"]], { ...guessMapping(["Name", "Date Applied", "Date Approved"]) });
    expect(plan.rows[0].stage).toBe("approved");
  });
});
