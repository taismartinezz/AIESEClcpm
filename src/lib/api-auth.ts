import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * Verify the Bearer JWT in the Authorization header and return the authenticated userId.
 * Returns null when the token is missing, invalid, or Supabase is not configured.
 *
 * Usage in a route handler:
 *   const userId = await requireAuth(request);
 *   if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
 */
export async function requireAuth(request: Request): Promise<string | null> {
  if (!supabaseUrl || !anonKey) return null;

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  const client = createClient(supabaseUrl, anonKey);
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}
