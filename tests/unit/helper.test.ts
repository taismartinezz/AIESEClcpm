// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { APP_GUIDE, keywordAnswer, searchGuide } from "@/lib/appGuide";
import { TOURS } from "@/lib/tours";

vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(async () => "user-1") }));

/** A route is real when the app has a page for it. */
function pageExists(route: string): boolean {
  const path = route.split("?")[0];
  if (path === "/") return existsSync(join(process.cwd(), "src/app/(main)/page.tsx"));
  return ["(main)", "(national)"].some((group) => existsSync(join(process.cwd(), "src/app", group, path, "page.tsx")));
}

describe("the helper's map of the app", () => {
  it("only points at pages that exist", () => {
    for (const e of APP_GUIDE) expect(pageExists(e.route), `${e.id} → ${e.route}`).toBe(true);
  });

  it("has unique ids, and every entry says where and how", () => {
    expect(new Set(APP_GUIDE.map((e) => e.id)).size).toBe(APP_GUIDE.length);
    for (const e of APP_GUIDE) {
      expect(e.where.length).toBeGreaterThan(2);
      expect(e.how.length).toBeGreaterThan(0);
      expect(e.roles.length).toBeGreaterThan(0);
    }
  });

  it("finds common questions by keyword", () => {
    expect(keywordAnswer("where do I submit a receipt for reimbursement")?.id).toBe("claim");
    expect(keywordAnswer("how do I invite my VPs")?.id).toBe("invite");
    expect(keywordAnswer("add a partner company")?.id).toBe("partners");
    expect(keywordAnswer("turn on dark mode")?.id).toBe("profile");
    expect(keywordAnswer("Where can I see every LC's balance?", "mc")?.route).toBe("/mc");
    expect(keywordAnswer("where is our balance", "president")?.id).toBe("ledger");
  });

  it("says no rather than guessing", () => {
    expect(keywordAnswer("book a flight to the international congress")).toBeNull();
    expect(keywordAnswer("the")).toBeNull();
    expect(searchGuide("?!")).toEqual([]);
  });
});

describe("the tours", () => {
  it("open real pages only", () => {
    for (const [role, steps] of Object.entries(TOURS)) {
      for (const s of steps) if (s.route) expect(pageExists(s.route), `${role}: ${s.title} → ${s.route}`).toBe(true);
    }
  });

  it("start with a welcome and end on a page", () => {
    for (const steps of Object.values(TOURS)) {
      expect(steps[0].targets).toBeUndefined();
      expect(steps[steps.length - 1].route).toBeDefined();
    }
  });
});

describe("POST /api/helper", () => {
  const env = process.env.ANTHROPIC_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  const post = async (question: string, role = "member") => {
    const { POST } = await import("@/app/api/helper/route");
    const res = await POST(new Request("http://x/api/helper", { method: "POST", body: JSON.stringify({ question, role }) }));
    return { status: res.status, body: await res.json() };
  };
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    if (env === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = env;
    if (groq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = groq;
    vi.unstubAllGlobals();
  });

  it("without an AI key, answers by keyword", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GROQ_API_KEY;
    const yes = await post("where do I add a partner");
    expect(yes.body).toMatchObject({ found: true, source: "keywords", entry: { id: "partners", route: "/partners" } });
    const no = await post("can it order pizza for us");
    expect(no.body).toMatchObject({ found: false, entry: null });
  });

  it("uses the AI's choice, but the route always comes from the map", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ content: [{ type: "text", text: '"entryId": "invite", "answer": "Está en Ajustes → Invitaciones."}' }] })));
    const r = await post("¿cómo invito a mis VPs?", "member");
    expect(r.body).toMatchObject({ found: true, source: "ai", notForYou: true, answer: "Está en Ajustes → Invitaciones.", entry: { id: "invite", route: "/settings" } });
  });

  it("treats a page the AI makes up as not found", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ content: [{ type: "text", text: '"entryId": "secret-admin", "answer": "Go to /admin."}' }] })));
    const r = await post("where is the admin panel");
    expect(r.body).toMatchObject({ found: false, entry: null });
  });

  it("falls back to keywords when the AI fails", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 529 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await post("submit an expense claim");
    expect(r.body).toMatchObject({ found: true, source: "keywords", entry: { id: "claim" } });
  });

  it("uses Groq when only GROQ_API_KEY is set, in the OpenAI chat format", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: '{"entryId": "claim", "answer": "Finance → New claim."}' } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await post("where do I upload a receipt");
    expect(r.body).toMatchObject({ found: true, source: "ai", entry: { id: "claim" }, answer: "Finance → New claim." });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer gsk_test");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "llama-3.3-70b-versatile", response_format: { type: "json_object" } });
  });

  it("falls back to keywords when Groq's free tier is rate-limited", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GROQ_API_KEY = "gsk_test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await post("submit an expense claim");
    expect(r.body).toMatchObject({ found: true, source: "keywords", entry: { id: "claim" } });
  });

  it("refuses an empty question", async () => {
    expect((await post("  ")).status).toBe(400);
  });
});
