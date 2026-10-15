import type { SupabaseClient } from "@supabase/supabase-js";
import { toUserRole } from "@/lib/permissions";
import type { UserRole } from "@/types";

export interface Membership {
  userId: string;
  projectId: string;
  /** Permission level in this LC (team_members.role, kept in sync with lab_roles by a trigger). */
  role: UserRole;
  labRoleId: string | null;
  departmentId: string | null;
}

/**
 * Load all team_members rows (one per LC) for userId.
 * Returns [] (not an error) when the user has no memberships.
 * Logs and returns [] on query error so callers can treat it as "no access".
 */
export async function getMemberships(
  db: SupabaseClient,
  userId: string,
): Promise<Membership[]> {
  const { data, error } = await db
    .from("team_members")
    .select("user_id, project_id, role, lab_role_id, department_id")
    .eq("user_id", userId);

  if (error) {
    console.error("[membership] getMemberships error:", error.message, "userId:", userId);
    return [];
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id as string,
    projectId: row.project_id as string,
    role: toUserRole(row.role),
    labRoleId: (row.lab_role_id as string | null) ?? null,
    departmentId: (row.department_id as string | null) ?? null,
  }));
}

/** Returns true when userId is the president (LCP) of the given LC. */
export async function isPresidentOf(
  db: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const memberships = await getMemberships(db, userId);
  return memberships.some((m) => m.projectId === projectId && m.role === "president");
}
