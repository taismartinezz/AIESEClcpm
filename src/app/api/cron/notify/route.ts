import { cronAuthorized, serviceClient } from "@/lib/server-db";
import { runScheduledEmails } from "@/lib/notify-server";

export const maxDuration = 300;

// GET /api/cron/notify — event reminders (24 h / 1 h), task due/overdue
// emails, check-in open/nudge and the Monday digest. Safe to run as often as
// every 15 minutes: every email is logged and sent once.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db) return Response.json({ ok: true, skipped: "Supabase service role not configured" });
  try {
    const summary = await runScheduledEmails(db);
    console.info(`[notify] sent ${summary.sent}, skipped ${summary.skipped}, failed ${summary.failed}`);
    return Response.json({ ok: summary.failed === 0, ...summary });
  } catch (e) {
    console.error("[notify] job failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
