import type { SupabaseClient } from "@supabase/supabase-js";

export interface Membership {
  userId: string;
  projectId: string;
  role: string;
  labRoleId: string | null;
  permissionLevel: string | null;
}

/**
 * Load all team_members rows for userId, joined with lab_roles.permission_level.
 * Returns [] (not an error) when the user has no memberships.
 * Logs and returns [] on query error so callers can treat it as "no access".
 */
export async function getMemberships(
  db: SupabaseClient,
  userId: string,
): Promise<Membership[]> {
  const { data, error } = await db
    .from("team_members")
    .select("user_id, project_id, role, lab_role_id, lab_roles(permission_level)")
    .eq("user_id", userId);

  if (error) {
    console.error("[membership] getMemberships error:", error.message, "userId:", userId);
    return [];
  }

  return (data ?? []).map((row) => {
    const labRole = Array.isArray(row.lab_roles) ? row.lab_roles[0] : row.lab_roles;
    return {
      userId: row.user_id as string,
      projectId: row.project_id as string,
      role: (row.role as string) ?? "",
      labRoleId: (row.lab_role_id as string | null) ?? null,
      permissionLevel: (labRole as { permission_level?: string } | null)?.permission_level ?? null,
    };
  });
}

/**
 * Returns true when userId holds PI-level access to projectId.
 * PI-level means team_members.role = 'pi' OR the linked lab_role.permission_level = 'pi'.
 */
export async function isPiOf(
  db: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const memberships = await getMemberships(db, userId);
  const row = memberships.find((m) => m.projectId === projectId);
  if (!row) return false;
  return row.role === "pi" || row.permissionLevel === "pi";
}
