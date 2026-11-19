import { describe, it, expect } from "vitest";
import { profileFromExpa } from "@/lib/expa-sync";
import { departmentFromFunction, destinationAfterJoin, placementFromExpa } from "@/lib/expa-profile";

type Pos = { role?: string; fn?: string; office?: { id: number; name: string; tag: string } };
const person = (positions: Pos[]) => profileFromExpa({
  home_lc: { id: 1500, name: "Cairo University" }, home_mc: { name: "Egypt" },
  current_positions: positions.map((p) => ({
    role: p.role ? { name: p.role } : null, function: p.fn ? { name: p.fn } : null, office: p.office ?? null,
  })),
});
const LC = { id: 1500, name: "Cairo University", tag: "LC" };
const MC = { id: 1609, name: "Egypt", tag: "MC" };

describe("where EXPA sign-in puts someone", () => {
  it("an LCVP goes to their LC as a VP, in the department of their function", () => {
    expect(placementFromExpa(person([{ role: "LCVP", fn: "Outgoing Global Volunteer", office: LC }]))).toEqual({
      kind: "lc", expaId: "1500", name: "Cairo University", country: "EG", role: "vp", department: "ogv",
    });
  });

  it("an LCP is the president; a team member is a member", () => {
    expect(placementFromExpa(person([{ role: "LCP", office: LC }]))?.role).toBe("president");
    expect(placementFromExpa(person([{ role: "Local Committee President", office: LC }]))?.role).toBe("president");
    expect(placementFromExpa(person([{ role: "Team Member", fn: "Marketing", office: LC }]))).toMatchObject({ role: "member", department: "mkt" });
  });

  it("an MC position wins over an LC one; the MCP is the MCP", () => {
    expect(placementFromExpa(person([{ role: "Team Leader", office: LC }, { role: "MCVP", fn: "Finance", office: MC }]))).toEqual({
      kind: "mc", expaId: "1609", name: "Egypt", country: "EG", role: "vp_finance", department: "fin",
    });
    expect(placementFromExpa(person([{ role: "MCP", office: MC }]))?.role).toBe("mcp");
  });

  it("their highest LC position counts", () => {
    expect(placementFromExpa(person([{ role: "Team Member", office: LC }, { role: "LCVP", fn: "Talent Management", office: LC }])))
      .toMatchObject({ role: "vp", department: "tm" });
  });

  it("without the office (GIS refused that part) it falls back to their home LC, or the MC by role", () => {
    expect(placementFromExpa(person([{ role: "LCVP", fn: "Business Development" }]))).toMatchObject({ kind: "lc", expaId: "1500", role: "vp", department: "bd" });
    expect(placementFromExpa(person([{ role: "MCP" }]))).toMatchObject({ kind: "mc", expaId: null, country: "EG", role: "mcp" });
  });

  it("nobody is placed without a position (exchange participants have a home LC too), or by a regional one", () => {
    expect(placementFromExpa(person([]))).toBeNull();
    expect(placementFromExpa(person([{ role: "Regional Director", office: { id: 9, name: "Africa", tag: "REGION" } }]))).toBeNull();
  });

  it("reads functions however EXPA words them", () => {
    expect(departmentFromFunction("oGTa")).toBe("ogt");
    expect(departmentFromFunction("Incoming Global Teacher")).toBe("igt");
    expect(departmentFromFunction("iGV")).toBe("igv");
    expect(departmentFromFunction("F&L")).toBe("fin");
    expect(departmentFromFunction("Finance & Legality")).toBe("fin");
    expect(departmentFromFunction("Partnerships")).toBe("bd");
    expect(departmentFromFunction("oGX")).toBeNull();
    expect(departmentFromFunction(null)).toBeNull();
  });

  it("opens the LC or MC they joined; otherwise the usual destination", () => {
    expect(destinationAfterJoin({ status: "joined", kind: "lc", id: "x" })).toBe("/");
    expect(destinationAfterJoin({ status: "already", kind: "mc", id: "x" })).toBe("/mc");
    expect(destinationAfterJoin({ status: "create_mc", kind: "mc" })).toBe("/mc");
    expect(destinationAfterJoin({ status: "create_lc", kind: "lc" })).toBeNull();
    expect(destinationAfterJoin({ status: "lc_missing", kind: "lc" })).toBeNull();
    expect(destinationAfterJoin(null)).toBeNull();
  });
});

it('EXPA assigns the finance role only to a finance vice president, and keeps other MC functions distinct', () => {
  expect(placementFromExpa(person([{ role: 'MCVP', fn: 'Marketing', office: MC }]))).toMatchObject({ kind: 'mc', role: 'member', department: 'mkt' });
  expect(placementFromExpa(person([{ role: 'MCVP', fn: 'Outgoing Global Volunteer', office: MC }]))).toMatchObject({ kind: 'mc', role: 'member', department: 'ogv' });
  expect(placementFromExpa(person([{ role: 'Member', fn: 'Finance', office: MC }]))).toMatchObject({ kind: 'mc', role: 'member', department: 'fin' });
  expect(placementFromExpa(person([{ role: 'MCVP Finance', office: MC }]))).toMatchObject({ kind: 'mc', role: 'vp_finance', department: 'fin' });
});
