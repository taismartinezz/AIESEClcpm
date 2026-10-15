// Browser-extension endpoint - saves a captured page as a literature item.
// Auth: pass Supabase access token as "Authorization: Bearer <token>" header.

import { createClient } from "@supabase/supabase-js";
import { getMemberships } from "@/lib/membership";

export const runtime = "nodejs";

interface SavePayload {
  title: string;
  url?: string;
  doi?: string;
  authors?: string[];
  year?: number;
  journal?: string;
  abstract?: string;
  scope?: "lab" | "my" | "project";
  /** Explicit project ID. When omitted, defaults to the user's most recently joined project. */
  projectId?: string;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return Response.json({ error: "Authorization header required" }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  // Build authenticated client from the user's bearer token
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return Response.json({ error: "Invalid token" }, { status: 401 });

  const body = (await request.json()) as SavePayload;
  if (!body.title?.trim()) return Response.json({ error: "title is required" }, { status: 400 });

  // Resolve project via team_members (authoritative source; user_profiles.project_id
  // is unreliable for multi-lab users).
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const db = serviceKey ? createClient(supabaseUrl, serviceKey) : supabase;
  const memberships = await getMemberships(db, user.id);
  if (memberships.length === 0) return Response.json({ error: "No project found for user" }, { status: 403 });

  // If caller specified a projectId, verify membership; otherwise use most recently joined.
  let projectId: string;
  if (body.projectId) {
    const match = memberships.find((m) => m.projectId === body.projectId);
    if (!match) return Response.json({ error: "Forbidden: not a member of that project" }, { status: 403 });
    projectId = match.projectId;
  } else {
    projectId = memberships[memberships.length - 1].projectId;
  }
  const library   = body.scope ?? "lab";
  const now       = new Date().toISOString();
  const id        = crypto.randomUUID();

  const { error: insertErr } = await supabase.from("literature_items").insert({
    id,
    project_id:    projectId,
    user_id:       user.id,
    library,
    type:          "article",
    title:         body.title.trim(),
    authors:       body.authors ?? [],
    year:          body.year ?? null,
    journal:       body.journal ?? null,
    doi:           body.doi ?? null,
    abstract:      body.abstract ?? null,
    url:           body.url ?? null,
    tags:          [],
    status:        "unread",
    rating:        0,
    import_source: "url",
    created_at:    now,
  });

  if (insertErr) {
    console.error("[literature/save]", insertErr);
    return Response.json({ error: insertErr.message }, { status: 500 });
  }

  return Response.json({ id, projectId });
}
