import { createClient } from "@supabase/supabase-js";
import { sendEmail, buildDigestEmail } from "@/lib/email";
import { getMemberships } from "@/lib/membership";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

// GET /api/cron/digest — weekly digest, fired by Vercel Cron every Monday at 14:00 UTC
// Protected by Authorization: Bearer <CRON_SECRET>. Fails closed when CRON_SECRET is unset.
export async function GET(request: Request) {
  if (!CRON_SECRET) {
    return Response.json({ error: "Unauthorized: CRON_SECRET not configured" }, { status: 401 });
  }
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!supabaseUrl || !serviceKey) {
    return Response.json({ ok: true, skipped: "Supabase not configured" });
  }
  const db = createClient(supabaseUrl, serviceKey);

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all users opted into weekly digest
  const { data: optedIn, error: settingsErr } = await db
    .from("user_settings")
    .select("user_id, notif_digest")
    .eq("notif_digest", true);

  if (settingsErr || !optedIn) {
    console.error("[digest] failed to fetch opted-in users:", settingsErr);
    return Response.json({ error: "Failed to fetch settings" }, { status: 500 });
  }

  const results: { userId: string; ok: boolean; error?: string }[] = [];

  for (const row of optedIn) {
    const uid = row.user_id as string;

    // Resolve recipient email
    const { data: { user: authUser } } = await db.auth.admin.getUserById(uid);
    if (!authUser?.email) { results.push({ userId: uid, ok: false, error: "no email" }); continue; }

    // Resolve profile name
    const { data: prof, error: profErr } = await db
      .from("user_profiles")
      .select("name")
      .eq("id", uid)
      .maybeSingle();
    if (profErr) console.error("[digest] user_profiles error for", uid, profErr.message);
    const recipientName = (prof?.name as string) ?? "there";

    // Find the most recently joined project via team_members (authoritative source).
    // Policy: users in multiple labs receive one digest for their most-recently-joined
    // project. This is a deliberate simplification; per-lab digests would require a
    // separate notif_digest preference per membership row.
    const memberships = await getMemberships(db, uid);
    if (memberships.length === 0) { results.push({ userId: uid, ok: false, error: "no project" }); continue; }
    const projectId = memberships[memberships.length - 1].projectId;

    const { data: proj } = await db.from("projects").select("name").eq("id", projectId).maybeSingle();
    const projectName = (proj?.name as string) ?? "your lab";

    // Tasks completed in last 7 days
    const { count: tasksCompleted } = await db
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "done")
      .gte("updated_at", oneWeekAgo);

    // New tasks added in last 7 days
    const { count: newTasks } = await db
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .gte("created_at", oneWeekAgo);

    // Lab wins from last 7 days
    const { data: wins } = await db
      .from("lab_wins")
      .select("content")
      .eq("project_id", projectId)
      .gte("created_at", oneWeekAgo)
      .order("created_at", { ascending: false })
      .limit(5);

    const labWins = (wins ?? []).map((w) => w.content as string);

    const payload = buildDigestEmail({
      to: authUser.email,
      recipientName,
      projectName,
      tasksCompleted: tasksCompleted ?? 0,
      labWins,
      newTasks: newTasks ?? 0,
    });

    const result = await sendEmail(payload);
    results.push({ userId: uid, ok: result.ok, error: result.error });

    // Pace sends: Resend free tier allows ~2 emails/s; 200ms gap keeps us safe
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const sent = results.filter(r => r.ok).length;
  console.info(`[digest] sent ${sent}/${results.length} digests`);
  return Response.json({ ok: true, sent, total: results.length });
}
