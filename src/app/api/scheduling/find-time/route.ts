import { requireAuth } from "@/lib/api-auth";
import { serviceClient } from "@/lib/server-db";
import { accessTokenFor } from "@/lib/google-server";
import { gridToIntervals, isValidTimeZone, zonedToUtc, type Interval } from "@/lib/availability";
import { findTimes, type PersonAvailability, type Source } from "@/lib/find-time";

// POST /api/scheduling/find-time { projectId, userIds, durationMinutes, days?, timeZone? }
// The best times for the caller and userIds to meet. Each person's busy times
// come from their Google Calendar (free/busy only: no titles or details are
// read), otherwise from their weekly availability grid; LC events and pending
// meetings count too. Only "free / busy / unknown" per person leaves the server.

const LAB_ZERO = "00000000-0000-0000-0000-000000000000";
const DAY = 86_400_000;

function localToMs(date: string, hhmm: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return zonedToUtc(y, m, d, h * 60 + min, tz);
}

async function googleBusy(token: string, from: number, to: number): Promise<Interval[] | null> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: "primary" }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const body = await res.json() as { calendars?: { primary?: { busy?: { start: string; end: string }[]; errors?: unknown[] } } };
  const cal = body.calendars?.primary;
  if (!cal || cal.errors?.length) return null;
  return (cal.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
}

export async function POST(request: Request) {
  const callerId = await requireAuth(request);
  if (!callerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server" }, { status: 503 });

  const body = await request.json().catch(() => ({})) as { projectId?: string; userIds?: string[]; durationMinutes?: number; days?: number; timeZone?: string };
  const duration = Number(body.durationMinutes);
  const others = Array.isArray(body.userIds) ? [...new Set(body.userIds.filter((x) => typeof x === "string"))] : [];
  if (!body.projectId || !others.length || others.length > 30 || !(duration >= 15 && duration <= 480)) {
    return Response.json({ error: "Pick 1–30 people and a length between 15 minutes and 8 hours." }, { status: 400 });
  }
  const ids = [callerId, ...others.filter((x) => x !== callerId)];

  // Everyone, the caller included, must be in this LC.
  const { data: members } = await db.from("team_members").select("user_id").eq("project_id", body.projectId).in("user_id", ids);
  if ((members ?? []).length !== ids.length) return Response.json({ error: "Everyone has to be in this LC." }, { status: 403 });

  const { data: settings } = await db.from("user_settings").select("user_id, timezone").in("user_id", ids);
  const tzOf = new Map((settings ?? []).map((s) => [s.user_id as string, s.timezone as string]));
  const zone = (id: string) => { const z = tzOf.get(id); return isValidTimeZone(z) ? z : null; };
  const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : zone(callerId) ?? "UTC";

  // From the next half hour at least an hour away, for `days` days.
  const from = Math.ceil((Date.now() + 3_600_000) / 1_800_000) * 1_800_000;
  const to = from + Math.min(Math.max(Number(body.days) || 14, 1), 31) * DAY;
  const fromDate = new Date(from - DAY).toISOString().slice(0, 10);
  const toDate = new Date(to + DAY).toISOString().slice(0, 10);

  const [{ data: grids }, { data: conns }, { data: events }, { data: meetings }] = await Promise.all([
    db.from("user_availability").select("user_id, slots").eq("project_id", body.projectId).eq("sub_project_id", LAB_ZERO).in("user_id", ids),
    db.from("google_connections").select("user_id").in("user_id", ids),
    db.from("schedule_events").select("date, time, end_time, scope, created_by").eq("project_id", body.projectId).not("time", "is", null).gte("date", fromDate).lte("date", toDate),
    db.from("meeting_proposals").select("proposer_id, invitee_ids, proposed_date, proposed_time, duration_minutes, responses").eq("project_id", body.projectId).gte("proposed_date", fromDate).lte("proposed_date", toDate),
  ]);

  // App commitments. LC-wide events make everyone busy; personal ones only their owner.
  const appBusy = new Map<string, Interval[]>(ids.map((id) => [id, []]));
  const addBusy = (id: string, iv: Interval) => appBusy.get(id)?.push(iv);
  for (const e of events ?? []) {
    const tz = zone(e.created_by as string) ?? timeZone;
    const start = localToMs(e.date as string, (e.time as string).slice(0, 5), tz);
    const end = e.end_time ? localToMs(e.date as string, (e.end_time as string).slice(0, 5), tz) : start + 3_600_000;
    if (e.scope === "personal") addBusy(e.created_by as string, { start, end });
    else ids.forEach((id) => addBusy(id, { start, end }));
  }
  for (const mtg of meetings ?? []) {
    const tz = zone(mtg.proposer_id as string) ?? timeZone;
    const start = localToMs(mtg.proposed_date as string, mtg.proposed_time as string, tz);
    const iv = { start, end: start + (mtg.duration_minutes as number) * 60_000 };
    const declined = new Set(((mtg.responses as { userId: string; status: string }[]) ?? []).filter((r) => r.status === "declined").map((r) => r.userId));
    for (const id of [mtg.proposer_id as string, ...((mtg.invitee_ids as string[]) ?? [])]) if (!declined.has(id)) addBusy(id, iv);
  }

  const gridOf = new Map((grids ?? []).map((g) => [g.user_id as string, (g.slots as string[]) ?? []]));
  const connected = new Set((conns ?? []).map((c) => c.user_id as string));
  const people: PersonAvailability[] = await Promise.all(ids.map(async (id) => {
    const busy = appBusy.get(id) ?? [];
    if (connected.has(id)) {
      const tok = await accessTokenFor(db, id);
      const g = "token" in tok ? await googleBusy(tok.token, from, to).catch(() => null) : null;
      if (g) return { id, source: "google" as Source, busy: [...busy, ...g] };
    }
    const slots = gridOf.get(id) ?? [];
    if (slots.length) return { id, source: "grid" as Source, busy, free: gridToIntervals(slots, zone(id) ?? timeZone, from, to) };
    return { id, source: "none" as Source, busy };
  }));

  const suggestions = findTimes(people, { durationMin: duration, from, to, timeZone });
  return Response.json({
    timeZone,
    sources: Object.fromEntries(people.map((p) => [p.id, p.source])),
    suggestions: suggestions.map((s) => ({ ...s, start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() })),
  });
}
