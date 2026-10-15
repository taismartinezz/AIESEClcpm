import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Where to send a user right after they sign in: the dashboard if they
 * already belong to an LC or have a profile, otherwise onboarding.
 * Shared by /auth/callback (OAuth redirect flow) and /login (email sign-in).
 */
export async function getPostAuthDestination(userId: string): Promise<string> {
  if (!isSupabaseConfigured) return "/";
  const { data: member } = await supabase
    .from("team_members").select("id").eq("user_id", userId).limit(1).maybeSingle();
  if (member) return "/";
  const { data: profile } = await supabase
    .from("user_profiles").select("id").eq("id", userId).maybeSingle();
  return profile ? "/" : "/onboarding";
}
