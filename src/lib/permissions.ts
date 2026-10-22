import type { Department, UserRole } from "@/types";

// Client-side mirrors of the SQL helpers in supabase/migrations (lc_role,
// is_lc_president, is_lc_exec, led_department_ids). The database enforces every
// rule; these only decide what the UI offers.

export const ROLE_LABELS: Record<UserRole, string> = {
  president: "President",
  vp: "VP",
  member: "Member",
};

/** Long form used in profile/settings copy. */
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  president: "Local Committee President (LCP)",
  vp: "Vice President (Executive Board)",
  member: "Member",
};

const LEGACY_ROLES: Record<string, UserRole> = { pi: "president", researcher: "member" };

/** Normalise a role read from the database (tolerates pre-migration values). */
export function toUserRole(value: unknown): UserRole {
  if (value === "president" || value === "vp" || value === "member") return value;
  if (typeof value === "string" && value in LEGACY_ROLES) return LEGACY_ROLES[value];
  return "member";
}

export function isPresident(role: UserRole | null | undefined): boolean {
  return role === "president";
}

/** President or VP: the executive board. */
export function isExec(role: UserRole | null | undefined): boolean {
  return role === "president" || role === "vp";
}

/** Departments this user leads (only VPs lead departments). */
export function ledDepartmentIds(
  role: UserRole | null | undefined,
  userId: string | null | undefined,
  departments: Pick<Department, "id" | "vpUserId">[],
): string[] {
  if (role !== "vp" || !userId) return [];
  return departments.filter((d) => d.vpUserId === userId).map((d) => d.id);
}

/**
 * In charge of finance: the president, or a VP who leads a department flagged
 * as the finance department (Finance & Legality by default). Mirrors the SQL
 * function is_finance_lead(): keep the two in step.
 */
export function isFinanceLead(
  role: UserRole | null | undefined,
  userId: string | null | undefined,
  departments: Pick<Department, "vpUserId" | "isFinance">[],
): boolean {
  if (role === "president") return true;
  if (role !== "vp" || !userId) return false;
  return departments.some((d) => d.isFinance && d.vpUserId === userId);
}
