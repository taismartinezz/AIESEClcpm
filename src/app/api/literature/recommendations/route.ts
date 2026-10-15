// Server-side proxy for OpenAlex related-works recommendations with DB-level caching.
// Caches results per source item for CACHE_TTL_HOURS to avoid hammering OpenAlex.

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const CACHE_TTL_HOURS = 24;
const OA_HEADERS = { "User-Agent": "Canopy/1.0 (research-lab-app; mailto:admin@canopy.app)" };

interface RecResult {
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  doi?: string;
  openAlexId: string;
}

type OAWork = {
  id: string; display_name: string;
  authorships?: Array<{ author: { display_name: string } }>;
  publication_year?: number;
  primary_location?: { source?: { display_name?: string } };
  doi?: string;
};

function mapWork(w: OAWork): RecResult {
  return {
    title: w.display_name,
    authors: (w.authorships ?? []).slice(0, 3).map((a) => a.author.display_name),
    year: w.publication_year,
    journal: w.primary_location?.source?.display_name,
    doi: w.doi?.replace("https://doi.org/", ""),
    openAlexId: w.id,
  };
}

export async function POST(request: Request) {
  // Verify caller is authenticated before touching any project data
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return Response.json({ recommendations: [] }, { status: 401 });

  const { doi, sourceItemId, projectId, title } = (await request.json()) as {
    doi?: string;
    sourceItemId?: string;
    projectId?: string;
    title?: string;
  };

  // A title alone is enough - the title-search fallback can run without a DOI.
  if ((!doi && !title) || !sourceItemId || !projectId) {
    return Response.json({ recommendations: [] });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ recommendations: [] });
  }

  // Verify the caller is a member of the requested project using their own token
  const userClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser(token);
  if (!user) return Response.json({ recommendations: [] }, { status: 401 });

  const { count } = await userClient
    .from("team_members")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("user_id", user.id);
  if (!count) return Response.json({ recommendations: [] }, { status: 403 });

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check cache - return if fresh enough
  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000).toISOString();
  const { data: cached } = await supabase
    .from("lit_recommendation_cache")
    .select("*")
    .eq("source_item_id", sourceItemId)
    .eq("project_id", projectId)
    .gt("cached_at", cutoff)
    .order("cached_at", { ascending: false });

  if (cached && cached.length > 0) {
    return Response.json({
      recommendations: cached.map((r) => ({
        title: r.title as string,
        authors: (r.authors as string[]) ?? [],
        year: r.year as number | undefined,
        journal: r.journal as string | undefined,
        doi: r.doi as string | undefined,
        openAlexId: r.open_alex_id as string,
      })),
      fromCache: true,
    });
  }

  try {
    // Primary: look up by DOI and use OpenAlex related_works links (skipped when no DOI)
    let recommendations: RecResult[] = [];
    if (doi) {
      const workRes = await fetch(
        `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`,
        { headers: OA_HEADERS }
      );

      if (workRes.ok) {
        const work = await workRes.json() as { related_works?: string[] };
        const relatedIds: string[] = (work.related_works ?? []).slice(0, 10);

        if (relatedIds.length > 0) {
          const recsRes = await fetch(
            `https://api.openalex.org/works?filter=ids.openalex:${encodeURIComponent(relatedIds.join("|"))}&per_page=5&select=id,display_name,authorships,publication_year,primary_location,doi`,
            { headers: OA_HEADERS }
          );
          if (recsRes.ok) {
            const { results = [] } = await recsRes.json() as { results: OAWork[] };
            recommendations = results.map(mapWork);
          }
        }
      }
    }

    // Fallback: title keyword search when DOI lookup fails or returns no related works.
    // Also the primary path for items that have no DOI (e.g. external PDFs).
    if (recommendations.length === 0 && title) {
      const searchRes = await fetch(
        `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per_page=5&select=id,display_name,authorships,publication_year,primary_location,doi`,
        { headers: OA_HEADERS }
      );
      if (searchRes.ok) {
        const { results = [] } = await searchRes.json() as { results: OAWork[] };
        const normDoi = doi ? doi.toLowerCase() : null;
        recommendations = results
          .filter((w) => !normDoi || !w.doi || w.doi.replace("https://doi.org/", "").toLowerCase() !== normDoi)
          .slice(0, 5)
          .map(mapWork);
      }
    }

    // Persist to cache and return
    await supabase.from("lit_recommendation_cache").delete()
      .eq("source_item_id", sourceItemId).eq("project_id", projectId);

    if (recommendations.length > 0) {
      await supabase.from("lit_recommendation_cache").insert(
        recommendations.map((r) => ({
          source_item_id: sourceItemId,
          project_id: projectId,
          title: r.title,
          authors: r.authors,
          year: r.year ?? null,
          journal: r.journal ?? null,
          doi: r.doi ?? null,
          open_alex_id: r.openAlexId,
          dismissed: false,
        }))
      );
    }

    return Response.json({ recommendations, fromCache: false });
  } catch {
    return Response.json({ recommendations: [] });
  }
}
