import { cronAuthorized, serviceClient } from "@/lib/server-db";
import { runScheduledEmails } from "@/lib/notify-server";
import { syncRecentEvents } from "@/lib/google-sync";

export const maxDuration = 300;

// GET /api/cron/notify: event reminders (24 h / 1 h), task due/overdue
// emails, check-in open/nudge, the Monday digest, routines turned into tasks,
// and LC events changed in the last day put in line in members' Google Calendars. Safe to run as often as
// every 15 minutes: every email is logged and sent once.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db) return Response.json({ ok: true, skipped: "Supabase service role not configured" });
  try {
    const summary = await runScheduledEmails(db);
    console.info(`[notify] sent ${summary.sent}, skipped ${summary.skipped}, failed ${summary.failed}`);
    // Routines due in the next few days become tasks (once each).
    const routines = await db.rpc("run_routines", { p_project_id: null });
    if (routines.error) console.error("[notify] routines:", routines.error.message);
    // Safety net for Google Calendar: events changed in the last day.
    const google = await syncRecentEvents(db).catch((e) => ({ added: 0, updated: 0, removed: 0, failed: 1, errors: [String(e)] }));
    return Response.json({ ok: summary.failed === 0, ...summary, google, routineTasks: routines.error ? null : routines.data });
  } catch (e) {
    console.error("[notify] job failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
