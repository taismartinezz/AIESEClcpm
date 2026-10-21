import { requireAuth } from "@/lib/api-auth";
import { isExecOf, serviceClient } from "@/lib/server-db";
import { sendAnnouncement } from "@/lib/notify-server";

export const maxDuration = 300;

// POST /api/announcements/send { announcementId }: email an announcement the
// caller wrote to its audience. Replies go to the author.
export async function POST(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db) return Response.json({ error: "Email isn't set up on this server (SUPABASE_SERVICE_ROLE_KEY missing)." }, { status: 503 });
  const { announcementId } = await request.json().catch(() => ({}));
  if (typeof announcementId !== "string") return Response.json({ error: "announcementId required" }, { status: 400 });
  const { data: a } = await db.from("announcements").select("project_id, author_id, sent_at").eq("id", announcementId).maybeSingle();
  if (!a || a.author_id !== userId || !(await isExecOf(db, a.project_id as string, userId))) return Response.json({ error: "Not your announcement" }, { status: 403 });
  if (a.sent_at) return Response.json({ error: "Already sent" }, { status: 409 });
  try {
    return Response.json(await sendAnnouncement(db, announcementId));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
