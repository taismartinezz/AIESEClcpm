import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { SEED_EMAILS } from "./seed-data";

// Deletes ONLY the fictional seed accounts (and the LCs they own) from the
// Supabase project in .env.local. Run: npm run db:seed:reset

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

export async function resetSeed(): Promise<void> {
  console.log(`Target: ${url}`);
  const { data: list, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;

  const seeded = list.users.filter((u) => SEED_EMAILS.includes(u.email ?? ""));
  if (!seeded.length) { console.log("No seed accounts found."); return; }
  const ids = seeded.map((u) => u.id);

  // Projects cascade to members, departments, tasks, etc.
  const { data: projects } = await supabase.from("projects").select("id").in("owner_id", ids);
  const pids = (projects ?? []).map((p: { id: string }) => p.id);
  if (pids.length) {
    const { error: projErr } = await supabase.from("projects").delete().in("id", pids);
    if (projErr) throw projErr;
    console.log(`✓ LCs deleted (${pids.length})`);
  }

  for (const u of seeded) {
    // Deleting the auth user cascades to user_profiles and journal entries.
    const { error: delErr } = await supabase.auth.admin.deleteUser(u.id);
    if (delErr) console.warn(`⚠ ${u.email}: ${delErr.message}`);
    else console.log(`✓ deleted ${u.email}`);
  }
}

if (require.main === module) {
  resetSeed().catch((err: unknown) => {
    console.error("✗", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
