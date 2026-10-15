import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { SEED_LC_NAME, SEED_PEOPLE } from "./seed-data";
import { resetSeed } from "./reset";

// Creates a demo Local Committee in the Supabase project from .env.local:
// a president, three VPs, six members, departments with leads, a few tasks and
// eight weeks of check-in scores so the wellbeing dashboards have data.
//
// Run: SEED_PASSWORD='…' npm run db:seed
// Never point this at a production project — it creates real auth accounts.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_PASSWORD;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!password || password.length < 10) {
  console.error("Set SEED_PASSWORD (10+ characters) — it becomes the password of every demo account.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const CHECKIN_IDS = ["energy", "workload", "purpose", "support", "belonging", "balance"] as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Deterministic 1–5 score so reruns produce the same charts. */
function score(seed: number): number {
  const unit = (Math.sin(seed) + 1) / 2; // 0..1
  return 2 + Math.round(unit * 3);      // 2..5, a plausible spread
}

async function seed() {
  console.log(`\n── Seeding ${SEED_LC_NAME} into ${url} ──\n`);

  // 1. Accounts + profiles
  const ids: Record<string, string> = {};
  for (const person of SEED_PEOPLE) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: person.email, password, email_confirm: true, user_metadata: { name: person.name },
    });
    if (error) throw error;
    ids[person.email] = data.user.id;
    const { error: profErr } = await supabase.from("user_profiles").upsert({
      id: data.user.id, name: person.name, role: person.role, avatar_initials: initials(person.name),
    });
    if (profErr) throw profErr;
    console.log(`  ✓ ${person.role.padEnd(9)} ${person.email}`);
  }

  // 2. The LC (triggers seed system roles and the default departments)
  const president = SEED_PEOPLE.find((p) => p.role === "president")!;
  const { data: lc, error: lcErr } = await supabase
    .from("projects")
    .insert({ name: SEED_LC_NAME, institution: "Demo University", owner_id: ids[president.email] })
    .select("id")
    .single();
  if (lcErr) throw lcErr;
  const lcId = lc.id as string;

  const { data: deps, error: depErr } = await supabase.from("departments").select("id, name").eq("project_id", lcId);
  if (depErr) throw depErr;
  const depId = Object.fromEntries((deps ?? []).map((d) => [d.name as string, d.id as string]));

  // 3. Memberships, departments, VP leads
  for (const person of SEED_PEOPLE) {
    const { error } = await supabase.from("team_members").insert({
      project_id: lcId, user_id: ids[person.email], role: person.role,
      department_id: person.department ? depId[person.department] : null,
    });
    if (error) throw error;
    for (const name of person.leads ?? []) {
      const { error: leadErr } = await supabase.from("departments").update({ vp_user_id: ids[person.email] }).eq("id", depId[name]);
      if (leadErr) throw leadErr;
    }
  }
  console.log(`  ✓ ${SEED_PEOPLE.length} members in ${SEED_LC_NAME}`);

  // 4. A few tasks
  const tasks = [
    { title: "Design recruitment posters", status: "in_progress", department: "Marketing", assignee: "member1@example.com" },
    { title: "Book the info-session room", status: "todo", department: "Outgoing Global Volunteer", assignee: "member4@example.com" },
    { title: "Collect conference receipts", status: "backlog", department: "Finance & Legality", assignee: "vp.finance@example.com" },
  ];
  for (const t of tasks) {
    const { data: row, error } = await supabase.from("tasks").insert({
      project_id: lcId, title: t.title, status: t.status, department_id: depId[t.department],
      created_by: ids[president.email], scope: "lab",
    }).select("id").single();
    if (error) throw error;
    await supabase.from("task_assignees").insert({ task_id: row.id, user_id: ids[t.assignee] });
  }
  console.log(`  ✓ ${tasks.length} tasks`);

  // 5. Eight weeks of check-in scores (journal text left empty)
  const entries: Record<string, unknown>[] = [];
  for (let week = 0; week < 8; week++) {
    const createdAt = new Date(Date.now() - week * 7 * 86_400_000).toISOString();
    SEED_PEOPLE.forEach((person, i) => {
      entries.push({
        user_id: ids[person.email], project_id: lcId, created_at: createdAt,
        content: { prompts: [], checkin: [] },
        checkin_scores: CHECKIN_IDS.map((questionId, q) => ({ questionId, score: score(week * 31 + i * 7 + q) })),
      });
    });
  }
  const { error: jErr } = await supabase.from("journal_entries").insert(entries);
  if (jErr) throw jErr;
  console.log(`  ✓ ${entries.length} weekly check-ins`);

  console.log(`\nDone. Sign in as any ${SEED_PEOPLE[0].email.split("@")[1]} account above with SEED_PASSWORD.\n`);
}

async function main() {
  await resetSeed();
  await seed();
}

main().catch((err: unknown) => {
  console.error("\n✗ Failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
