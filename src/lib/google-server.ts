// Server-side only. Google OAuth token handling for the Calendar connection.

import type { SupabaseClient } from "@supabase/supabase-js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKENINFO_URL = "https://www.googleapis.com/oauth2/v3/tokeninfo";

/** Ask Google what a token is for; null if it isn't a valid Google token. */
export async function tokenInfo(accessToken: string): Promise<{ scope: string; email: string | null; expiresIn: number } | null> {
  const res = await fetch(`${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const j = await res.json() as { scope?: string; email?: string; expires_in?: string };
  return { scope: j.scope ?? "", email: j.email ?? null, expiresIn: Number(j.expires_in ?? 3600) };
}

/** A usable access token for the user, refreshing it when GOOGLE_CLIENT_ID / _SECRET are set. */
export async function accessTokenFor(db: SupabaseClient, userId: string): Promise<{ token: string } | { reconnect: string }> {
  const { data } = await db.from("google_connections").select("access_token, refresh_token, expires_at").eq("user_id", userId).maybeSingle();
  if (!data) return { reconnect: "Google Calendar isn't connected." };
  const expires = data.expires_at ? new Date(data.expires_at as string).getTime() : 0;
  if (!expires || Date.now() < expires - 60_000) return { token: data.access_token as string };

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  if (!data.refresh_token || !clientId || !clientSecret) return { reconnect: "The Google connection expired. Connect again." };
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: data.refresh_token as string, grant_type: "refresh_token" }),
  });
  if (!res.ok) return { reconnect: "Google didn't renew the connection. Connect again." };
  const j = await res.json() as { access_token: string; expires_in: number };
  await db.from("google_connections").update({
    access_token: j.access_token, expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString(), updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return { token: j.access_token };
}
