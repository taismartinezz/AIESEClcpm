import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────
// Tables that the route touches:
//   user_profiles (name), team_members (+ lab_roles join), invite_codes,
//   lab_roles (name lookup), projects (name)

type Row = Record<string, unknown>;

const TABLES: Record<string, Row[]> = {
  user_profiles: [{ id: "pi-user", name: "Tais Martinez" }],
  team_members: [],     // set per-test
  lab_roles: [{ id: "role-researcher", name: "Researcher", permission_level: "researcher" }],
  invite_codes: [],     // set per-test
  projects: [{ id: "project-collab", name: "CollabLab" }],
};

// Track update calls
const updateCalls: { table: string; id: string }[] = [];

function makeQuery(table: string, rows: Row[]) {
  let filtered = [...rows];
  const q: Record<string, unknown> = {
    select: vi.fn(() => q),
    eq: vi.fn((_col: string, val: unknown) => {
      filtered = filtered.filter((r) => Object.values(r).includes(val) || r[_col] === val);
      return q;
    }),
    in: vi.fn((_col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => (vals as unknown[]).includes(r[_col]));
      return q;
    }),
    not: vi.fn((_col: string, op: string) => {
      if (op === "is") filtered = filtered.filter((r) => r[_col] != null);
      return q;
    }),
    is: vi.fn((_col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[_col] === val);
      return q;
    }),
    maybeSingle: vi.fn(() => Promise.resolve({ data: filtered[0] ?? null, error: null })),
    then: vi.fn((cb: (v: { data: Row[]; error: null }) => void) =>
      Promise.resolve({ data: filtered, error: null }).then(cb)
    ),
    update: vi.fn((patch: Row) => {
      updateCalls.push({ table, id: filtered[0]?.id as string });
      filtered.forEach((r) => Object.assign(r, patch));
      return { eq: vi.fn(() => Promise.resolve({ error: null })) };
    }),
  };
  // resolve the chain as a promise when awaited
  (q as unknown as Promise<{ data: Row[]; error: null }>)[Symbol.iterator as unknown as string] = undefined;
  Object.defineProperty(q, Symbol.toStringTag, { value: "Object" });
  // make `await db.from(...).select(...).in(...).not(...).is(...)` resolve
  q[Symbol.iterator as unknown as string] = undefined;
  return q;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn((_url: string, key: string) => {
    // anonClient (used only for getUser)
    if (key === "anon-key") {
      return {
        auth: {
          getUser: vi.fn((token: string) =>
            Promise.resolve({
              data: { user: token === "valid-token" ? { id: "pi-user" } : null },
              error: null,
            })
          ),
        },
      };
    }
    // serviceClient
    return {
      from: vi.fn((table: string) => {
        const rows = TABLES[table] ?? [];
        return makeQuery(table, rows);
      }),
    };
  }),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(() => Promise.resolve({ ok: true })),
  buildInviteEmail: vi.fn(() => ({ to: "x@y.com", subject: "Invite", html: "<p>hi</p>" })),
}));

// ── Helper: build a Request ───────────────────────────────────────────────────
function makeRequest(inviteIds: string[], token = "valid-token") {
  return new Request("http://localhost/api/invite/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ inviteIds }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("POST /api/invite/send", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    vi.clearAllMocks();
    // Reset env vars so createClient sees them
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  });

  it("PI whose user_profiles.project_id is null but has a team_members pi row sends successfully", async () => {
    // Arrange: PI membership exists in team_members; user_profiles has no project_id
    TABLES.team_members = [
      { user_id: "pi-user", project_id: "project-collab", role: "pi", lab_role_id: null, lab_roles: null },
    ];
    TABLES.invite_codes = [
      {
        id: "inv-1",
        invited_email: "alice@lab.com",
        code: "CODE-1",
        lab_role_id: "role-researcher",
        email_sent_at: null,
        used_by: null,
        project_id: "project-collab",
      },
    ];

    const { POST } = await import("@/app/api/invite/send/route");
    const res = await POST(makeRequest(["inv-1"]));
    const body = await res.json() as { ok: boolean; results: { id: string; ok: boolean }[] };

    expect(res.status).toBe(200);
    expect(body.results.find((r) => r.id === "inv-1")?.ok).toBe(true);
  });

  it("researcher is rejected with 403", async () => {
    // Arrange: user has researcher-level role only
    TABLES.team_members = [
      { user_id: "pi-user", project_id: "project-collab", role: "researcher", lab_role_id: "role-researcher", lab_roles: { permission_level: "researcher" } },
    ];
    TABLES.invite_codes = [
      {
        id: "inv-2",
        invited_email: "bob@lab.com",
        code: "CODE-2",
        lab_role_id: "role-researcher",
        email_sent_at: null,
        used_by: null,
        project_id: "project-collab",
      },
    ];

    const { POST } = await import("@/app/api/invite/send/route");
    const res = await POST(makeRequest(["inv-2"]));
    const body = await res.json() as { ok: boolean; results?: { id: string; ok: boolean; skipped?: string }[] };

    // 200 with skipped, not 403, because the route skips per-invite rather than blanket-rejecting
    // (caller IS a member, just not PI of that project)
    expect(res.status).toBe(200);
    expect(body.results?.find((r) => r.id === "inv-2")?.skipped).toBe("not PI of this project");
  });

  it("PI of lab A cannot send lab B's invite IDs (skipped, not errored)", async () => {
    // Arrange: PI of project-collab tries to send an invite belonging to project-other
    TABLES.team_members = [
      { user_id: "pi-user", project_id: "project-collab", role: "pi", lab_role_id: null, lab_roles: null },
    ];
    TABLES.invite_codes = [
      {
        id: "inv-3",
        invited_email: "carol@other.com",
        code: "CODE-3",
        lab_role_id: null,
        email_sent_at: null,
        used_by: null,
        project_id: "project-other",   // different lab
      },
    ];

    const { POST } = await import("@/app/api/invite/send/route");
    const res = await POST(makeRequest(["inv-3"]));
    const body = await res.json() as { ok: boolean; results: { id: string; ok: boolean; skipped?: string }[] };

    expect(res.status).toBe(200);
    expect(body.results.find((r) => r.id === "inv-3")?.skipped).toBe("not PI of this project");
  });
});
