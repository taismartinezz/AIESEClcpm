import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/** Is the signed-in user an app moderator? False before the helper migration runs. */
export async function isAppModerator(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { data, error } = await supabase.rpc("is_app_moderator");
  return !error && data === true;
}

/**
 * Where to send a user right after they sign in: moderators to /moderation
 * (they need no LC, MC or EXPA), everyone else to the dashboard if they
 * already belong to an LC or have a profile, otherwise onboarding.
 * Shared by /auth/callback (OAuth redirect flow) and /login (email sign-in).
 */
export async function getPostAuthDestination(userId: string): Promise<string> {
  if (!isSupabaseConfigured) return "/";
  if (await isAppModerator()) return "/moderation";
  const { data: member } = await supabase
    .from("team_members").select("id").eq("user_id", userId).limit(1).maybeSingle();
  if (member) return "/";
  const { data: profile } = await supabase
    .from("user_profiles").select("id").eq("id", userId).maybeSingle();
  return profile ? "/" : "/onboarding";
}
