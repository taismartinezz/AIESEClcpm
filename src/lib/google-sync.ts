// Server-side only. LC events in members' own Google Calendars (primary
// calendar), with each person's own token. See migration 20261109001.

import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_NAME } from "@/lib/brand";
import { APP_URL } from "@/lib/email";
import { accessTokenFor } from "@/lib/google-server";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const EVENT_COLS = "id, project_id, name, starts_on, ends_on, starts_at, ends_at, location, meeting_url, description";

export interface SyncEvent {
  id: string; project_id: string; name: string; starts_on: string; ends_on: string;
  starts_at: string | null; ends_at: string | null; location: string | null; meeting_url: string | null; description: string | null;
}

export interface SyncSummary { added: number; updated: number; removed: number; failed: number; errors: string[] }
const emptySummary = (): SyncSummary => ({ added: 0, updated: 0, removed: 0, failed: 0, errors: [] });

const nextDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

/** The Google Calendar event for an LC event (an all-day event ends the day after, as Google expects). */
export function googleEventBody(ev: SyncEvent, lcName: string, appUrl = APP_URL) {
  const link = `${appUrl}/attendance`;
  const timed = Boolean(ev.starts_at);
  const end = ev.ends_at ?? (ev.starts_at ? new Date(new Date(ev.starts_at).getTime() + 3_600_000).toISOString() : null);
  return {
    summary: ev.name,
    ...(ev.location ? { location: ev.location } : {}),
    description: [ev.description, ev.meeting_url ? `Join online: ${ev.meeting_url}` : null, `${lcName} · ${APP_NAME}: ${link}`]
      .filter(Boolean).join("\n\n"),
    start: timed ? { dateTime: ev.starts_at } : { date: ev.starts_on },
    end: timed ? { dateTime: end } : { date: nextDay(ev.ends_on) },
    source: { title: APP_NAME, url: link },
    extendedProperties: { private: { lcEventId: ev.id } },
  };
}

/** People who connected Google with permission to add events and left the switch on. */
async function writers(db: SupabaseClient, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const { data } = await db.from("google_connections").select("user_id, scope, add_events").in("user_id", userIds);
  return new Set((data ?? []).filter((c) => c.add_events && String(c.scope ?? "").includes("calendar.events")).map((c) => c.user_id as string));
}

async function google(token: string, method: string, url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
}

async function removeFor(db: SupabaseClient, userId: string, eventId: string, googleEventId: string, s: SyncSummary) {
  const tok = await accessTokenFor(db, userId);
  if ("token" in tok) {
    const res = await google(tok.token, "DELETE", `${EVENTS_URL}/${encodeURIComponent(googleEventId)}`);
    // Already gone (deleted by hand in Google) is fine.
    if (!res.ok && res.status !== 404 && res.status !== 410) { s.failed++; s.errors.push(`remove for ${userId}: Google answered ${res.status}`); return; }
  }
  await db.from("google_event_links").delete().eq("user_id", userId).eq("event_id", eventId);
  s.removed++;
}

/**
 * Bring one LC event in line in everyone's Google Calendar: add or update it
 * for its audience (minus "Not going"), remove it for anyone else who had it,
 * and for everyone when the event was deleted.
 */
export async function syncEventToGoogle(db: SupabaseClient, eventId: string, onlyUser?: string): Promise<SyncSummary> {
  const s = emptySummary();
  const [{ data: ev }, { data: links }] = await Promise.all([
    db.from("lc_events").select(EVENT_COLS).eq("id", eventId).maybeSingle(),
    db.from("google_event_links").select("user_id, google_event_id").eq("event_id", eventId),
  ]);
  const linked = new Map(((links ?? []) as { user_id: string; google_event_id: string }[]).map((l) => [l.user_id, l.google_event_id]));

  let wanted = new Set<string>();
  let event: SyncEvent | null = null;
  let lcName = "Your LC";
  if (ev) {
    event = ev as SyncEvent;
    const [aud, rsvps, lc] = await Promise.all([
      db.rpc("event_audience", { p_event_id: eventId }),
      db.from("event_rsvps").select("user_id").eq("event_id", eventId).eq("response", "not_going"),
      db.from("projects").select("name").eq("id", event.project_id).maybeSingle(),
    ]);
    if (aud.error) throw new Error(aud.error.message);
    lcName = (lc.data?.name as string) ?? lcName;
    const notGoing = new Set((rsvps.data ?? []).map((r) => r.user_id as string));
    const audience = ((aud.data ?? []) as unknown[]).map((r) => (typeof r === "string" ? r : (r as { event_audience: string }).event_audience))
      .filter((u) => !notGoing.has(u));
    wanted = await writers(db, audience);
  }
  if (onlyUser) {
    wanted = new Set([...wanted].filter((u) => u === onlyUser));
    for (const u of [...linked.keys()]) if (u !== onlyUser) linked.delete(u);
  }

  // Remove where it no longer belongs.
  for (const [userId, googleId] of linked) {
    if (!wanted.has(userId)) await removeFor(db, userId, eventId, googleId, s);
  }
  if (!event) return s;

  // Add or update for everyone who should have it.
  const body = googleEventBody(event, lcName);
  for (const userId of wanted) {
    const tok = await accessTokenFor(db, userId);
    if ("reconnect" in tok) { s.failed++; s.errors.push(`${userId}: ${tok.reconnect}`); continue; }
    const existing = linked.get(userId);
    let res = existing ? await google(tok.token, "PATCH", `${EVENTS_URL}/${encodeURIComponent(existing)}`, body) : null;
    // Never added, or deleted by hand in Google: add it (again).
    if (!res || res.status === 404 || res.status === 410) res = await google(tok.token, "POST", EVENTS_URL, body);
    if (!res.ok) { s.failed++; s.errors.push(`${userId}: Google answered ${res.status}`); continue; }
    const created = await res.json() as { id: string; status?: string };
    if (created.status === "cancelled") {
      // A PATCH on an event deleted by hand can "succeed" as cancelled: add a fresh one.
      const again = await google(tok.token, "POST", EVENTS_URL, body);
      if (!again.ok) { s.failed++; s.errors.push(`${userId}: Google answered ${again.status}`); continue; }
      Object.assign(created, await again.json());
    }
    await db.from("google_event_links").upsert({ user_id: userId, event_id: eventId, google_event_id: created.id, synced_at: new Date().toISOString() }, { onConflict: "user_id,event_id" });
    if (existing && created.id === existing) s.updated++; else s.added++;
  }
  return s;
}

/** Someone just connected (or switched it on): add their upcoming events. */
export async function syncUpcomingForUser(db: SupabaseClient, userId: string, now = new Date()): Promise<SyncSummary> {
  const total = emptySummary();
  const { data: lcs } = await db.from("team_members").select("project_id").eq("user_id", userId);
  const projects = (lcs ?? []).map((m) => m.project_id as string);
  if (!projects.length) return total;
  const today = now.toISOString().slice(0, 10);
  const { data: events } = await db.from("lc_events").select("id").in("project_id", projects).gte("ends_on", today).limit(100);
  for (const e of events ?? []) {
    const s = await syncEventToGoogle(db, e.id as string, userId);
    total.added += s.added; total.updated += s.updated; total.removed += s.removed; total.failed += s.failed;
    total.errors.push(...s.errors);
  }
  total.errors = total.errors.slice(0, 20);
  return total;
}

/** Daily safety net: events changed in the last day that haven't ended. */
export async function syncRecentEvents(db: SupabaseClient, now = new Date()): Promise<SyncSummary> {
  const total = emptySummary();
  const since = new Date(now.getTime() - 26 * 3_600_000).toISOString();
  const { data: events } = await db.from("lc_events").select("id").gte("updated_at", since).gte("ends_on", now.toISOString().slice(0, 10)).limit(200);
  for (const e of events ?? []) {
    try {
      const s = await syncEventToGoogle(db, e.id as string);
      total.added += s.added; total.updated += s.updated; total.removed += s.removed; total.failed += s.failed;
      total.errors.push(...s.errors);
    } catch (err) {
      total.failed++; total.errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  total.errors = total.errors.slice(0, 20);
  return total;
}
