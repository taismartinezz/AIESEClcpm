import { createClient } from "@supabase/supabase-js";
import { sendEmail, buildTaskAssignedEmail, buildLabWinEmail } from "@/lib/email";
import { getMemberships } from "@/lib/membership";

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey      = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

// ── In-process rate limiter (best-effort in serverless; resets per cold start) ─
const RATE_WINDOW_MS = 60_000;
const RATE_MAX       = 20; // emails per sender per minute
const rateMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(senderId: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(senderId);
  if (!entry || now > entry.resetAt) {
    rateMap.set(senderId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  return true;
}

// ── Auth: always requires a valid JWT or internal secret ──────────────────────
async function resolveUser(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const internalSecret = process.env.INTERNAL_API_SECRET ?? "";

  // Internal secret path: caller is the server itself — no user identity
  if (internalSecret && authHeader === `Bearer ${internalSecret}`) {
    return "internal";
  }

  // User JWT path
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !anonKey || !supabaseUrl) return null;
  const anonClient = createClient(supabaseUrl, anonKey);
  const { data: { user } } = await anonClient.auth.getUser(token);
  return user?.id ?? null;
}

// POST /api/email/send
// Body for task_assigned: { type: "task_assigned", taskId: string, recipientId: string }
// Body for lab_win:       { type: "lab_win",       labWinId: string, recipientId: string }
// senderId is always taken from the verified JWT — never from the body.
export async function POST(request: Request) {
  const callerId = await resolveUser(request);
  if (!callerId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as {
    type: string;
    recipientId: string;
    taskId?: string;
    labWinId?: string;
  };

  if (!body.type || !body.recipientId) {
    return Response.json({ error: "type and recipientId are required" }, { status: 400 });
  }

  // Never notify yourself; skip silently
  if (callerId !== "internal" && callerId === body.recipientId) {
    return Response.json({ ok: true, skipped: "recipient is sender" });
  }

  if (!supabaseUrl || !serviceKey) {
    return Response.json({ ok: true, skipped: "Supabase not configured" });
  }
  const db = createClient(supabaseUrl, serviceKey);

  // Rate-limit non-internal callers
  if (callerId !== "internal" && !checkRateLimit(callerId)) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  // Resolve recipient email via auth.admin (user_profiles has no email column)
  const { data: { user: authUser }, error: authErr } = await db.auth.admin.getUserById(body.recipientId);
  if (authErr || !authUser?.email) {
    return Response.json({ ok: true, skipped: "No email on file" });
  }
  const recipientEmail = authUser.email;

  // Resolve recipient display name
  const { data: recipientProf } = await db.from("user_profiles").select("name").eq("id", body.recipientId).maybeSingle();
  const recipientName = (recipientProf?.name as string) ?? "there";

  // Check notification preferences
  const { data: settings } = await db
    .from("user_settings")
    .select("notif_task_assigned, notif_lab_win")
    .eq("user_id", body.recipientId)
    .maybeSingle();

  let emailPayload;

  if (body.type === "task_assigned") {
    if (settings?.notif_task_assigned === false) {
      return Response.json({ ok: true, skipped: "opted out" });
    }
    if (!body.taskId) {
      return Response.json({ error: "taskId required for task_assigned" }, { status: 400 });
    }

    // Load task from DB — verify data, never trust client payload
    const { data: task } = await db
      .from("tasks")
      .select("id, title, project_id, projects(name)")
      .eq("id", body.taskId)
      .maybeSingle();

    if (!task) {
      return Response.json({ ok: true, skipped: "task not found" });
    }

    const taskProjectId = task.project_id as string;
    const proj = Array.isArray(task.projects) ? task.projects[0] : task.projects;
    const projectName = (proj as { name?: string } | null)?.name ?? "your lab";

    // Verify: recipient must be assigned to this task
    const { data: assignment } = await db
      .from("task_assignees")
      .select("user_id")
      .eq("task_id", body.taskId)
      .eq("user_id", body.recipientId)
      .maybeSingle();

    if (!assignment) {
      return Response.json({ ok: true, skipped: "recipient not assigned to task" });
    }

    // Verify: caller must be a team_member of the task's project (for user JWT callers)
    if (callerId !== "internal") {
      const callerMemberships = await getMemberships(db, callerId);
      const inProject = callerMemberships.some((m) => m.projectId === taskProjectId);
      if (!inProject) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Load assigner name
    const { data: callerProf } = await db.from("user_profiles").select("name").eq("id", callerId === "internal" ? body.recipientId : callerId).maybeSingle();
    const assignerName = callerId !== "internal" ? ((callerProf?.name as string) ?? "A teammate") : "Canopy";

    emailPayload = buildTaskAssignedEmail({
      to: recipientEmail,
      recipientName,
      taskTitle: task.title as string,
      assignerName,
      projectName,
    });

  } else if (body.type === "lab_win") {
    if (settings?.notif_lab_win === false) {
      return Response.json({ ok: true, skipped: "opted out" });
    }
    if (!body.labWinId) {
      return Response.json({ error: "labWinId required for lab_win" }, { status: 400 });
    }

    // Load lab win from DB
    const { data: win } = await db
      .from("lab_wins")
      .select("id, content, author_id, project_id, projects(name)")
      .eq("id", body.labWinId)
      .maybeSingle();

    if (!win) {
      return Response.json({ ok: true, skipped: "lab win not found" });
    }

    // Verify: caller must be the poster (for user JWT callers)
    if (callerId !== "internal" && (win.author_id as string) !== callerId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    // Verify: recipient must be a team_member of the win's project
    const winProjectId = win.project_id as string;
    const recipientMemberships = await getMemberships(db, body.recipientId);
    const recipientInProject = recipientMemberships.some((m) => m.projectId === winProjectId);
    if (!recipientInProject) {
      return Response.json({ ok: true, skipped: "recipient not in same project" });
    }

    const winProj = Array.isArray(win.projects) ? win.projects[0] : win.projects;
    const projectName = (winProj as { name?: string } | null)?.name ?? "your lab";

    // Load poster name
    const { data: posterProf } = await db.from("user_profiles").select("name").eq("id", win.author_id as string).maybeSingle();
    const posterName = (posterProf?.name as string) ?? "A teammate";

    emailPayload = buildLabWinEmail({
      to: recipientEmail,
      recipientName,
      posterName,
      content: win.content as string,
      projectName,
    });

  } else {
    return Response.json({ error: `Unknown type: ${body.type}` }, { status: 400 });
  }

  const result = await sendEmail(emailPayload);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 502 });
  }
  return Response.json({ ok: true });
}
