import { requireAuth } from "@/lib/api-auth";
import { APP_GUIDE, guideEntry, keywordAnswer, searchGuide, type GuideEntry, type GuideRole } from "@/lib/appGuide";
import { APP_NAME } from "@/lib/brand";

// The helper: "where do I…?" → the page that does it, or "not in the app yet".
// The AI may only choose among APP_GUIDE entries (by id); the route, steps and
// spotlight come from the guide, never from the model. Without an API key, or
// if the AI fails, a keyword match answers instead.

const MODEL = "claude-haiku-4-5-20251001";
const AI_TIMEOUT_MS = 12_000;

export interface HelperAnswer {
  found: boolean;
  /** One or two sentences, in the asker's language when the AI answered. */
  answer: string;
  entry: Pick<GuideEntry, "id" | "title" | "route" | "where" | "how" | "roles" | "target" | "click"> | null;
  /** The entry is there, but for another role (e.g. a member asking about Invites). */
  notForYou: boolean;
  /** Closest guide entries, kept with a feature request for triage. */
  closest: string[];
  source: "ai" | "keywords";
}

const ROLES: GuideRole[] = ["member", "vp", "president", "mc"];
const pick = (e: GuideEntry): HelperAnswer["entry"] => ({ id: e.id, title: e.title, route: e.route, where: e.where, how: e.how, roles: e.roles, target: e.target, click: e.click });

function answerFor(entry: GuideEntry | null, role: GuideRole | null, text: string | null, closest: string[], source: HelperAnswer["source"]): HelperAnswer {
  if (!entry) {
    return { found: false, entry: null, notForYou: false, closest, source,
      answer: text ?? `${APP_NAME} doesn't do that yet.` };
  }
  const notForYou = Boolean(role && !entry.roles.includes(role));
  return { found: true, entry: pick(entry), notForYou, closest, source, answer: text ?? `It's in ${entry.where}.` };
}

async function askAi(question: string, role: GuideRole | null, apiKey: string): Promise<{ entryId: string | null; answer: string } | null> {
  const catalogue = APP_GUIDE.map((e) => `- id: ${e.id} | ${e.title} | where: ${e.where} | for: ${e.roles.join("/")} | ${e.how.join(" ")}`).join("\n");
  const system = `You are the in-app helper of ${APP_NAME}, a workspace for AIESEC Local Committees (LCs) and their national team (MC).
Someone asks where to find something or how to do something. Decide whether the app has it, using ONLY this list of features:
${catalogue}

Rules:
- If one feature in the list does what they ask, reply with its id. Only use ids from the list. If it's close but not really what they asked, it does not count.
- If nothing in the list does it, the app doesn't have it: reply with entryId null.
- "answer": one or two short sentences in the same language as the question. If found, say where it is (use the "where" path). If not found, say plainly that ${APP_NAME} doesn't have that yet; don't suggest workarounds outside the app and don't invent pages.
- The person's role is: ${role ?? "unknown"}. If the feature is for other roles, say who can do it.
Reply with JSON only: {"entryId": "<id>" | null, "answer": "<text>"}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 300, system,
        messages: [{ role: "user", content: question }, { role: "assistant", content: "{" }],
      }),
    });
    if (!res.ok) { console.error("[helper] Anthropic error:", res.status, await res.text()); return null; }
    const data = (await res.json()) as { content: { type: string; text: string }[] };
    const raw = "{" + (data.content.find((c) => c.type === "text")?.text ?? "");
    const parsed = JSON.parse(raw.slice(0, raw.lastIndexOf("}") + 1)) as { entryId?: unknown; answer?: unknown };
    const entryId = typeof parsed.entryId === "string" && guideEntry(parsed.entryId) ? parsed.entryId : null;
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim().slice(0, 400) : "";
    return { entryId, answer };
  } catch (e) {
    console.error("[helper] AI failed:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { question?: unknown; role?: unknown };
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (question.length < 3) return Response.json({ error: "Ask a question of at least a few words." }, { status: 400 });
  const role = ROLES.includes(body.role as GuideRole) ? (body.role as GuideRole) : null;
  const closest = searchGuide(question, 3, role).map((r) => r.entry.id);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const ai = await askAi(question, role, apiKey);
    if (ai) return Response.json(answerFor(ai.entryId ? guideEntry(ai.entryId) : null, role, ai.answer || null, closest, "ai") satisfies HelperAnswer);
  }
  return Response.json(answerFor(keywordAnswer(question, role), role, null, closest, "keywords") satisfies HelperAnswer);
}
