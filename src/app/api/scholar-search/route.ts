// Google Scholar search via SerpApi (SERPAPI_KEY env var required)
// Falls back gracefully when key is absent: returns 200 with empty result so
// the caller can chain to its own Semantic Scholar fallback.

export const runtime = "nodejs";

interface SerpOrganicResult {
  title?: string;
  snippet?: string;
  link?: string;
  publication_info?: { summary?: string };
  inline_links?: { cited_by?: { total?: number } };
}

interface SerpResponse {
  organic_results?: SerpOrganicResult[];
  error?: string;
}

import { requireAuth } from "@/lib/api-auth";

export async function POST(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { url } = (await request.json()) as { url?: string };
  if (!url?.trim()) return Response.json({ error: "url required" }, { status: 400 });

  const key = process.env.SERPAPI_KEY;
  if (!key) return Response.json({}, { status: 200 }); // unconfigured - caller falls through

  // Extract search query from Scholar URL params (title=, q=, query=)
  let query = "";
  try {
    const u = new URL(url);
    query = u.searchParams.get("title") ?? u.searchParams.get("q") ?? u.searchParams.get("query") ?? "";
  } catch { /* not a valid URL - use the raw string as query */ query = url; }

  if (!query) return Response.json({}, { status: 200 });

  const serpUrl = new URL("https://serpapi.com/search.json");
  serpUrl.searchParams.set("engine", "google_scholar");
  serpUrl.searchParams.set("q", query);
  serpUrl.searchParams.set("api_key", key);
  serpUrl.searchParams.set("num", "1");

  const res = await fetch(serpUrl.toString());
  if (!res.ok) return Response.json({ error: "SerpApi request failed" }, { status: 502 });

  const data = (await res.json()) as SerpResponse;
  if (data.error) return Response.json({ error: data.error }, { status: 502 });

  const top = data.organic_results?.[0];
  if (!top?.title) return Response.json({}, { status: 200 });

  // Parse "Author · Year · Journal" from publication_info.summary
  const summary = top.publication_info?.summary ?? "";
  const yearMatch = /\b(19|20)\d{2}\b/.exec(summary);
  const parts = summary.split(" - ").map((s) => s.trim());

  const preview = {
    type: "article",
    title: top.title,
    authors: parts[0] ? parts[0].split(",").map((a) => a.trim()).filter(Boolean) : [],
    year: yearMatch ? parseInt(yearMatch[0]) : undefined,
    journal: parts[1] ?? undefined,
    abstract: top.snippet ?? undefined,
    url: top.link ?? undefined,
  };

  return Response.json(preview);
}
