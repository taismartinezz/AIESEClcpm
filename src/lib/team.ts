import type { Department, TeamMember } from "@/types";

// ── Directory grouping ────────────────────────────────────────────────────────

interface DirectorySection { key: string; title: string | null; color?: string; members: TeamMember[] }

/**
 * Group the LC directory: Executive Board (president first, then VPs), then one
 * section per department, then anyone without a department. Inside a group
 * (sub-project) view the list stays flat.
 */
export function groupDirectory(members: TeamMember[], departments: Department[], flat: boolean): DirectorySection[] {
  if (flat) return members.length ? [{ key: "all", title: null, members }] : [];
  const byName = (a: TeamMember, b: TeamMember) => a.name.localeCompare(b.name);
  const exec = members
    .filter((m) => m.role !== "member")
    .sort((a, b) => (a.role === "president" ? -1 : b.role === "president" ? 1 : byName(a, b)));
  const sections: DirectorySection[] = [];
  if (exec.length) sections.push({ key: "exec", title: "Executive Board", members: exec });
  for (const d of departments) {
    const inDept = members.filter((m) => m.role === "member" && m.departmentId === d.id).sort(byName);
    if (inDept.length) sections.push({ key: d.id, title: d.name, color: d.color, members: inDept });
  }
  const known = new Set(departments.map((d) => d.id));
  const unassigned = members
    .filter((m) => m.role === "member" && (!m.departmentId || !known.has(m.departmentId)))
    .sort(byName);
  if (unassigned.length) sections.push({ key: "none", title: "No department yet", members: unassigned });
  return sections;
}
