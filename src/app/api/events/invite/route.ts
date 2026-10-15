import { requireAuth } from "@/lib/api-auth";
import { isExecOf, serviceClient } from "@/lib/server-db";
import { sendEventInvites } from "@/lib/notify-server";

export const maxDuration = 300;

// POST /api/events/invite { eventId } — email the event's audience an invite
// with RSVP buttons and a calendar file. President or VP of the event's LC.
export async function POST(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db) return Response.json({ error: "Email isn't set up on this server (SUPABASE_SERVICE_ROLE_KEY missing)." }, { status: 503 });
  const { eventId } = await request.json().catch(() => ({}));
  if (typeof eventId !== "string") return Response.json({ error: "eventId required" }, { status: 400 });
  const { data: ev } = await db.from("lc_events").select("project_id").eq("id", eventId).maybeSingle();
  if (!ev || !(await isExecOf(db, ev.project_id as string, userId))) return Response.json({ error: "Only the president or a VP can send invites" }, { status: 403 });
  try {
    return Response.json(await sendEventInvites(db, eventId));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
