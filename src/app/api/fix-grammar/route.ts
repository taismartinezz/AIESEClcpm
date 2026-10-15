import { requireAuth } from "@/lib/api-auth";

export async function POST(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { text } = (await request.json()) as { text: string };

  if (!text?.trim()) {
    return Response.json({ corrected: text ?? "" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "API key not configured" }, { status: 500 });
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content:
            "Fix the grammar and spelling of the following text. Keep the meaning, tone, and voice exactly the same. Return only the corrected text, nothing else.\n\n" +
            text,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[fix-grammar] Anthropic error:", err);
    return Response.json({ error: "Failed to fix grammar" }, { status: 500 });
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const corrected = data.content[0]?.text ?? text;

  return Response.json({ corrected });
}
