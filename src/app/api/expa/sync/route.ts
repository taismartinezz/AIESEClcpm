import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/api-auth";
import { serviceClient } from "@/lib/server-db";
import { accessTokenFor, fetchApplications } from "@/lib/expa-server";
import { planSync } from "@/lib/expa-sync";

export const maxDuration = 60;

// POST /api/expa/sync { projectId }: read the applications of the caller's
// EXPA home LC from the last year and add / update them in the pipeline. The
// rows go through import_exchanges as the caller (their own token), so they
// can only touch the products their department may work on.
export async function POST(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server" }, { status: 503 });
  const { projectId } = await request.json().catch(() => ({}));
  if (typeof projectId !== "string" || !projectId) return Response.json({ error: "projectId required" }, { status: 400 });

  const { data: member } = await db.from("team_members").select("user_id").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
  if (!member) return Response.json({ error: "You aren't a member of this LC." }, { status: 403 });
  const { data: conn } = await db.from("expa_connections").select("home_lc_id, home_lc_name").eq("user_id", userId).maybeSingle();
  if (!conn) return Response.json({ error: "Connect EXPA first.", reconnect: true }, { status: 409 });
  if (!conn.home_lc_id) return Response.json({ error: "Your EXPA profile has no home LC." }, { status: 409 });

  const auth = await accessTokenFor(db, userId);
  if ("reconnect" in auth) return Response.json({ error: auth.reconnect, reconnect: true }, { status: 409 });

  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  let plan;
  try {
    plan = planSync(await fetchApplications(auth.token, conn.home_lc_id as string, since), conn.home_lc_id as string);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // As the caller, so RLS applies.
  const bearer = request.headers.get("Authorization") ?? "";
  const asCaller = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    { global: { headers: { Authorization: bearer } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  let inserted = 0, updated = 0, failed = 0;
  const errors: string[] = [];
  for (const [product, rows] of Object.entries(plan.byProduct)) {
    for (let i = 0; i < rows!.length; i += 2000) {
      const { data, error } = await asCaller.rpc("import_exchanges", { p_project_id: projectId, p_product: product, p_rows: rows!.slice(i, i + 2000) });
      if (error) { failed += rows!.slice(i, i + 2000).length; errors.push(`${product}: ${error.message}`); continue; }
      const r = (Array.isArray(data) ? data[0] : data) as { inserted: number; updated: number; failed: number; errors: string[] } | null;
      inserted += r?.inserted ?? 0; updated += r?.updated ?? 0; failed += r?.failed ?? 0;
      errors.push(...(r?.errors ?? []));
    }
  }
  await db.from("expa_connections").update({ last_synced_at: new Date().toISOString() }).eq("user_id", userId);
  return Response.json({ lc: conn.home_lc_name, inserted, updated, failed, skipped: plan.skipped, errors: errors.slice(0, 20) });
}
