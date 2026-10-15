// Server-side only (service role). Sends member emails: event invites and
// reminders, task and check-in reminders, the weekly digest and announcements.
// Every email is "claimed" in email_log before it is sent, so re-running the
// job never sends anything twice; a failed send releases the claim.

import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL, sendEmail, type EmailPayload } from "@/lib/email";
import { buildIcs } from "@/lib/ics";
import { rsvpToken } from "@/lib/rsvp-token";
import { runOutreach } from "@/lib/outreach-server";
import { periodStart, type CheckinCadence } from "@/lib/wellbeing";
import {
  checkinEmailDue, digestWeek, eventReminderDue, reminderRecipients, taskEmailsDue, wantsEmail,
  type EmailKind, type EmailMode,
} from "@/lib/reminders";
import {
  buildAnnouncementEmail, buildCheckinEmail, buildEventEmail, buildTasksEmail, buildWeeklyDigest, type EventForEmail,
} from "@/lib/member-emails";

const PACE_MS = 200;   // Resend's free tier allows ~2/s; spread sends out
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

export interface SendSummary { sent: number; skipped: number; failed: number; errors: string[] }
const emptySummary = (): SendSummary => ({ sent: 0, skipped: 0, failed: 0, errors: [] });

/** Per-run cache of people's emails, names and email preferences. */
export class Mailer {
  private emails = new Map<string, string | null>();
  private names = new Map<string, string>();
  private modes = new Map<string, EmailMode>();
  readonly summary = emptySummary();
  constructor(private db: SupabaseClient) {}

  async load(userIds: string[]) {
    const missing = [...new Set(userIds)].filter((id) => !this.names.has(id));
    if (!missing.length) return;
    const [profiles, settings] = await Promise.all([
      this.db.from("user_profiles").select("id, name").in("id", missing),
      this.db.from("user_settings").select("user_id, email_mode").in("user_id", missing),
    ]);
    for (const r of profiles.data ?? []) this.names.set(r.id as string, (r.name as string) || "there");
    for (const r of settings.data ?? []) this.modes.set(r.user_id as string, r.email_mode as EmailMode);
    for (const id of missing) if (!this.names.has(id)) this.names.set(id, "there");
  }

  name(id: string) { return this.names.get(id) ?? "there"; }

  async email(id: string): Promise<string | null> {
    if (!this.emails.has(id)) {
      const { data } = await this.db.auth.admin.getUserById(id);
      this.emails.set(id, data?.user?.email ?? null);
    }
    return this.emails.get(id) ?? null;
  }

  /** Claim, send, and release the claim if sending failed. */
  async send(kind: EmailKind, refId: string, userId: string, build: (to: string, name: string) => EmailPayload): Promise<boolean> {
    if (!wantsEmail(this.modes.get(userId), kind)) { this.summary.skipped++; return false; }
    const to = await this.email(userId);
    if (!to) { this.summary.skipped++; return false; }
    const { error: claimErr } = await this.db.from("email_log").insert({ kind, ref_id: refId, user_id: userId });
    if (claimErr) {
      if (claimErr.code === "23505") { this.summary.skipped++; return false; }   // already sent
      this.fail(`${kind} ${refId}: ${claimErr.message}`);
      return false;
    }
    const result = await sendEmail(build(to, this.name(userId)));
    await sleep(PACE_MS);
    if (!result.ok) {
      await this.db.from("email_log").delete().match({ kind, ref_id: refId, user_id: userId });
      this.fail(`${kind} ${refId}: ${result.error ?? "send failed"}`);
      return false;
    }
    this.summary.sent++;
    return true;
  }

  fail(msg: string) {
    this.summary.failed++;
    if (this.summary.errors.length < 20) this.summary.errors.push(msg);
  }
}

async function lcInfo(db: SupabaseClient, projectId: string) {
  const { data } = await db.from("projects").select("name, email_sender_name").eq("id", projectId).maybeSingle();
  return { name: (data?.name as string) ?? "your LC", sender: (data?.email_sender_name as string | null) ?? (data?.name as string) ?? undefined };
}

const EVENT_COLS = "id, project_id, name, starts_on, ends_on, starts_at, ends_at, location, meeting_url, description, created_by";
type EventRow = EventForEmail & { project_id: string; created_by: string | null };

async function audienceOf(db: SupabaseClient, eventId: string): Promise<string[]> {
  const { data, error } = await db.rpc("event_audience", { p_event_id: eventId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map((r) => (typeof r === "string" ? r : (r as { event_audience: string }).event_audience));
}

function rsvpLinks(eventId: string, userId: string) {
  const t = rsvpToken(eventId, userId);
  const base = `${APP_URL}/api/rsvp?e=${encodeURIComponent(eventId)}&u=${encodeURIComponent(userId)}&t=${encodeURIComponent(t)}`;
  return { going: `${base}&a=going`, notGoing: `${base}&a=not_going` };
}

// ── Event invites (on demand) ────────────────────────────────────────────────

export async function sendEventInvites(db: SupabaseClient, eventId: string): Promise<SendSummary> {
  const mailer = new Mailer(db);
  const { data: ev, error } = await db.from("lc_events").select(EVENT_COLS).eq("id", eventId).maybeSingle();
  if (error || !ev) throw new Error(error?.message ?? "Event not found");
  const event = ev as EventRow;
  const lc = await lcInfo(db, event.project_id);
  const audience = await audienceOf(db, eventId);
  await mailer.load([...audience, ...(event.created_by ? [event.created_by] : [])]);
  const organizer = event.created_by ? await mailer.email(event.created_by) : null;
  const ics = buildIcs({
    uid: `${event.id}@aiesec-lcpm`, title: event.name, description: event.description, location: event.location,
    url: event.meeting_url, startsAt: event.starts_at, endsAt: event.ends_at, startsOn: event.starts_on, endsOn: event.ends_on,
    organizerName: lc.sender,
  });
  for (const uid of audience) {
    await mailer.send("event_invite", eventId, uid, (to, name) => buildEventEmail({
      to, recipientName: name, lcName: lc.name, ev: event, kind: "invite", rsvp: rsvpLinks(eventId, uid), ics,
      fromName: lc.sender, replyTo: organizer ?? undefined,
    }));
  }
  await db.from("lc_events").update({ invites_sent_at: new Date().toISOString() }).eq("id", eventId);
  return mailer.summary;
}

// ── Announcements (on demand) ────────────────────────────────────────────────

export async function sendAnnouncement(db: SupabaseClient, announcementId: string): Promise<SendSummary> {
  const mailer = new Mailer(db);
  const { data: a, error } = await db.from("announcements").select("*").eq("id", announcementId).maybeSingle();
  if (error || !a) throw new Error(error?.message ?? "Announcement not found");
  const { data: members } = await db.from("team_members").select("user_id, role, department_id").eq("project_id", a.project_id);
  let vpOf: string | null = null;
  if (a.audience === "department" && a.department_id) {
    const { data: dep } = await db.from("departments").select("vp_user_id").eq("id", a.department_id).maybeSingle();
    vpOf = (dep?.vp_user_id as string | null) ?? null;
  }
  const audience = (members ?? []).filter((m) =>
    a.audience === "lc" ? true
      : a.audience === "department" ? m.department_id === a.department_id || m.user_id === vpOf
      : a.audience_role === "exec" ? ["president", "vp"].includes(m.role as string) : m.role === a.audience_role,
  ).map((m) => m.user_id as string);
  const lc = await lcInfo(db, a.project_id as string);
  await mailer.load([...audience, ...(a.author_id ? [a.author_id as string] : [])]);
  const authorEmail = a.author_id ? await mailer.email(a.author_id as string) : null;
  for (const uid of audience) {
    await mailer.send("announcement", announcementId, uid, (to, name) => buildAnnouncementEmail({
      to, recipientName: name, subject: a.subject as string, body: a.body as string,
      authorName: a.author_id ? mailer.name(a.author_id as string) : lc.name, fromName: lc.sender, replyTo: authorEmail ?? undefined,
    }));
  }
  await db.from("announcements").update({ sent_at: new Date().toISOString(), sent_count: mailer.summary.sent }).eq("id", announcementId);
  return mailer.summary;
}

// ── Scheduled job ────────────────────────────────────────────────────────────

export async function runEventReminders(db: SupabaseClient, mailer: Mailer, now: Date) {
  const { data, error } = await db.from("lc_events").select(EVENT_COLS)
    .gte("starts_on", isoDay(now)).lte("starts_on", isoDay(addDays(now, 2)));
  if (error) { mailer.fail(`events: ${error.message}`); return; }
  for (const ev of (data ?? []) as EventRow[]) {
    const kind = eventReminderDue(ev, now);
    if (!kind) continue;
    try {
      const [audience, rsvps] = await Promise.all([
        audienceOf(db, ev.id),
        db.from("event_rsvps").select("user_id, response").eq("event_id", ev.id),
      ]);
      const recipients = reminderRecipients(audience, (rsvps.data ?? []) as { user_id: string; response: string }[]);
      const lc = await lcInfo(db, ev.project_id);
      await mailer.load(recipients);
      for (const uid of recipients) {
        await mailer.send(kind, ev.id, uid, (to, name) => buildEventEmail({
          to, recipientName: name, lcName: lc.name, ev, kind: kind === "event_24h" ? "24h" : "1h", rsvp: rsvpLinks(ev.id, uid), fromName: lc.sender,
        }));
      }
    } catch (e) {
      mailer.fail(`event ${ev.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export async function runTaskEmails(db: SupabaseClient, mailer: Mailer, now: Date) {
  const { data, error } = await db.from("tasks")
    .select("id, title, due_date, project_id, department_id, task_assignees(user_id)")
    .neq("status", "done").eq("archived", false)
    .gte("due_date", isoDay(addDays(now, -30))).lte("due_date", isoDay(addDays(now, 1)));
  if (error) { mailer.fail(`tasks: ${error.message}`); return; }
  type T = { id: string; title: string; due_date: string; project_id: string; department_id: string | null; task_assignees: { user_id: string }[] };
  const tasks = (data ?? []) as T[];
  const deptIds = [...new Set(tasks.map((t) => t.department_id).filter(Boolean))] as string[];
  const { data: deps } = deptIds.length ? await db.from("departments").select("id, vp_user_id").in("id", deptIds) : { data: [] };
  const vpOf = new Map((deps ?? []).map((d) => [d.id as string, d.vp_user_id as string | null]));

  const groups = new Map<string, { kind: "task_due" | "task_overdue" | "task_overdue_vp"; user: string; tasks: T[] }>();
  const add = (kind: "task_due" | "task_overdue" | "task_overdue_vp", user: string, t: T) => {
    const key = `${kind}:${user}`;
    const g = groups.get(key) ?? { kind, user, tasks: [] };
    g.tasks.push(t);
    groups.set(key, g);
  };
  for (const t of tasks) {
    const when = taskEmailsDue(t.due_date, now);
    for (const a of t.task_assignees ?? []) {
      if (when.due) add("task_due", a.user_id, t);
      if (when.overdue) add("task_overdue", a.user_id, t);
    }
    const vp = t.department_id ? vpOf.get(t.department_id) : null;
    if (when.escalate && vp) add("task_overdue_vp", vp, t);
  }
  await mailer.load([...[...groups.values()].map((g) => g.user), ...tasks.flatMap((t) => t.task_assignees.map((a) => a.user_id))]);
  for (const g of groups.values()) {
    // One email per person per kind, listing every task not emailed about yet.
    const fresh: T[] = [];
    for (const t of g.tasks) {
      const { data: seen } = await db.from("email_log").select("ref_id").match({ kind: g.kind, ref_id: t.id, user_id: g.user }).maybeSingle();
      if (!seen) fresh.push(t);
    }
    if (!fresh.length) continue;
    // At most one email per person per kind per day; the per-task rows below stop repeats.
    const ok = await mailer.send(g.kind, `day:${isoDay(now)}`, g.user, (to, name) => buildTasksEmail({
      to, recipientName: name, kind: g.kind === "task_due" ? "due" : g.kind === "task_overdue" ? "overdue" : "escalate",
      tasks: fresh.map((t) => ({ title: t.title, due: t.due_date, who: g.kind === "task_overdue_vp" ? t.task_assignees.map((a) => mailer.name(a.user_id)).join(", ") : undefined })),
    }));
    if (ok) await db.from("email_log").upsert(fresh.map((t) => ({ kind: g.kind, ref_id: t.id, user_id: g.user })), { ignoreDuplicates: true });
  }
}

export async function runCheckinEmails(db: SupabaseClient, mailer: Mailer, now: Date) {
  const { data: projects, error } = await db.from("projects").select("id, name, email_sender_name, checkin_period_weeks").eq("is_demo", false);
  if (error) { mailer.fail(`projects: ${error.message}`); return; }
  for (const proj of projects ?? []) {
    const cadence = ((proj.checkin_period_weeks as number) === 1 ? 1 : 2) as CheckinCadence;
    const start = periodStart(cadence, now);
    const kind = checkinEmailDue(start, cadence, now);
    if (!kind) continue;
    const { data: members } = await db.from("team_members").select("user_id").eq("project_id", proj.id).in("role", ["vp", "member"]);
    let ids = (members ?? []).map((m) => m.user_id as string);
    if (kind === "checkin_nudge") {
      const { data: done } = await db.from("checkins").select("user_id").eq("project_id", proj.id).eq("period_start", isoDay(start));
      const doneSet = new Set((done ?? []).map((d) => d.user_id as string));
      ids = ids.filter((id) => !doneSet.has(id));
    }
    await mailer.load(ids);
    const fromName = (proj.email_sender_name as string | null) ?? (proj.name as string);
    for (const uid of ids) {
      await mailer.send(kind, `${proj.id}:${isoDay(start)}`, uid, (to, name) => buildCheckinEmail({ to, recipientName: name, kind: kind === "checkin_open" ? "open" : "nudge", fromName }));
    }
  }
}

export async function runDigest(db: SupabaseClient, mailer: Mailer, now: Date, force = false) {
  const week = force ? isoDay(now) : digestWeek(now);
  if (!week) return;
  const weekEnd = isoDay(addDays(new Date(week + "T00:00:00Z"), 6));
  const { data: members, error } = await db.from("team_members").select("user_id, project_id, department_id, projects!inner(name, email_sender_name, is_demo)").eq("projects.is_demo", false);
  if (error) { mailer.fail(`digest: ${error.message}`); return; }
  type M = { user_id: string; project_id: string; department_id: string | null; projects: { name: string; email_sender_name: string | null } | { name: string; email_sender_name: string | null }[] };
  const rows = (members ?? []) as M[];
  await mailer.load(rows.map((m) => m.user_id));
  const byProject = new Map<string, { events: EventRow[]; wins: string[] }>();
  for (const m of rows) {
    const proj = Array.isArray(m.projects) ? m.projects[0] : m.projects;
    if (!byProject.has(m.project_id)) {
      const [ev, wins] = await Promise.all([
        db.from("lc_events").select(`${EVENT_COLS}, audience, department_id`).eq("project_id", m.project_id).gte("starts_on", week).lte("starts_on", weekEnd).order("starts_on"),
        db.from("lab_wins").select("content").eq("project_id", m.project_id).gte("created_at", addDays(new Date(week + "T00:00:00Z"), -7).toISOString()).limit(5),
      ]);
      byProject.set(m.project_id, { events: (ev.data ?? []) as EventRow[], wins: (wins.data ?? []).map((w) => w.content as string) });
    }
    const lcData = byProject.get(m.project_id)!;
    const events = lcData.events.filter((e) => {
      const x = e as EventRow & { audience?: string; department_id?: string | null };
      return x.audience !== "department" || x.department_id === m.department_id;
    });
    const { data: tasks } = await db.from("tasks").select("title, due_date, task_assignees!inner(user_id)")
      .eq("project_id", m.project_id).eq("task_assignees.user_id", m.user_id).neq("status", "done").eq("archived", false)
      .gte("due_date", week).lte("due_date", weekEnd).order("due_date");
    await mailer.send("digest", `${week}:${m.project_id}`, m.user_id, (to, name) => buildWeeklyDigest({
      to, recipientName: name, lcName: proj.name, fromName: proj.email_sender_name ?? proj.name,
      tasks: (tasks ?? []).map((t) => ({ title: t.title as string, due: t.due_date as string })), events, wins: lcData.wins,
    }));
  }
}

/** Everything the scheduled job does, in order. */
export async function runScheduledEmails(db: SupabaseClient, now = new Date()): Promise<SendSummary> {
  const mailer = new Mailer(db);
  await runEventReminders(db, mailer, now);
  await runTaskEmails(db, mailer, now);
  await runCheckinEmails(db, mailer, now);
  await runDigest(db, mailer, now);
  const outreach = await runOutreach(db, now);
  return {
    sent: mailer.summary.sent + outreach.sent, skipped: mailer.summary.skipped + outreach.skipped,
    failed: mailer.summary.failed + outreach.failed, errors: [...mailer.summary.errors, ...outreach.errors].slice(0, 20),
  };
}
