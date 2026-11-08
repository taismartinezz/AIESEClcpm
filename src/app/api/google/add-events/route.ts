import { requireAuth } from "@/lib/api-auth";
import { serviceClient } from "@/lib/server-db";
import { syncEventToGoogle, syncUpcomingForUser } from "@/lib/google-sync";

export const maxDuration = 120;

// POST /api/google/add-events { on }: the caller's "Add LC events to my Google
// Calendar" switch. On adds their upcoming events now; off removes the ones
// the app added (also used just before disconnecting Google).
export async function POST(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server" }, { status: 503 });
  const { on } = await request.json().catch(() => ({}));
  if (typeof on !== "boolean") return Response.json({ error: "on (true/false) required" }, { status: 400 });

  const { error } = await db.from("google_connections").update({ add_events: on, updated_at: new Date().toISOString() }).eq("user_id", userId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (on) return Response.json(await syncUpcomingForUser(db, userId));

  // Off: each event's sync now leaves this person out, so it's removed from their calendar.
  const { data: links } = await db.from("google_event_links").select("event_id").eq("user_id", userId);
  const summary = { added: 0, updated: 0, removed: 0, failed: 0, errors: [] as string[] };
  for (const l of links ?? []) {
    const s = await syncEventToGoogle(db, l.event_id as string, userId);
    summary.removed += s.removed; summary.failed += s.failed; summary.errors.push(...s.errors);
  }
  return Response.json(summary);
}
