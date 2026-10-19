// Preview mode: when no Supabase project is configured, the app talks to this
// in-browser stand-in instead. It answers the same REST / RPC / auth calls as
// Supabase from the sample LC in ./data, so every page shows the same demo
// data and changes made while clicking around are visible everywhere until the
// page is reloaded. Nothing leaves the browser.
//
// It implements the subset of PostgREST the app uses: filters (eq, neq, gt,
// gte, lt, lte, like, ilike, is, in, cs, not.*, or/and), order, limit/range,
// embedded resources (incl. !inner), counts, single rows, insert / upsert /
// update / delete, plus the RPCs the pages call.

import { buildPreviewTables, previewPulseRows, PREVIEW_EMAIL, PREVIEW_LC_ID, PREVIEW_USER_ID, type Row, type Tables } from "./data";

export const PREVIEW_URL = "https://preview.aiesec-lcpm.invalid";
export const PREVIEW_STORAGE_KEY = "sb-preview-auth-token";
export const PREVIEW_SIGNED_OUT_KEY = "aiesec_preview_signed_out";

let db: Tables | null = null;
function tables(): Tables {
  if (!db) {
    db = buildPreviewTables();
    // Assignees live in task_assignees; embeds are computed on read.
    for (const t of db.tasks) delete t.task_assignees;
  }
  return db;
}
/** For tests: start from fresh sample data. */
export function resetPreviewData(now?: Date) {
  db = buildPreviewTables(now);
  for (const t of db.tasks) delete t.task_assignees;
}

export function previewSession() {
  const user = {
    id: PREVIEW_USER_ID, aud: "authenticated", role: "authenticated", email: PREVIEW_EMAIL,
    app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
  };
  return {
    access_token: "preview-access-token", token_type: "bearer", expires_in: 31_536_000,
    expires_at: Math.floor(Date.now() / 1000) + 31_536_000, refresh_token: "preview-refresh-token", user,
  };
}

// ── Responses ─────────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const pgError = (message: string, status = 400, code = "P0001") => json({ message, code, details: null, hint: null }, status);
export const NOT_IN_PREVIEW = "This isn't available in the preview, which uses sample data. Once your LC is connected to its database it works.";

// ── Relations for embedded selects ───────────────────────────────────────────

type Rel = { table: string; local: string; foreign: string; many: boolean };
const RELATIONS: Record<string, Record<string, Rel>> = {
  team_members: { user_profiles: { table: "user_profiles", local: "user_id", foreign: "id", many: false } },
  tasks: { task_assignees: { table: "task_assignees", local: "id", foreign: "task_id", many: true } },
  outreach_sequences: { outreach_steps: { table: "outreach_steps", local: "id", foreign: "sequence_id", many: true } },
  outreach_steps: { outreach_templates: { table: "outreach_templates", local: "template_id", foreign: "id", many: false } },
  tabling_signups: { tabling_slots: { table: "tabling_slots", local: "slot_id", foreign: "id", many: false } },
  partners: {
    partner_contacts: { table: "partner_contacts", local: "id", foreign: "partner_id", many: true },
    partner_activities: { table: "partner_activities", local: "id", foreign: "partner_id", many: true },
  },
};
const singular = (t: string) => (t.endsWith("ies") ? t.slice(0, -3) + "y" : t.endsWith("s") ? t.slice(0, -1) : t);

function relation(from: string, rel: string, sample: Row | undefined): Rel {
  const known = RELATIONS[from]?.[rel];
  if (known) return known;
  const fk = `${singular(rel)}_id`;
  if (sample && fk in sample) return { table: rel, local: fk, foreign: "id", many: false };
  if (rel === "user_profiles") return { table: rel, local: "user_id", foreign: "id", many: false };
  return { table: rel, local: "id", foreign: `${singular(from)}_id`, many: true };
}

// ── Select parsing ───────────────────────────────────────────────────────────

interface Embed { key: string; rel: string; inner: boolean; select: string }

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseEmbeds(select: string): Embed[] {
  return splitTop(select).flatMap((item) => {
    const m = item.match(/^(?:([a-z_]+):)?([a-z_]+)(?:!([a-z_]+))?\(([\s\S]*)\)$/);
    if (!m) return [];
    return [{ key: m[1] ?? m[2], rel: m[2], inner: m[3] === "inner", select: m[4] }];
  });
}

/** Plain columns asked for ("*", "col", "alias:col"); null = all columns. */
function plainColumns(select: string): [string, string][] | null {
  const items = splitTop(select).filter((i) => !i.includes("("));
  if (!items.length || items.includes("*")) return null;
  return items.map((i) => { const [a, b] = i.split(":"); return b ? [a, b] : [a, a]; });
}

function withEmbeds(table: string, rows: Row[], select: string | null, project = false): Row[] {
  if (!select) return rows.map((r) => ({ ...r }));
  const embeds = parseEmbeds(select);
  const cols = project ? plainColumns(select) : null;
  const t = tables();
  return rows.map((row) => {
    const out: Row = cols ? Object.fromEntries(cols.map(([alias, col]) => [alias, row[col]])) : { ...row };
    for (const e of embeds) {
      const r = relation(table, e.rel, row);
      const related = (t[r.table] ?? []).filter((x) => x[r.foreign] === row[r.local]);
      const shaped = withEmbeds(r.table, related, e.select, true);
      out[e.key] = r.many ? shaped : shaped[0] ?? null;
    }
    return out;
  });
}

// ── Filters ──────────────────────────────────────────────────────────────────

type Cond = { kind: "leaf"; column: string; op: string; value: string; negate: boolean } | { kind: "or" | "and"; parts: Cond[] };

function coerce(sample: unknown, v: string): unknown {
  if (v === "null") return null;
  if (typeof sample === "number") return Number(v);
  if (typeof sample === "boolean") return v === "true";
  return v.replace(/^"(.*)"$/, "$1");
}

function leafMatches(value: unknown, op: string, raw: string): boolean {
  const v = coerce(value, raw);
  const cmp = (a: unknown, b: unknown) => (a == null || b == null ? NaN : typeof a === "number" ? a - Number(b) : String(a).localeCompare(String(b)));
  switch (op) {
    case "eq": return value === v || String(value) === String(v);
    case "neq": return !(value === v || String(value) === String(v));
    case "gt": return cmp(value, v) > 0;
    case "gte": return cmp(value, v) >= 0;
    case "lt": return cmp(value, v) < 0;
    case "lte": return cmp(value, v) <= 0;
    case "is": return raw === "null" ? value == null : raw === "true" ? value === true : raw === "false" ? value === false : false;
    case "in": {
      const list = raw.replace(/^\(|\)$/g, "").split(",").map((x) => x.trim().replace(/^"(.*)"$/, "$1"));
      return list.includes(String(value));
    }
    case "like": case "ilike": {
      const re = new RegExp("^" + raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*") + "$", op === "ilike" ? "i" : "");
      return value != null && re.test(String(value));
    }
    case "cs": {
      const want = raw.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
      return Array.isArray(value) && want.every((w) => value.map(String).includes(w));
    }
    case "ov": {
      const want = raw.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
      return Array.isArray(value) && want.some((w) => value.map(String).includes(w));
    }
    default: return true;
  }
}

function parseLeaf(column: string, expr: string): Cond {
  let negate = false;
  let e = expr;
  if (e.startsWith("not.")) { negate = true; e = e.slice(4); }
  const dot = e.indexOf(".");
  return { kind: "leaf", column, op: e.slice(0, dot), value: e.slice(dot + 1), negate };
}

/** "(a.eq.1,and(b.eq.2,c.is.null))" → condition tree. */
function parseLogic(kind: "or" | "and", body: string): Cond {
  const inner = body.replace(/^\(/, "").replace(/\)$/, "");
  return {
    kind, parts: splitTop(inner).map((p) => {
      const m = p.match(/^(or|and)\(([\s\S]*)\)$/);
      if (m) return parseLogic(m[1] as "or" | "and", `(${m[2]})`);
      const dot = p.indexOf(".");
      return parseLeaf(p.slice(0, dot), p.slice(dot + 1));
    }),
  };
}

function matches(row: Row, c: Cond): boolean {
  if (c.kind !== "leaf") return c.kind === "or" ? c.parts.some((p) => matches(row, p)) : c.parts.every((p) => matches(row, p));
  const [head, ...rest] = c.column.split(".");
  let ok: boolean;
  if (rest.length) {
    const emb = row[head];
    if (emb === undefined) return true;             // filter on an embed we didn't load: ignore
    const vals = Array.isArray(emb) ? emb : emb ? [emb] : [];
    ok = vals.some((v) => leafMatches((v as Row)[rest.join(".")], c.op, c.value));
  } else {
    ok = leafMatches(row[head], c.op, c.value);
  }
  return c.negate ? !ok : ok;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function conditions(params: URLSearchParams): Cond[] {
  const out: Cond[] = [];
  params.forEach((value, key) => {
    if (RESERVED.has(key)) return;
    if (key === "or" || key === "and") out.push(parseLogic(key, value));
    else if (key.endsWith(".or") || key.endsWith(".and")) return;   // embedded-resource logic: not needed
    else out.push(parseLeaf(key, value));
  });
  return out;
}

function applyOrder(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const keys = order.split(",").map((o) => {
    const [col, ...mods] = o.split(".");
    return { col, desc: mods.includes("desc"), nullsFirst: mods.includes("nullsfirst") };
  }).filter((k) => !k.col.includes("("));
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const x = a[k.col], y = b[k.col];
      if (x == null && y == null) continue;
      if (x == null) return k.nullsFirst ? -1 : 1;
      if (y == null) return k.nullsFirst ? 1 : -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      if (c) return k.desc ? -c : c;
    }
    return 0;
  });
}

// ── Table hooks (what triggers do in the database) ──────────────────────────

const STAGES = ["signed_up", "applied", "accepted", "approved", "realized", "finished", "completed"];
function beforeWrite(table: string, row: Row): Row {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if ("updated_at" in row || ["tasks", "exchanges", "partners", "recruits", "outreach_templates", "handover_notes"].includes(table)) row.updated_at = now.toISOString();
  if (table === "exchanges") {
    const rank = STAGES.indexOf(String(row.stage ?? "signed_up"));
    STAGES.slice(1, rank + 1).forEach((s) => { if (!row[`${s}_at`]) row[`${s}_at`] = today; });
    row.signed_up_at ??= today;
  }
  return row;
}

const DEFAULTS: Record<string, Row> = {
  tasks: { archived: false, comments: [], files: [], links: [], status: "todo", priority: "medium", parent_id: null, scope: "lab" },
  reminders: { completed: false, sent: false, email_enabled: false, scope: "personal" },
  exchanges: { stage: "signed_up", email_consent: false },
  partners: { stage: "lead" },
  recruits: { stage: "applied" },
  outreach_templates: { status: "draft" },
};

const UPSERT_KEYS: Record<string, string[]> = {
  event_rsvps: ["event_id", "user_id"], user_settings: ["user_id"], member_onboarding: ["user_id", "step_id"],
  chat_read_state: ["user_id", "channel"], task_assignees: ["task_id", "user_id"], email_log: ["kind", "ref_id", "user_id"],
};

// ── RPCs ─────────────────────────────────────────────────────────────────────

function termStart(): string {
  const now = new Date();
  return `${now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1}-02-01`;
}

function periodStarts(): string[] {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const epoch = Date.UTC(2024, 0, 1);
  const start = epoch + Math.floor((monday.getTime() - epoch) / 86_400_000 / 14) * 14 * 86_400_000;
  return Array.from({ length: 8 }, (_, i) => new Date(start - (7 - i) * 14 * 86_400_000).toISOString().slice(0, 10));
}

const importResult = (n: number) => [{ inserted: n, updated: 0, failed: 0, errors: [] }];

function rpc(name: string, args: Row): Response {
  const t = tables();
  const me = PREVIEW_USER_ID;
  switch (name) {
    case "lc_term_start": return json(termStart());
    case "touch_last_seen": return json(null);
    case "lc_mc_name": return json(null);
    case "mc_dashboard": return json([]);
    case "goal_progress": {
      const field: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s, `${s}_at`]));
      return json(t.goals.map((g) => ({
        goal_id: g.id,
        current: g.metric === "manual" ? g.current_value : t.exchanges.filter((e) =>
          (!g.product || e.product === g.product) && e[field[String(g.stage)]] != null
          && String(e[field[String(g.stage)]]) >= String(g.starts_on) && String(e[field[String(g.stage)]]) <= String(g.ends_on)).length,
      })));
    }
    case "get_member_pulse": {
      const groups = [null, ...t.departments.filter((d) => t.team_members.some((m) => m.department_id === d.id && m.role === "member")).map((d) => d.id as string)];
      const want = (args.p_department_id as string | null) ?? null;
      return json(previewPulseRows(periodStarts(), want ? [want] : groups).filter((r) => !want || r.department_id === want));
    }
    case "get_exec_pulse": return json(previewPulseRows(periodStarts(), [null], 3).map(({ period_start, question_id, avg_score, respondent_count, suppressed }) => ({ period_start, question_id, avg_score, respondent_count, suppressed })));
    case "get_area_pulse": return json(previewPulseRows(periodStarts(), ["outgoing", "incoming", "support"], 1).map(({ department_id: d, ...r }) => ({ area: d, ...r })));
    case "member_activity": return json(t.team_members.map((m) => {
      const p = t.user_profiles.find((u) => u.id === m.user_id);
      return {
        user_id: m.user_id, department_id: m.department_id, role: m.role, term_start: m.term_start, term_end: m.term_end,
        last_seen_at: p?.last_seen_at ?? null, events_held: 1, events_attended: t.event_attendance.filter((a) => a.user_id === m.user_id).length,
        tabling_no_shows: 0, overdue_tasks: 0, onboarding_done: t.member_onboarding.filter((o) => o.user_id === m.user_id).length, onboarding_total: t.onboarding_steps.length,
      };
    }));
    case "tabling_report": {
      const by = new Map<string, Row>();
      for (const s of t.tabling_signups) {
        const r = by.get(String(s.user_id)) ?? { user_id: s.user_id, hours: 0, attended: 0, no_shows: 0, upcoming: 0 };
        if (s.status === "signed_up") r.upcoming = Number(r.upcoming) + 1;
        by.set(String(s.user_id), r);
      }
      return json([...by.values()]);
    }
    case "tabling_sign_up": {
      const slot = t.tabling_slots.find((s) => s.id === args.p_slot_id);
      if (!slot) return pgError("Slot not found");
      if (Number(slot.taken) >= Number(slot.capacity)) return pgError("This slot is full");
      if (!t.tabling_signups.some((s) => s.slot_id === slot.id && s.user_id === me)) {
        t.tabling_signups.push({ slot_id: slot.id, user_id: me, project_id: PREVIEW_LC_ID, status: "signed_up", walk_in: false, signed_up_at: new Date().toISOString() });
        slot.taken = Number(slot.taken) + 1;
      }
      return json(null);
    }
    case "tabling_withdraw": {
      const before = t.tabling_signups.length;
      t.tabling_signups = t.tabling_signups.filter((s) => !(s.slot_id === args.p_slot_id && s.user_id === me));
      const slot = t.tabling_slots.find((s) => s.id === args.p_slot_id);
      if (slot && t.tabling_signups.length < before) slot.taken = Math.max(0, Number(slot.taken) - 1);
      return json(null);
    }
    case "outreach_stats": return json(t.outreach_sequences.map((s) => {
      const en = t.outreach_enrollments.filter((e) => e.sequence_id === s.id);
      return { sequence_id: s.id, name: s.name, product: s.product, enrolled: en.length, active: en.filter((e) => e.status === "active").length, replied: 0, unsubscribed: 0, moved_on: 0, applied: 0, emails_sent: 0 };
    }));
    case "enroll_in_sequence": {
      const ids = (args.p_exchange_ids as string[]) ?? [];
      for (const x of ids) t.outreach_enrollments.push({ id: crypto.randomUUID(), project_id: PREVIEW_LC_ID, sequence_id: args.p_sequence_id, exchange_id: x, sender_id: me, status: "active", next_step: 1, enrolled_at: new Date().toISOString() });
      return json([{ enrolled: ids.length, skipped: 0, reasons: [] }]);
    }
    case "import_exchanges": case "import_partners": case "import_recruits": case "import_tasks": {
      const table = name.slice("import_".length);
      const rows = (args.p_rows as Row[]) ?? [];
      for (const r of rows) {
        const { assignee_ids: assignees, ...rest } = r as Row & { assignee_ids?: string[] };
        const row = beforeWrite(table, { ...DEFAULTS[table], id: crypto.randomUUID(), project_id: PREVIEW_LC_ID, created_by: me, created_at: new Date().toISOString(), ...(table === "exchanges" ? { product: args.p_product } : {}), ...rest });
        (t[table] ??= []).push(row);
        for (const a of assignees ?? []) t.task_assignees.push({ task_id: row.id, user_id: a });
      }
      return json(importResult(rows.length));
    }
    case "create_demo_lc": return pgError("You're already looking at the demo LC: this preview is filled with sample data.");
    default: return pgError(NOT_IN_PREVIEW);
  }
}

// ── REST ─────────────────────────────────────────────────────────────────────

async function rest(method: string, url: URL, headers: Headers, body: string | null): Promise<Response> {
  const path = url.pathname.replace(/^\/rest\/v1\//, "");
  if (path.startsWith("rpc/")) return rpc(path.slice(4), body ? JSON.parse(body) : {});

  const t = tables();
  const table = path;
  const rows = (t[table] ??= []);
  const params = url.searchParams;
  const select = params.get("select");
  const prefer = headers.get("Prefer") ?? "";
  const wantsRows = prefer.includes("return=representation");
  const single = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");
  const conds = conditions(params);

  const respond = (out: Row[], total = out.length, status = 200) => {
    const range = { "Content-Range": out.length ? `0-${out.length - 1}/${total}` : `*/${total}` };
    if (method === "HEAD") return new Response(null, { status, headers: range });
    if (single) {
      if (out.length !== 1) return json({ message: `JSON object requested, multiple (or no) rows returned`, code: "PGRST116", details: `Results contain ${out.length} rows`, hint: null }, 406);
      return json(out[0], status, range);
    }
    return json(out, status, range);
  };

  if (method === "GET" || method === "HEAD") {
    let out = withEmbeds(table, rows, select);
    for (const e of select ? parseEmbeds(select) : []) if (e.inner) out = out.filter((r) => (Array.isArray(r[e.key]) ? (r[e.key] as Row[]).length > 0 : r[e.key] != null));
    out = out.filter((r) => conds.every((c) => matches(r, c)));
    // Rows hidden by an !inner embed filter: drop rows whose embed no longer matches.
    out = applyOrder(out, params.get("order"));
    const total = out.length;
    const offset = Number(params.get("offset") ?? 0);
    const range = headers.get("Range")?.match(/(\d+)-(\d+)/);
    if (range) out = out.slice(Number(range[1]), Number(range[2]) + 1);
    else if (params.get("limit")) out = out.slice(offset, offset + Number(params.get("limit")));
    return respond(out, total);
  }

  if (method === "POST") {
    const input = (body ? JSON.parse(body) : []) as Row | Row[];
    const list = Array.isArray(input) ? input : [input];
    const upsert = prefer.includes("resolution=merge-duplicates") || prefer.includes("resolution=ignore-duplicates");
    const keys = params.get("on_conflict")?.split(",") ?? UPSERT_KEYS[table] ?? ["id"];
    const written: Row[] = [];
    for (const item of list) {
      const existing = upsert ? rows.find((r) => keys.every((k) => item[k] !== undefined && r[k] === item[k])) : undefined;
      if (existing) {
        if (!prefer.includes("ignore-duplicates")) Object.assign(existing, beforeWrite(table, { ...existing, ...item }));
        written.push(existing);
        continue;
      }
      if (!upsert && UPSERT_KEYS[table] && rows.some((r) => UPSERT_KEYS[table].every((k) => r[k] === item[k]))) {
        return pgError("duplicate key value violates unique constraint", 409, "23505");
      }
      const row = beforeWrite(table, { ...DEFAULTS[table], id: crypto.randomUUID(), created_at: new Date().toISOString(), ...item });
      if (table === "user_settings" || table === "member_onboarding" || table === "task_assignees" || table === "event_rsvps") delete row.id;
      rows.push(row);
      written.push(row);
    }
    return wantsRows ? respond(withEmbeds(table, written, select), written.length, 201) : new Response(null, { status: 201 });
  }

  if (method === "PATCH") {
    const patch = (body ? JSON.parse(body) : {}) as Row;
    const hit = withEmbeds(table, rows, null).map((r, i) => ({ r, i })).filter(({ r }) => conds.every((c) => matches(r, c)));
    for (const { i } of hit) rows[i] = beforeWrite(table, { ...rows[i], ...patch });
    const out = hit.map(({ i }) => rows[i]);
    return wantsRows ? respond(withEmbeds(table, out, select)) : new Response(null, { status: 204 });
  }

  if (method === "DELETE") {
    const gone = rows.filter((r) => conds.every((c) => matches(r, c)));
    t[table] = rows.filter((r) => !gone.includes(r));
    if (table === "tasks") t.task_assignees = t.task_assignees.filter((a) => !gone.some((g) => g.id === a.task_id));
    return wantsRows ? respond(gone) : new Response(null, { status: 204 });
  }
  return pgError(`Method ${method} not supported in the preview`, 405);
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function auth(method: string, url: URL): Response {
  const p = url.pathname.replace(/^\/auth\/v1\//, "");
  const session = previewSession();
  const setFlag = (signedOut: boolean) => {
    try {
      if (typeof window === "undefined") return;
      if (signedOut) localStorage.setItem(PREVIEW_SIGNED_OUT_KEY, "1"); else localStorage.removeItem(PREVIEW_SIGNED_OUT_KEY);
    } catch { /* storage blocked */ }
  };
  if (p === "user") return json(session.user);
  if (p === "token" || p === "signup") { setFlag(false); return json(session); }
  if (p === "logout") { setFlag(true); return new Response(null, { status: 204 }); }
  if (p === "recover" || p === "otp" || p === "resend") return json({});
  return json({ message: NOT_IN_PREVIEW }, method === "GET" ? 404 : 400);
}

/** Drop-in for fetch, given to the Supabase client in preview mode. */
export async function previewFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : String(input));
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers ?? req?.headers);
  const body = typeof init?.body === "string" ? init.body : req ? await req.text() : null;
  try {
    if (url.pathname.startsWith("/rest/v1/")) return await rest(method, url, headers, body || null);
    if (url.pathname.startsWith("/auth/v1/")) return auth(method, url);
    if (url.pathname.startsWith("/storage/v1/")) return json({ statusCode: "400", error: "preview", message: "Files can't be uploaded in the preview, which uses sample data." }, 400);
    return json({ message: NOT_IN_PREVIEW }, 400);
  } catch (e) {
    return pgError(e instanceof Error ? e.message : String(e), 500);
  }
}
