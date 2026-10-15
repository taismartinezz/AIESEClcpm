import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/api-auth";

// GET /api/google/calendar?userId=<uid>&timeMin=<ISO>&timeMax=<ISO>
//
// Fetches events from the user's primary Google Calendar using their stored
// access token. If the token is expired and a refresh token exists, refreshes
// it automatically and persists the new token.
//
// Returns: { events: GoogleCalendarEvent[] }

interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  htmlLink: string;
  attendees?: { email: string; displayName?: string; responseStatus: string }[];
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const clientId    = process.env.GOOGLE_CLIENT_ID ?? "";
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function GET(request: Request) {
  // Verify caller identity from JWT — never trust userId from query params
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const timeMin = searchParams.get("timeMin") ?? new Date().toISOString();
  const timeMax = searchParams.get("timeMax") ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  if (!supabaseUrl || !serviceKey) return Response.json({ error: "Server not configured" }, { status: 500 });

  const db = createClient(supabaseUrl, serviceKey);

  const { data: profile } = await db
    .from("user_profiles")
    .select("google_access_token, google_refresh_token, google_token_expiry")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.google_access_token) {
    return Response.json({ error: "Google account not connected", reconnect: true }, { status: 401 });
  }

  let accessToken = profile.google_access_token as string;

  // Refresh if expired (with 60s buffer)
  const expiry = profile.google_token_expiry ? new Date(profile.google_token_expiry as string).getTime() : 0;
  if (expiry && Date.now() > expiry - 60_000 && profile.google_refresh_token) {
    const refreshed = await refreshAccessToken(profile.google_refresh_token as string);
    if (refreshed) {
      accessToken = refreshed.access_token;
      const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      await db.from("user_profiles").update({
        google_access_token: accessToken,
        google_token_expiry: newExpiry,
      }).eq("id", userId);
    }
  }

  const calRes = await fetch(
    `${CALENDAR_API}/calendars/primary/events?` + new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
    }),
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!calRes.ok) {
    const body = await calRes.text().catch(() => "");
    if (calRes.status === 401) {
      return Response.json({ error: "Token expired", reconnect: true }, { status: 401 });
    }
    return Response.json({ error: `Calendar API error ${calRes.status}: ${body}` }, { status: 502 });
  }

  const data = await calRes.json() as { items: GoogleCalendarEvent[] };
  return Response.json({ events: data.items ?? [] });
}
