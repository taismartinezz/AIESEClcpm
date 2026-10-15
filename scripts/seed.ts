import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { SEED_LC_NAME, SEED_PEOPLE } from "./seed-data";
import { SUGGESTED_DEPARTMENTS as SEED_DEPARTMENTS } from "../src/lib/departments";
import { resetSeed } from "./reset";

// Creates a demo Local Committee in the Supabase project from .env.local:
// a president, three VPs, six members, departments with leads, a few tasks and
// eight check-in periods of scores so the wellbeing dashboards have data.
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

  // 2. The LC (triggers seed the system roles) and its departments
  const president = SEED_PEOPLE.find((p) => p.role === "president")!;
  const { data: lc, error: lcErr } = await supabase
    .from("projects")
    .insert({ name: SEED_LC_NAME, institution: "Demo University", owner_id: ids[president.email] })
    .select("id")
    .single();
  if (lcErr) throw lcErr;
  const lcId = lc.id as string;
  // New LCs start without departments; the demo LC uses the classic eight.
  const { error: seedDepErr } = await supabase.from("departments").insert(SEED_DEPARTMENTS.map((d, i) => ({ ...d, project_id: lcId, sort_order: i + 1 })));
  if (seedDepErr) throw seedDepErr;

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

  // 5. Eight check-in periods of scores (two weeks each by default). Written as
  //    the service role, so the database files each row under its period.
  const entries: Record<string, unknown>[] = [];
  for (let period = 0; period < 8; period++) {
    const at = new Date(Date.now() - period * 14 * 86_400_000).toISOString().slice(0, 10);
    SEED_PEOPLE.forEach((person, i) => {
      entries.push({
        user_id: ids[person.email], project_id: lcId, period_start: at,
        scores: CHECKIN_IDS.map((questionId, q) => ({ questionId, score: score(period * 31 + i * 7 + q) })),
      });
    });
  }
  const { error: jErr } = await supabase.from("checkins").insert(entries);
  if (jErr) throw jErr;
  console.log(`  ✓ ${entries.length} check-ins`);

  // 6. Finance: a few ledger lines and one pending claim (with a placeholder receipt)
  const { data: cats } = await supabase.from("finance_categories").select("id, name").eq("project_id", lcId);
  const cat = Object.fromEntries((cats ?? []).map((c) => [c.name as string, c.id as string]));
  const financeLead = SEED_PEOPLE.find((p) => p.leads?.includes("Finance & Legality"))!;
  const today = new Date().toISOString().slice(0, 10);
  const { error: entErr } = await supabase.from("finance_entries").insert([
    { project_id: lcId, type: "income", amount: 450, currency: "EUR", entry_date: today, category_id: cat["Sponsorship"], description: "Partner sponsorship", recorded_by: ids[financeLead.email] },
    { project_id: lcId, type: "income", amount: 120, currency: "EUR", entry_date: today, category_id: cat["Membership fees"], description: "Membership fees", recorded_by: ids[financeLead.email] },
    { project_id: lcId, type: "expense", amount: 85.4, currency: "EUR", entry_date: today, category_id: cat["Marketing"], department_id: depId["Marketing"], description: "Posters", recorded_by: ids[financeLead.email] },
  ]);
  if (entErr) throw entErr;
  const claimant = SEED_PEOPLE.find((p) => p.department === "Outgoing Global Volunteer")!;
  const receiptPath = `${lcId}/${ids[claimant.email]}/seed-receipt.pdf`;
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const { error: upErr } = await supabase.storage.from("receipts").upload(receiptPath, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) throw upErr;
  const { error: claimErr } = await supabase.from("expense_claims").insert({
    project_id: lcId, submitted_by: ids[claimant.email], amount: 23.9, currency: "EUR",
    description: "Snacks for the info session", department_id: depId["Outgoing Global Volunteer"],
    category_id: cat["Food"], receipt_path: receiptPath,
  });
  if (claimErr) throw claimErr;
  console.log("  ✓ finance entries and a pending claim");

  // 7. Attendance: two events with attendees
  const { data: evRows, error: evErr } = await supabase.from("lc_events").insert([
    { project_id: lcId, name: "oGV info session", type: "info_session", starts_on: today, ends_on: today, location: "Main campus", department_id: depId["Outgoing Global Volunteer"], created_by: ids[president.email] },
    { project_id: lcId, name: "National conference", type: "national_conference", starts_on: today, ends_on: today, location: "Host city", created_by: ids[president.email] },
  ]).select("id");
  if (evErr) throw evErr;
  const attendanceRows = (evRows ?? []).flatMap((e, i) => SEED_PEOPLE
    .filter((_, j) => (i === 0 ? j % 2 === 0 : true))
    .map((p) => ({ event_id: e.id, user_id: ids[p.email], project_id: lcId, recorded_by: ids[president.email] })));
  const { error: attErr } = await supabase.from("event_attendance").insert(attendanceRows);
  if (attErr) throw attErr;
  console.log(`  ✓ ${evRows?.length ?? 0} events, ${attendanceRows.length} attendance records`);

  // 8. Tabling: a weekly series of slots for the next four weeks (as the oGX VP)
  const ogxVp = SEED_PEOPLE.find((p) => p.leads?.includes("Outgoing Global Volunteer"))!;
  const firstSlot = new Date(Date.now() + 2 * 86_400_000);
  firstSlot.setUTCHours(11, 0, 0, 0);
  const vpClient = createClient(url!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", { auth: { persistSession: false } });
  const { error: signInErr } = await vpClient.auth.signInWithPassword({ email: ogxVp.email, password: password! });
  if (signInErr) throw signInErr;
  const { data: created, error: slotErr } = await vpClient.rpc("create_tabling_slots", {
    p_project_id: lcId, p_starts_at: firstSlot.toISOString(),
    p_ends_at: new Date(firstSlot.getTime() + 2 * 3_600_000).toISOString(),
    p_location: "Library entrance", p_purpose: "oGV recruitment", p_capacity: 3,
    p_department_id: depId["Outgoing Global Volunteer"],
    p_repeat_until: new Date(firstSlot.getTime() + 21 * 86_400_000).toISOString().slice(0, 10),
  });
  if (slotErr) throw slotErr;
  console.log(`  ✓ ${created} tabling slots`);

  // 9. Exchange pipeline and term goals
  const ogvMember = SEED_PEOPLE.find((p) => p.department === "Outgoing Global Volunteer")!;
  const pipeline = [
    { person_name: "Marta S.", stage: "approved", opportunity: "Teaching kids English", host_entity: "AIESEC in Bogotá" },
    { person_name: "Leo K.", stage: "applied", opportunity: "Climate education", host_entity: "AIESEC in Nairobi" },
    { person_name: "Inês P.", stage: "realized", opportunity: "Women empowerment project", host_entity: "AIESEC in Hanoi" },
    { person_name: "Tom R.", stage: "signed_up", opportunity: null, host_entity: null },
    { person_name: "Nadia F.", stage: "accepted", opportunity: "Climate education", host_entity: "AIESEC in Nairobi",
      applied_at: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10), accepted_at: new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10) },
  ];
  const { error: exErr } = await supabase.from("exchanges").insert(pipeline.map((e) => ({
    ...e, project_id: lcId, product: "ogv", owner_id: ids[ogvMember.email], created_by: ids[ogvMember.email],
  })));
  if (exErr) throw exErr;
  const { data: termStart } = await supabase.rpc("lc_term_start", { p_project_id: lcId });
  const termEnd = new Date(new Date(termStart as string).getTime() + 364 * 86_400_000).toISOString().slice(0, 10);
  const { error: goalErr } = await supabase.from("goals").insert([
    { project_id: lcId, department_id: depId["Outgoing Global Volunteer"], title: "oGV approvals", metric: "pipeline", product: "ogv", stage: "approved", target: 20, starts_on: termStart, ends_on: termEnd, created_by: ids[president.email] },
    { project_id: lcId, department_id: null, title: "New members recruited", metric: "manual", target: 15, current_value: 6, unit: "members", starts_on: termStart, ends_on: termEnd, created_by: ids[president.email] },
  ]);
  if (goalErr) throw goalErr;
  console.log(`  ✓ ${pipeline.length} exchanges and 2 goals`);

  // 10. Partner CRM
  const bdVp = SEED_PEOPLE.find((p) => p.role === "president")!;
  const { data: partnerRows, error: pErr } = await supabase.from("partners").insert([
    { project_id: lcId, name: "Demo Bank", industry: "Banking", stage: "meeting", department_id: depId["Business Development"], owner_id: ids[bdVp.email], next_follow_up: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), created_by: ids[bdVp.email] },
    { project_id: lcId, name: "City Language School", industry: "Education", stage: "partner", department_id: depId["Incoming Global Talent/Teacher"], created_by: ids[bdVp.email] },
  ]).select("id, name");
  if (pErr) throw pErr;
  const bank = (partnerRows ?? []).find((p) => p.name === "Demo Bank")!;
  await supabase.from("partner_contacts").insert({ partner_id: bank.id, name: "Rita Silva", role_title: "Head of HR", email: "rita@demo-bank.example" });
  console.log(`  ✓ ${partnerRows?.length ?? 0} partners`);

  // 11. LC Drive and handover
  const { data: folderRows } = await supabase.from("drive_folders").select("id, name").eq("project_id", lcId);
  const folder = (name: string) => (folderRows ?? []).find((f) => f.name === name)?.id ?? null;
  const { error: dErr } = await supabase.from("bookmarks").insert([
    { project_id: lcId, scope: "lab", folder_id: folder("Brand kit"), title: "AIESEC brand guidelines", url: "https://example.com/brand", added_by: ids[president.email] },
    { project_id: lcId, scope: "lab", folder_id: folder("Templates"), title: "Partnership proposal template", url: "https://example.com/proposal", added_by: ids[president.email] },
    { project_id: lcId, scope: "lab", folder_id: folder("Important links"), title: "Expa", url: "https://expa.aiesec.org", added_by: ids[president.email] },
  ]);
  if (dErr) throw dErr;
  const { error: hErr } = await supabase.from("handover_notes").insert({
    project_id: lcId, department_id: null, term_label: `${String(termStart).slice(0, 4)}/${String((Number(String(termStart).slice(0, 4)) + 1) % 100).padStart(2, "0")}`,
    title: "LC-wide handover", body: "## Open items and deadlines\n- Partner contract with Demo Bank renews in March.\n", updated_by: ids[president.email],
  });
  if (hErr) throw hErr;
  console.log("  ✓ 3 Drive links and a handover note");

  // 12. Recruitment intake
  const { error: recErr } = await supabase.from("recruits").insert([
    { project_id: lcId, name: "Lucía P.", email: "lucia@applicant.example", source: "Tabling", department_id: depId["Marketing"], stage: "interview", created_by: ids[president.email] },
    { project_id: lcId, name: "Omar B.", email: "omar@applicant.example", source: "Instagram", department_id: depId["Outgoing Global Volunteer"], stage: "applied", created_by: ids[president.email] },
    { project_id: lcId, name: "Hana K.", email: "hana@applicant.example", source: "Referral", stage: "offer", created_by: ids[president.email] },
  ]);
  if (recErr) throw recErr;
  console.log("  ✓ 3 applicants in recruitment");

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
