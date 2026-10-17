import { describe, it, expect } from "vitest";
import { IMPORT_TARGETS, type ImportContext } from "@/lib/importers";
import { googleSheetCsvUrl, guessColumns, matchByName, parseCsv } from "@/lib/sheet-import";
import type { Department } from "@/types";

const dep = (id: string, name: string) => ({ id, name, products: [] } as unknown as Department);
const ctx: ImportContext = {
  departments: [dep("d-bd", "Business Development"), dep("d-ogv", "Outgoing Global Volunteer"), dep("d-mkt", "Marketing")],
  roster: [{ id: "u1", name: "Tais Martinez" }, { id: "u2", name: "Kwame Mensah" }, { id: "u3", name: "Kwabena Owusu" }],
  defaultDepartmentId: "d-bd",
  product: "ogv",
};

function run(target: keyof typeof IMPORT_TARGETS, csv: string) {
  const t = IMPORT_TARGETS[target];
  const [header, ...data] = parseCsv(csv);
  return t.build(data, guessColumns(header, t.fields), ctx);
}

describe("Google Sheets links", () => {
  it("turn into the CSV export of the same tab", () => {
    expect(googleSheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=123"))
      .toBe("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/export?format=csv&gid=123");
    expect(googleSheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit?usp=sharing"))
      .toMatch(/gid=0$/);
  });
  it("reject anything else", () => {
    expect(googleSheetCsvUrl("https://evil.example/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBeNull();
    expect(googleSheetCsvUrl("http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBeNull();
    expect(googleSheetCsvUrl("not a url")).toBeNull();
  });
});

describe("name matching", () => {
  it("matches exact names, unique first names and department initials, not ambiguous ones", () => {
    expect(matchByName("tais", ctx.roster, (p) => [p.name, p.name.split(" ")[0]])?.id).toBe("u1");
    expect(matchByName("Kw", ctx.roster, (p) => [p.name])).toBeNull();
    expect(matchByName("oGV", ctx.departments, (d) => [d.name, d.name.split(" ").map((w) => w[0]).join("")])?.id).toBe("d-ogv");
  });
});

describe("tracker targets", () => {
  it("partners: stage words, website and department", () => {
    const r = run("partners", "Company,Status,Website,Dept,Contact,Email\nDemo Bank,Meeting scheduled,demo-bank.example,BD,Rita,rita@x.example\nShop,Closed won,,Marketing,,\n,Lead,,,,\n");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ name: "Demo Bank", stage: "meeting", website: "https://demo-bank.example", department_id: "d-bd", contact_name: "Rita" });
    expect(r.rows[1]).toMatchObject({ stage: "partner", department_id: "d-mkt" });
    expect(r.leftOut).toEqual([{ count: 1, reason: "without an organisation name" }]);
  });

  it("recruits: a Google Form export", () => {
    const r = run("recruits", "Timestamp,First name,Last name,Email address,Area of interest,How did you hear about us?\n15/10/2026 10:00:00,Ana,Silva,ana@x.example,Marketing,Tabling\n");
    expect(r.rows[0]).toMatchObject({ name: "Ana Silva", email: "ana@x.example", department_id: "d-mkt", source: "Tabling", applied_on: "2026-10-15", stage: "applied" });
  });

  it("tasks: statuses, priorities, assignees by first name, unknown people reported", () => {
    const r = run("tasks", "Task,Status,Priority,Deadline,Responsible\nPrint posters,In progress,High,2026-11-01,Tais & Kwame\nBook room,Done,,,Someone Else\n");
    expect(r.rows[0]).toMatchObject({ title: "Print posters", status: "in_progress", priority: "high", due_date: "2026-11-01", assignee_ids: ["u1", "u2"] });
    expect(r.rows[1]).toMatchObject({ status: "done", priority: "medium", assignee_ids: [] });
    expect(r.unmatched).toEqual(['person "Someone Else"']);
  });
});
