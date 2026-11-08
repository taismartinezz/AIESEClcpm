// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/google-server", () => ({
  accessTokenFor: vi.fn(async (_db: unknown, userId: string) => (userId === "expired" ? { reconnect: "Connect again." } : { token: `tok-${userId}` })),
}));

import { googleEventBody, syncEventToGoogle, type SyncEvent } from "@/lib/google-sync";

// ── A tiny stand-in for the Supabase client: just what google-sync uses ──────
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>, audience: string[]) {
  const query = (name: string) => {
    let rows = [...(tables[name] ??= [])];
    let op: "select" | "delete" | "update" = "select";
    let patch: Row = {};
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q; },
      gte: () => q, limit: () => q,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      delete: () => { op = "delete"; return q; },
      update: (p: Row) => { op = "update"; patch = p; return q; },
      upsert: async (row: Row) => {
        const t = tables[name];
        const i = t.findIndex((r) => r.user_id === row.user_id && r.event_id === row.event_id);
        if (i >= 0) t[i] = { ...t[i], ...row }; else t.push(row);
        return { error: null };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => void) => {
        if (op === "delete") tables[name] = tables[name].filter((r) => !rows.includes(r));
        if (op === "update") rows.forEach((r) => Object.assign(r, patch));
        resolve({ data: rows, error: null });
      },
    };
    return q;
  };
  return { from: query, rpc: async () => ({ data: audience, error: null }) } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

// ── Google: record calls, answer like Calendar v3 ───────────────────────────
let calls: { method: string; url: string; auth: string; body?: Row }[] = [];
let missing = new Set<string>();          // Google event ids deleted by hand
let nextId = 1;
beforeEach(() => {
  calls = []; missing = new Set(); nextId = 1;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) as Row : undefined;
    calls.push({ method, url, auth: String((init.headers as Record<string, string>).Authorization), body });
    const id = url.split("/events/")[1];
    if (id && missing.has(decodeURIComponent(id))) return new Response("", { status: 404 });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ id: method === "POST" ? `g${nextId++}` : decodeURIComponent(id), status: "confirmed" });
  }));
});

const EVENT: SyncEvent = {
  id: "ev1", project_id: "lc1", name: "General Assembly", starts_on: "2026-11-20", ends_on: "2026-11-20",
  starts_at: "2026-11-20T18:00:00Z", ends_at: "2026-11-20T20:00:00Z", location: "Room 2", meeting_url: "https://meet.example/x", description: "Agenda inside",
};
const conn = (user_id: string, over: Row = {}) => ({ user_id, scope: "openid https://www.googleapis.com/auth/calendar.events", add_events: true, ...over });

describe("the Google Calendar event", () => {
  it("carries the time, place, link and a pointer back to the app", () => {
    const b = googleEventBody(EVENT, "AIESEC in Lisbon", "https://app.example");
    expect(b.start).toEqual({ dateTime: "2026-11-20T18:00:00Z" });
    expect(b.end).toEqual({ dateTime: "2026-11-20T20:00:00Z" });
    expect(b.location).toBe("Room 2");
    expect(b.description).toContain("Join online: https://meet.example/x");
    expect(b.description).toContain("https://app.example/attendance");
    expect(b.extendedProperties.private.lcEventId).toBe("ev1");
  });
  it("is all-day without a time, ending the day after (as Google expects)", () => {
    const b = googleEventBody({ ...EVENT, starts_at: null, ends_at: null, starts_on: "2026-12-01", ends_on: "2026-12-03" }, "LC");
    expect(b.start).toEqual({ date: "2026-12-01" });
    expect(b.end).toEqual({ date: "2026-12-04" });
  });
});

describe("keeping an LC event in line in Google Calendars", () => {
  it("adds it for the audience who connected with permission and left the switch on, each with their own token", async () => {
    const tables = {
      lc_events: [EVENT as unknown as Row], projects: [{ id: "lc1", name: "AIESEC in Lisbon" }], event_rsvps: [],
      google_connections: [conn("ana"), conn("bo", { add_events: false }), conn("cy", { scope: "calendar.readonly" })],
      google_event_links: [],
    };
    const s = await syncEventToGoogle(fakeDb(tables, ["ana", "bo", "cy", "dee"]), "ev1");
    expect(s).toMatchObject({ added: 1, updated: 0, removed: 0, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", auth: "Bearer tok-ana" });
    expect(tables.google_event_links).toEqual([expect.objectContaining({ user_id: "ana", event_id: "ev1", google_event_id: "g1" })]);
  });

  it("updates it in place next time, and adds it again if it was deleted by hand in Google", async () => {
    const tables = {
      lc_events: [EVENT as unknown as Row], projects: [], event_rsvps: [],
      google_connections: [conn("ana"), conn("bo")],
      google_event_links: [{ user_id: "ana", event_id: "ev1", google_event_id: "gA" }, { user_id: "bo", event_id: "ev1", google_event_id: "gB" }],
    };
    missing.add("gB");
    const s = await syncEventToGoogle(fakeDb(tables, ["ana", "bo"]), "ev1");
    expect(s).toMatchObject({ added: 1, updated: 1 });
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "PATCH", "POST"]);
    expect(tables.google_event_links.find((l) => l.user_id === "bo")?.google_event_id).toBe("g1");
  });

  it("removes it for people who said Not going or are no longer invited, and for everyone when it's deleted", async () => {
    const links = () => [{ user_id: "ana", event_id: "ev1", google_event_id: "gA" }, { user_id: "bo", event_id: "ev1", google_event_id: "gB" }, { user_id: "cy", event_id: "ev1", google_event_id: "gC" }];
    const tables = {
      lc_events: [EVENT as unknown as Row], projects: [], event_rsvps: [{ event_id: "ev1", user_id: "bo", response: "not_going" }],
      google_connections: [conn("ana"), conn("bo"), conn("cy")], google_event_links: links(),
    };
    const s = await syncEventToGoogle(fakeDb(tables, ["ana", "bo"]), "ev1");          // cy left the audience
    expect(s).toMatchObject({ removed: 2, updated: 1 });
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url.split("/events/")[1]).sort()).toEqual(["gB", "gC"]);
    expect(tables.google_event_links.map((l) => l.user_id)).toEqual(["ana"]);

    calls = [];
    const gone = { lc_events: [], projects: [], event_rsvps: [], google_connections: [conn("ana")], google_event_links: [{ user_id: "ana", event_id: "ev1", google_event_id: "gA" }] };
    const d = await syncEventToGoogle(fakeDb(gone, []), "ev1");
    expect(d).toMatchObject({ removed: 1 });
    expect(calls).toEqual([expect.objectContaining({ method: "DELETE" })]);
    expect(gone.google_event_links).toEqual([]);
  });

  it("reports people whose Google access expired instead of failing everyone", async () => {
    const tables = {
      lc_events: [EVENT as unknown as Row], projects: [], event_rsvps: [],
      google_connections: [conn("ana"), conn("expired")], google_event_links: [],
    };
    const s = await syncEventToGoogle(fakeDb(tables, ["ana", "expired"]), "ev1");
    expect(s).toMatchObject({ added: 1, failed: 1 });
    expect(s.errors[0]).toContain("Connect again");
  });
});
