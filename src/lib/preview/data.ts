// Sample data for preview mode (no database connected): one fictional LC that
// every page reads from, so the dashboard, tasks, pipeline, reminders… agree.
// Mirrors create_demo_lc() in supabase/migrations/20261019004_demo_lc.sql.
// All people and organisations are made up.

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export const PREVIEW_LC_ID = "10000000-0000-4000-8000-000000000001";
export const PREVIEW_USER_ID = "20000000-0000-4000-8000-000000000001";
export const PREVIEW_EMAIL = "you@preview.example";

const uid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const id = (prefix: number, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** YYYY-MM-DD, `days` from today in the viewer's time zone. */
function day(now: Date, days: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** ISO instant at local hh:mm, `days` from today. */
function at(now: Date, days: number, hh: number, mm = 0): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hh, mm).toISOString();
}

export function buildPreviewTables(now = new Date(), myName = "Alex Rivera"): Tables {
  const iso = now.toISOString();
  const lc = PREVIEW_LC_ID;
  const me = PREVIEW_USER_ID;
  const termStart = `${now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1}-02-01`;

  const D = { ogv: id(3, 1), ogt: id(3, 2), igv: id(3, 3), igt: id(3, 4), mkt: id(3, 5), tm: id(3, 6), fl: id(3, 7), bd: id(3, 8) };
  const departments: Row[] = [
    { id: D.ogv, name: "Outgoing Global Volunteer", color: "#F85A40", products: ["ogv"], vp_user_id: uid(2), is_finance: false, sort_order: 1 },
    { id: D.ogt, name: "Outgoing Global Talent/Teacher", color: "#0CB9C1", products: ["ogta", "ogte"], vp_user_id: null, is_finance: false, sort_order: 2 },
    { id: D.igv, name: "Incoming Global Volunteer", color: "#D9442B", products: ["igv"], vp_user_id: null, is_finance: false, sort_order: 3 },
    { id: D.igt, name: "Incoming Global Talent/Teacher", color: "#0A8F96", products: ["igta", "igte"], vp_user_id: null, is_finance: false, sort_order: 4 },
    { id: D.mkt, name: "Marketing", color: "#FFC845", products: [], vp_user_id: uid(3), is_finance: false, sort_order: 5 },
    { id: D.tm, name: "Talent Management", color: "#00C16E", products: [], vp_user_id: null, is_finance: false, sort_order: 6 },
    { id: D.fl, name: "Finance & Legality", color: "#037EF3", products: [], vp_user_id: uid(4), is_finance: true, sort_order: 7 },
    { id: D.bd, name: "Business Development", color: "#7552CC", products: [], vp_user_id: null, is_finance: false, sort_order: 8 },
  ].map((d) => ({ ...d, project_id: lc, pulse_area: null, created_at: iso }));

  const people: { n: number; name: string; role: "president" | "vp" | "member"; dept: string | null; color: string }[] = [
    { n: 1, name: myName, role: "president", dept: null, color: "#B4D4F7" },
    { n: 2, name: "Kwame Mensah", role: "vp", dept: D.ogv, color: "#FBD3CB" },
    { n: 3, name: "Lena Fischer", role: "vp", dept: D.mkt, color: "#FFEBB5" },
    { n: 4, name: "Sofia Almeida", role: "vp", dept: D.fl, color: "#B5ECD3" },
    { n: 5, name: "Priya Nair", role: "member", dept: D.ogv, color: "#D9CCF2" },
    { n: 6, name: "Diego Rojas", role: "member", dept: D.mkt, color: "#B4E3E5" },
    { n: 7, name: "Tom Becker", role: "member", dept: D.tm, color: "#F7D6E6" },
    { n: 8, name: "Mia Costa", role: "member", dept: D.bd, color: "#D6E8C3" },
  ];
  const initials = (s: string) => s.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const ROLE_IDS = { president: id(4, 1), vp: id(4, 2), member: id(4, 3) };

  const user_profiles = people.map((p) => ({
    id: uid(p.n), name: p.name, role: p.role, avatar_color: p.color, avatar_initials: initials(p.name), avatar_url: null,
    bio: null, institution: "Demo University", department: null, project_id: lc, created_at: iso,
    last_seen_at: p.n === 7 ? at(now, -20, 10) : at(now, -1, 18),
  }));
  const team_members = people.map((p, i) => ({
    id: id(5, i + 1), project_id: lc, user_id: uid(p.n), role: p.role, lab_role_id: ROLE_IDS[p.role], department_id: p.dept,
    joined_at: at(now, -200 + i * 5, 12), term_start: termStart, term_end: null,
  }));

  // Exchanges: a realistic spread over the term.
  const ex = (n: number, product: string, stage: string, name: string, opp: string | null, host: string | null, dates: Partial<Record<string, number | null>>, dept = D.ogv) => ({
    id: id(6, n), project_id: lc, product, stage, person_name: name, email: `${name.split(" ")[0].toLowerCase()}@preview.example`, phone: null,
    opportunity: opp, host_entity: host, expa_id: `DEMO-${n}`, expa_url: null, department_id: dept, owner_id: uid(5), notes: null,
    signed_up_at: day(now, (dates.applied_at ?? 0) - 7),
    applied_at: dates.applied_at != null ? day(now, dates.applied_at) : null,
    accepted_at: dates.accepted_at != null ? day(now, dates.accepted_at) : null,
    approved_at: dates.approved_at != null ? day(now, dates.approved_at) : null,
    realized_at: dates.realized_at != null ? day(now, dates.realized_at) : null,
    finished_at: dates.finished_at != null ? day(now, dates.finished_at) : null,
    completed_at: dates.completed_at != null ? day(now, dates.completed_at) : null,
    email_consent: true, consent_source: "EXPA sign-up", unsubscribed_at: null, replied_at: null,
    created_by: uid(5), created_at: iso, updated_at: iso,
  });
  const exchanges = [
    ex(1, "ogv", "completed", "Marta Silva", "Teaching English to kids", "AIESEC in Bogotá", { applied_at: -160, accepted_at: -150, approved_at: -140, realized_at: -100, finished_at: -60, completed_at: -50 }),
    ex(2, "ogv", "realized", "Leo Kamau", "Climate education", "AIESEC in Nairobi", { applied_at: -90, accepted_at: -80, approved_at: -70, realized_at: -10 }),
    ex(3, "ogv", "approved", "Inês Pereira", "Women empowerment", "AIESEC in Hanoi", { applied_at: -30, accepted_at: -25, approved_at: -3 }),
    ex(4, "ogv", "approved", "Tom Reyes", "Health awareness", "AIESEC in Lima", { applied_at: -20, accepted_at: -15, approved_at: -9 }),
    ex(5, "ogv", "accepted", "Nadia Farah", "Climate education", "AIESEC in Nairobi", { applied_at: -35, accepted_at: -21 }),
    ex(6, "ogv", "applied", "Sam Okoro", "Teaching English to kids", "AIESEC in Bogotá", { applied_at: -18 }),
    ex(7, "ogv", "applied", "Ana Costa", "Ocean clean-up", "AIESEC in Bali", { applied_at: -4 }),
    { ...ex(8, "ogv", "signed_up", "Eli Novak", null, null, {}), signed_up_at: day(now, -2) },
    ex(9, "igta", "realized", "Chen Wei", "Marketing intern at Demo Bank", "AIESEC in Taipei", { applied_at: -120, accepted_at: -110, approved_at: -95, realized_at: -40 }, D.igt),
    ex(10, "igte", "approved", "Priya Shah", "English teacher, City Language School", "AIESEC in Pune", { applied_at: -25, accepted_at: -20, approved_at: -6 }, D.igt),
  ];

  const task = (n: number, title: string, status: string, priority: string, due: number | null, dept: string | null, assignees: number[]) => ({
    id: id(7, n), project_id: lc, title, description: "", status, priority, due_date: due == null ? null : day(now, due), department_id: dept,
    scope: "lab", sub_project_id: null, parent_id: null, archived: false, display_order: n, comments: [], files: [], links: [],
    created_by: me, created_at: at(now, -10 + n, 9), updated_at: iso,
    task_assignees: assignees.map((a) => ({ user_id: uid(a) })),
  });
  const tasks = [
    task(1, "Design recruitment posters for the oGV info session", "in_progress", "high", 3, D.mkt, [1, 6]),
    task(2, "Book the auditorium for the info session", "todo", "high", 5, D.ogv, [5]),
    task(3, "Prepare the onboarding pack for new members", "in_review", "medium", 7, D.tm, [7]),
    task(4, "Reach out to 10 partner companies for summer internships", "backlog", "medium", null, D.bd, []),
    task(5, "Post this week's exchange story on Instagram", "done", "low", -2, D.mkt, [6]),
    task(6, "Collect conference receipts", "todo", "medium", -1, D.fl, [1, 4]),
    task(7, "Match 3 applicants with Global Volunteer projects", "in_progress", "high", 4, D.ogv, [2, 5]),
    task(8, "Send the LC meeting agenda", "todo", "medium", 0, null, [1]),
  ];
  const task_assignees = tasks.flatMap((t) => (t.task_assignees as { user_id: string }[]).map((a) => ({ task_id: t.id, user_id: a.user_id, created_at: iso })));

  const reminders = [
    { id: id(8, 1), user_id: me, project_id: lc, scope: "lab", title: "LC meeting: bring your department update", due_at: at(now, 2, 18), completed: false, assignee_id: null, priority: "medium" },
    { id: id(8, 2), user_id: me, project_id: null, scope: "personal", title: "Call Demo Bank about the sponsorship", due_at: at(now, 0, 15), completed: false, assignee_id: null, priority: "high" },
  ].map((r) => ({ ...r, sub_project_id: null, linked_task_id: null, linked_event_id: null, email_enabled: false, sent: false, completed_at: null, recurrence: null, position: 1, kind: null, created_at: iso }));

  const lc_events = [
    { id: id(9, 1), name: "oGV info session", type: "info_session", starts_on: day(now, 6), ends_on: day(now, 6), starts_at: at(now, 6, 18), ends_at: at(now, 6, 19, 30), location: "Room 2.14", meeting_url: null, audience: "lc" },
    { id: id(9, 2), name: "General Assembly", type: "local_event", starts_on: day(now, 9), ends_on: day(now, 9), starts_at: at(now, 9, 17), ends_at: at(now, 9, 19), location: "Main hall", meeting_url: "https://zoom.example/j/123", audience: "lc" },
    { id: id(9, 3), name: "Local conference", type: "local_conference", starts_on: day(now, -20), ends_on: day(now, -19), starts_at: null, ends_at: null, location: "Campus centre", meeting_url: null, audience: "lc" },
  ].map((e) => ({ ...e, project_id: lc, department_id: null, description: null, audience_role: null, invites_sent_at: null, created_by: me, created_at: iso, updated_at: iso }));
  const event_attendance = [1, 2, 3, 5, 6].map((n) => ({ event_id: id(9, 3), user_id: uid(n), project_id: lc, recorded_by: me, recorded_at: iso }));
  const event_rsvps = [2, 3, 5].map((n) => ({ event_id: id(9, 1), user_id: uid(n), project_id: lc, response: "going", responded_at: iso }));

  const tabling_slots = [
    { id: id(10, 1), starts_at: at(now, 2, 12), ends_at: at(now, 2, 14), location: "Library entrance", purpose: "oGV recruitment", capacity: 3, taken: 1, department_id: D.ogv },
    { id: id(10, 2), starts_at: at(now, 4, 10), ends_at: at(now, 4, 12), location: "Main hall", purpose: "Member recruitment", capacity: 2, taken: 0, department_id: D.tm },
  ].map((s) => ({ ...s, project_id: lc, series_id: null, created_by: uid(2), created_at: iso }));
  const tabling_signups = [{ slot_id: id(10, 1), user_id: uid(5), project_id: lc, status: "signed_up", walk_in: false, signed_up_at: iso, marked_by: null, marked_at: null }];

  const goals = [
    { id: id(11, 1), department_id: D.ogv, title: "oGV approvals", metric: "pipeline", product: "ogv", stage: "approved", target: 20, current_value: 0, unit: null },
    { id: id(11, 2), department_id: D.ogv, title: "oGV realizations", metric: "pipeline", product: "ogv", stage: "realized", target: 15, current_value: 0, unit: null },
    { id: id(11, 3), department_id: null, title: "New members recruited", metric: "manual", product: null, stage: null, target: 15, current_value: 6, unit: "members" },
  ].map((g) => ({ ...g, project_id: lc, starts_on: termStart, ends_on: day(new Date(termStart + "T12:00:00"), 364), created_by: me, created_at: iso }));

  const partners = [
    { id: id(12, 1), name: "Demo Bank", industry: "Banking", stage: "meeting", department_id: D.bd, owner_id: uid(8), next_follow_up: day(now, 2) },
    { id: id(12, 2), name: "City Language School", industry: "Education", stage: "partner", department_id: D.igt, owner_id: null, next_follow_up: null },
    { id: id(12, 3), name: "Print & Co", industry: "Printing", stage: "proposal", department_id: D.mkt, owner_id: uid(3), next_follow_up: day(now, -1) },
  ].map((p) => ({ ...p, project_id: lc, website: null, notes: null, created_by: me, created_at: iso, updated_at: iso }));
  const partner_contacts = [{ id: id(13, 1), partner_id: id(12, 1), name: "Rita Silva", role_title: "Head of HR", email: "rita@demo-bank.example", phone: null, notes: null, created_at: iso }];

  const recruits = [
    { id: id(14, 1), name: "Lucía Pérez", email: "lucia@preview.example", source: "Tabling", department_id: D.mkt, stage: "interview" },
    { id: id(14, 2), name: "Omar Ben", email: "omar@preview.example", source: "Instagram", department_id: D.ogv, stage: "applied" },
    { id: id(14, 3), name: "Hana Kim", email: "hana@preview.example", source: "Referral", department_id: null, stage: "offer" },
  ].map((r) => ({ ...r, project_id: lc, phone: null, interview_at: null, notes: null, owner_id: null, applied_on: day(now, -5), created_by: me, created_at: iso, updated_at: iso }));

  const onboarding_steps = ["Meet your VP", "Join the LC chat", "Read the LC handbook", "Attend your first LC meeting", "Do your first check-in"]
    .map((title, i) => ({ id: id(15, i + 1), project_id: lc, title, description: null, department_id: null, sort_order: i + 1, created_at: iso }));
  const member_onboarding = [{ project_id: lc, user_id: uid(7), step_id: id(15, 1), done_at: iso, done_by: uid(7) }];

  const finance_categories = ["Conferences", "Events", "Marketing", "Merchandise", "Transport", "Food", "Sponsorship", "Membership fees", "Other"]
    .map((name, i) => ({ id: id(16, i + 1), project_id: lc, name, sort_order: i + 1, created_at: iso }));
  const finance_entries = [
    { id: id(17, 1), type: "income", amount: 450, entry_date: day(now, -30), category_id: id(16, 7), department_id: null, description: "Sponsorship: Demo Bank" },
    { id: id(17, 2), type: "expense", amount: 120, entry_date: day(now, -12), category_id: id(16, 3), department_id: D.mkt, description: "Posters for the info session" },
  ].map((e) => ({ ...e, project_id: lc, currency: "EUR", recorded_by: me, receipt_path: null, claim_id: null, created_at: iso, updated_at: iso }));

  const drive_folders = ["Templates", "Brand kit", "Job descriptions", "Important links"]
    .map((name, i) => ({ id: id(18, i + 1), project_id: lc, name, sort_order: i + 1, created_by: null, created_at: iso }));
  const bookmarks = [
    { id: id(19, 1), folder_id: id(18, 2), title: "AIESEC brand guidelines", url: "https://aiesec.org" },
    { id: id(19, 2), folder_id: id(18, 1), title: "Partnership proposal template", url: "https://example.com/proposal" },
  ].map((b) => ({ ...b, project_id: lc, scope: "lab", sub_project_id: null, kind: "link", storage_path: null, file_name: null, mime_type: null, size_bytes: null, added_by: me, added_at: iso }));

  const outreach_templates = [
    { id: id(20, 1), name: "oGV sign-up: day 0", subject: "Hi {first_name}, your {product} experience", body: "Hi {first_name},\n\nI'm {sender_name} from {lc_name}. I saw you signed up for {product}; when would suit you for a 10-minute call?\n\n{sender_name}", status: "approved" },
    { id: id(20, 2), name: "oGV sign-up: day 3", subject: "Still thinking about {product}?", body: "Hi {first_name},\n\nJust checking in. Happy to answer any questions.\n\n{sender_name}", status: "pending" },
  ].map((t) => ({ ...t, project_id: lc, department_id: D.ogv, review_note: null, created_by: uid(5), approved_by: null, approved_at: null, created_at: iso, updated_at: iso }));

  const lab_wins = [{ id: id(21, 1), project_id: lc, author_id: uid(2), content: "Two oGV approvals this week! 🎉", created_at: at(now, -1, 16) }];
  const handover_notes = [{ id: id(22, 1), project_id: lc, department_id: null, term_label: `${termStart.slice(0, 4)}/${String((Number(termStart.slice(0, 4)) + 1) % 100).padStart(2, "0")}`, title: "LC-wide handover", body: "## Open items and deadlines\n- Demo Bank contract renews in March.\n", updated_by: me, created_at: iso, updated_at: iso }];

  const projects = [{
    id: lc, name: "Demo LC (sample data)", institution: "Demo University", owner_id: me, created_at: iso, is_demo: true,
    currency: "EUR", term_start_date: null, checkin_period_weeks: 2, min_wellbeing_respondents: 3, min_exec_respondents: 3,
    checkin_disabled_questions: [], email_sender_name: null, mc_id: null, support_invitation: null, active_prompt_ids: ["jp2", "jp7", "jp11"], custom_prompts: [],
  }];
  const lab_roles = (["president", "vp", "member"] as const).map((r) => ({ id: ROLE_IDS[r], project_id: lc, name: r === "president" ? "President" : r === "vp" ? "VP" : "Member", permission_level: r, is_system: true, created_at: iso }));
  const user_settings = [{ user_id: me, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, wellbeing_opted_in: true, email_mode: "all", notif_task_assigned: true, notif_lab_win: true, notif_digest: false, updated_at: iso }];

  return {
    projects, departments, lab_roles, user_profiles, team_members, user_settings, exchanges, tasks, task_assignees, reminders,
    lc_events, event_attendance, event_rsvps, tabling_slots, tabling_signups, goals, partners, partner_contacts, partner_activities: [],
    recruits, onboarding_steps, member_onboarding, finance_categories, finance_entries, expense_claims: [], drive_folders, bookmarks,
    outreach_templates, outreach_sequences: [], outreach_steps: [], outreach_enrollments: [], outreach_messages: [],
    lab_wins, opportunities: [], handover_notes, checkins: [], journal_entries: [], notifications: [], activity_feed: [],
    sub_projects: [], sub_project_members: [], invite_codes: [], chat_messages: [], chat_read_state: [], message_reactions: [],
    support_resources: [], announcements: [], event_invitees: [], mcs: [], mc_members: [], email_log: [],
  };
}

/** Wellbeing series for the dashboard cards: 8 periods, made-up averages above the threshold. */
export function previewPulseRows(periodStarts: string[], groups: (string | null)[], seed = 0): Row[] {
  const questions = ["energy", "workload", "purpose", "support", "belonging", "balance"];
  return groups.flatMap((g, gi) => periodStarts.flatMap((p, pi) => questions.map((q, qi) => ({
    department_id: g, period_start: p, question_id: q,
    avg_score: Math.round((3.4 + ((pi * 7 + qi * 3 + gi * 5 + seed) % 9) / 10) * 100) / 100,
    respondent_count: 4 + gi, suppressed: false,
  }))));
}
