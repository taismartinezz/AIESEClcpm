import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Where to send a user right after they sign in: the lab dashboard if they
 * already belong to a team or have a profile, otherwise onboarding.
 * Shared by /auth/callback (redirect flow) and /login (Google ID-token flow).
 */
export async function getPostAuthDestination(userId: string): Promise<string> {
  if (!isSupabaseConfigured) return "/";
  const { data: member } = await supabase
    .from("team_members").select("id").eq("user_id", userId).maybeSingle();
  if (member) return "/";
  const { data: profile } = await supabase
    .from("user_profiles").select("id").eq("id", userId).maybeSingle();
  return profile ? "/" : "/onboarding";
}
