import { createClient } from "@supabase/supabase-js";
import { sendEmail, buildInviteEmail } from "@/lib/email";
import { getMemberships, isPiOf } from "@/lib/membership";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

const RESEND_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_IDS = 50;

// POST /api/invite/send
// Body: { inviteIds: string[] }  — invite_codes.id values to email (max 50)
// Auth: valid Supabase user JWT belonging to a PI of each invite's project
export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !anonKey || !supabaseUrl) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const anonClient = createClient(supabaseUrl, anonKey);
  const { data: { user: authedUser }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !authedUser) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const user = authedUser;

  const body = await request.json() as { inviteIds: unknown };
  if (!Array.isArray(body.inviteIds) || body.inviteIds.length === 0) {
    return Response.json({ error: "inviteIds must be a non-empty array" }, { status: 400 });
  }
  if (body.inviteIds.length > MAX_IDS) {
    return Response.json({ error: `Maximum ${MAX_IDS} inviteIds per request` }, { status: 400 });
  }
  const inviteIds = body.inviteIds as string[];

  if (!serviceKey) return Response.json({ ok: true, skipped: "service key not configured" });
  const db = createClient(supabaseUrl, serviceKey);

  // Resolve caller's name from user_profiles (name only — no project_id dependency)
  const { data: callerProf, error: profErr } = await db
    .from("user_profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  if (profErr) console.error("[invite/send] user_profiles lookup error:", profErr.message);
  const inviterName = (callerProf?.name as string) ?? "Your PI";

  // Load caller's memberships from team_members (authoritative source)
  const memberships = await getMemberships(db, user.id);
  const callerProjectIds = new Set(memberships.map((m) => m.projectId));
  if (callerProjectIds.size === 0) {
    return Response.json({ error: "Forbidden: no project" }, { status: 403 });
  }

  // Fetch only unused invites that have an email, capped at MAX_IDS
  const { data: invites, error: fetchErr } = await db
    .from("invite_codes")
    .select("id, invited_email, code, lab_role_id, email_sent_at, used_by, project_id")
    .in("id", inviteIds)
    .not("invited_email", "is", null)
    .is("used_by", null);

  if (fetchErr) {
    console.error("[invite/send] invite_codes fetch error:", fetchErr.message);
    return Response.json({ error: "Failed to fetch invites" }, { status: 500 });
  }
  if (!invites || invites.length === 0) {
    return Response.json({ ok: true, results: [] });
  }

  // Cache project names and PI checks to avoid repeated queries
  const projectNameCache = new Map<string, string>();
  const piCache = new Map<string, boolean>();

  async function getProjectName(projectId: string): Promise<string> {
    if (projectNameCache.has(projectId)) return projectNameCache.get(projectId)!;
    const { data: proj, error: projErr } = await db.from("projects").select("name").eq("id", projectId).maybeSingle();
    if (projErr) console.error("[invite/send] projects lookup error:", projErr.message);
    const name = (proj?.name as string) ?? "the lab";
    projectNameCache.set(projectId, name);
    return name;
  }

  async function callerIsPi(projectId: string): Promise<boolean> {
    if (piCache.has(projectId)) return piCache.get(projectId)!;
    const result = await isPiOf(db, user.id, projectId);
    piCache.set(projectId, result);
    return result;
  }

  const now = new Date();
  const results: { id: string; ok: boolean; skipped?: string; error?: string }[] = [];

  for (const invite of invites) {
    const inviteProjectId = invite.project_id as string;

    // Skip invites from projects the caller is not a PI of
    const isPI = await callerIsPi(inviteProjectId);
    if (!isPI) {
      results.push({ id: invite.id as string, ok: false, skipped: "not PI of this project" });
      continue;
    }

    // Cooldown check
    const sentAt = invite.email_sent_at ? new Date(invite.email_sent_at as string) : null;
    if (sentAt && now.getTime() - sentAt.getTime() < RESEND_COOLDOWN_MS) {
      results.push({ id: invite.id as string, ok: false, skipped: "cooldown" });
      continue;
    }

    const email    = invite.invited_email as string;
    const code     = invite.code as string;
    const labName  = await getProjectName(inviteProjectId);

    // Resolve role name
    let roleName = "Researcher";
    if (invite.lab_role_id) {
      const { data: role, error: roleErr } = await db
        .from("lab_roles")
        .select("name")
        .eq("id", invite.lab_role_id as string)
        .maybeSingle();
      if (roleErr) console.error("[invite/send] lab_roles lookup error:", roleErr.message);
      if (role?.name) roleName = role.name as string;
    }

    const emailPayload = buildInviteEmail({ to: email, labName, inviterName, role: roleName, inviteCode: code });
    const result = await sendEmail(emailPayload);

    if (result.ok) {
      const { error: updateErr } = await db
        .from("invite_codes")
        .update({ email_sent_at: now.toISOString() })
        .eq("id", invite.id as string);
      if (updateErr) console.error("[invite/send] email_sent_at update error:", updateErr.message);
    } else {
      console.error("[invite/send] send failed for", email, result.error);
    }

    results.push({ id: invite.id as string, ok: result.ok, error: result.error });
  }

  const allOk = results.every((r) => r.ok || r.skipped !== undefined);
  return Response.json({ ok: allOk, results });
}
