import { requireAuth } from "@/lib/api-auth";
import { serviceClient } from "@/lib/server-db";
import { tokenInfo } from "@/lib/google-server";

// POST /api/google/connect { accessToken, refreshToken } — store the caller's
// Google Calendar tokens (checked with Google first) where only the server can
// read them.
export async function POST(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server" }, { status: 503 });
  const { accessToken, refreshToken } = await request.json().catch(() => ({}));
  if (typeof accessToken !== "string" || !accessToken) return Response.json({ error: "accessToken required" }, { status: 400 });

  const info = await tokenInfo(accessToken).catch(() => null);
  if (!info) return Response.json({ error: "Google didn't recognise that token" }, { status: 400 });
  if (!info.scope.includes("calendar")) return Response.json({ error: "Calendar permission wasn't granted" }, { status: 400 });

  const now = new Date();
  const { error } = await db.from("google_connections").upsert({
    user_id: userId, google_email: info.email, access_token: accessToken,
    refresh_token: typeof refreshToken === "string" && refreshToken ? refreshToken : null,
    expires_at: new Date(now.getTime() + info.expiresIn * 1000).toISOString(), scope: info.scope,
    connected_at: now.toISOString(), updated_at: now.toISOString(),
  }, { onConflict: "user_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, email: info.email });
}
