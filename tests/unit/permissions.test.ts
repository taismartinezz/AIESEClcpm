import { describe, it, expect } from "vitest";
import { isExec, isPresident, ledDepartmentIds, toUserRole } from "@/lib/permissions";
import { groupDirectory } from "@/lib/team";
import type { Department, TeamMember } from "@/types";

const dep = (id: string, name: string, vpUserId: string | null = null): Department => ({
  id, projectId: "lc", name, color: "#037EF3", vpUserId, isFinance: false, sortOrder: 0,
});
const person = (id: string, role: TeamMember["role"], departmentId: string | null = null): TeamMember => ({
  id, name: id, email: "", role, avatarColor: "#fff", avatarInitials: "XX", departmentId,
  taskCounts: { todo: 0, in_progress: 0, in_review: 0, done: 0 },
});

describe("permissions", () => {
  it("maps legacy and unknown roles safely", () => {
    expect(toUserRole("pi")).toBe("president");
    expect(toUserRole("researcher")).toBe("member");
    expect(toUserRole("vp")).toBe("vp");
    expect(toUserRole(undefined)).toBe("member");
  });

  it("treats president and VP as the executive board", () => {
    expect(isExec("president")).toBe(true);
    expect(isExec("vp")).toBe(true);
    expect(isExec("member")).toBe(false);
    expect(isPresident("vp")).toBe(false);
  });

  it("returns the departments a VP leads, and none for other roles", () => {
    const deps = [dep("d1", "oGV", "vera"), dep("d2", "MKT", "vera"), dep("d3", "TM", "tom")];
    expect(ledDepartmentIds("vp", "vera", deps)).toEqual(["d1", "d2"]);
    expect(ledDepartmentIds("president", "vera", deps)).toEqual([]);
    expect(ledDepartmentIds("member", "vera", deps)).toEqual([]);
  });
});

describe("groupDirectory", () => {
  const deps = [dep("d1", "oGV"), dep("d2", "Marketing")];

  it("puts the president first in the Executive Board, then one section per department", () => {
    const sections = groupDirectory([
      person("mo", "member", "d2"), person("vera", "vp", "d1"), person("pat", "president"),
      person("ann", "member", "d1"), person("new", "member"),
    ], deps, false);
    expect(sections.map((s) => s.title)).toEqual(["Executive Board", "oGV", "Marketing", "No department yet"]);
    expect(sections[0].members.map((m) => m.id)).toEqual(["pat", "vera"]);
  });

  it("stays flat inside a group view", () => {
    const sections = groupDirectory([person("a", "vp"), person("b", "member")], deps, true);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBeNull();
  });
});
