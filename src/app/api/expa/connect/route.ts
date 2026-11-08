import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/api-auth";
import { serviceClient } from "@/lib/server-db";
import { authorizeUrl, expaCredentials, EXPA_CALLBACK_PATH, EXPA_STATE_COOKIE } from "@/lib/expa-server";

// POST /api/expa/connect: start connecting the caller's EXPA account. Returns
// the auth.aiesec.org URL to send the browser to. The random state is kept
// both in the database (who started it) and in a cookie (which browser), and
// the callback checks both.
export async function POST(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const creds = expaCredentials();
  if (!creds) return Response.json({ error: "EXPA isn't set up on this server (AIESEC_CLIENT_ID / AIESEC_CLIENT_SECRET missing)." }, { status: 503 });
  const db = serviceClient();
  if (!db) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server" }, { status: 503 });

  const state = randomBytes(32).toString("hex");
  await db.from("expa_oauth_states").delete().lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
  const { error } = await db.from("expa_oauth_states").insert({ state, user_id: userId });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const origin = new URL(request.url).origin;
  (await cookies()).set(EXPA_STATE_COOKIE, state, {
    httpOnly: true, secure: origin.startsWith("https://"), sameSite: "lax", path: EXPA_CALLBACK_PATH, maxAge: 600,
  });
  return Response.json({ url: authorizeUrl(creds.clientId, origin, state) });
}
