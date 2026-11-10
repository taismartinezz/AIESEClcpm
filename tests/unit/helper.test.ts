// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { APP_GUIDE, keywordAnswer, searchGuide } from "@/lib/appGuide";
import { CHAPTERS, CORE, MC_TOUR } from "@/lib/tours";

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
  const all = [...CORE, ...MC_TOUR, ...CHAPTERS.flatMap((c) => c.steps)];

  it("open real pages only", () => {
    for (const s of all) if (s.route) expect(pageExists(s.route), `${s.id} → ${s.route}`).toBe(true);
  });

  it("start with a welcome", () => {
    expect(CORE[0].targets).toBeUndefined();
    expect(MC_TOUR[0].targets).toBeUndefined();
  });
});

describe("POST /api/helper", () => {
  const env = process.env.ANTHROPIC_API_KEY;
  const post = async (question: string, role = "member") => {
    const { POST } = await import("@/app/api/helper/route");
    const res = await POST(new Request("http://x/api/helper", { method: "POST", body: JSON.stringify({ question, role }) }));
    return { status: res.status, body: await res.json() };
  };
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { process.env.ANTHROPIC_API_KEY = env; vi.unstubAllGlobals(); });

  it("without an AI key, answers by keyword", async () => {
    delete process.env.ANTHROPIC_API_KEY;
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

  it("refuses an empty question", async () => {
    expect((await post("  ")).status).toBe(400);
  });
});
