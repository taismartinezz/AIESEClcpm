import { requireAuth } from "@/lib/api-auth";
import { serviceClient } from "@/lib/server-db";
import { accessTokenFor } from "@/lib/google-server";

// GET /api/google/calendar?timeMin=ISO&timeMax=ISO: the caller's own primary
// Google Calendar events (read-only), for their own Scheduling view.
export async function GET(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server" }, { status: 503 });

  const url = new URL(request.url);
  const timeMin = url.searchParams.get("timeMin") ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const timeMax = url.searchParams.get("timeMax") ?? new Date(Date.now() + 90 * 86_400_000).toISOString();

  const tok = await accessTokenFor(db, userId);
  if ("reconnect" in tok) return Response.json({ error: tok.reconnect, reconnect: true }, { status: 401 });

  const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${tok.token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) return Response.json({ error: "Google refused access. Connect again.", reconnect: true }, { status: 401 });
  if (!res.ok) return Response.json({ error: `Google Calendar answered ${res.status}` }, { status: 502 });
  const body = await res.json() as { items?: { id: string; summary?: string; status?: string; htmlLink?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[] };
  const events = (body.items ?? [])
    .filter((e) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date))
    .map((e) => ({
      id: e.id, title: e.summary || "(busy)", allDay: !e.start?.dateTime,
      start: (e.start?.dateTime ?? e.start?.date)!, end: e.end?.dateTime ?? e.end?.date ?? null, link: e.htmlLink ?? null,
    }));
  return Response.json({ events });
}
