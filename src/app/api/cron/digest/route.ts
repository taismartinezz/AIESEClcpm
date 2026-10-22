import { cronAuthorized, serviceClient } from "@/lib/server-db";
import { Mailer, runDigest } from "@/lib/notify-server";

export const maxDuration = 300;

// GET /api/cron/digest: the Monday digest on its own (also part of
// /api/cron/notify). Each person gets one digest per LC per week.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db) return Response.json({ ok: true, skipped: "Supabase service role not configured" });
  const mailer = new Mailer(db);
  await runDigest(db, mailer, new Date(), true);
  return Response.json({ ok: mailer.summary.failed === 0, ...mailer.summary });
}
