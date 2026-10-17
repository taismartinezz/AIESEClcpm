// Server-side only. Service-role Supabase client for API routes and cron jobs.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Is the user the president or a VP of the LC? */
export async function isExecOf(db: SupabaseClient, projectId: string, userId: string): Promise<boolean> {
  const { data } = await db.from("team_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
  return data?.role === "president" || data?.role === "vp";
}

/** Shared check for cron routes: Authorization: Bearer <CRON_SECRET>, failing closed. */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  return Boolean(secret) && request.headers.get("Authorization") === `Bearer ${secret}`;
}
