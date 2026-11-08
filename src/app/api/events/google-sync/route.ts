import { requireAuth } from "@/lib/api-auth";
import { serviceClient } from "@/lib/server-db";
import { syncEventToGoogle } from "@/lib/google-sync";

export const maxDuration = 60;

// POST /api/events/google-sync { eventId }: after an event is saved, deleted or
// answered, bring it in line in everyone's Google Calendar. It only mirrors
// what's in the database, so any member of the event's LC may ask (and anyone
// who had it, after it was deleted).
export async function POST(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server" }, { status: 503 });
  const { eventId } = await request.json().catch(() => ({}));
  if (typeof eventId !== "string" || !/^[0-9a-f-]{36}$/i.test(eventId)) return Response.json({ error: "eventId required" }, { status: 400 });

  const { data: ev } = await db.from("lc_events").select("project_id").eq("id", eventId).maybeSingle();
  if (ev) {
    const { data: member } = await db.from("team_members").select("user_id").eq("project_id", ev.project_id).eq("user_id", userId).maybeSingle();
    if (!member) return Response.json({ error: "Not your LC's event" }, { status: 403 });
  }
  try {
    return Response.json(await syncEventToGoogle(db, eventId));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
