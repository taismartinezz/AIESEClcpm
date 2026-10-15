// Zotero Web API v3 proxy - fetches collections and group libraries.
// Runs server-side to keep the API key out of browser network requests.

export const runtime = "nodejs";

import { requireAuth } from "@/lib/api-auth";

async function fetchCollections(base: string, apiKey: string): Promise<{ key: string; name: string }[]> {
  const res = await fetch(`${base}/collections?limit=100`, {
    headers: { "Zotero-API-Key": apiKey, "Zotero-API-Version": "3" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { key?: string; data?: { name?: string } }[];
  return (Array.isArray(data) ? data : [])
    .map((c) => ({ key: c.key ?? "", name: c.data?.name ?? c.key ?? "Unnamed" }))
    .filter((c) => c.key);
}

export async function POST(request: Request) {
  const callerId = await requireAuth(request);
  if (!callerId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { apiKey, zoteroUserId, groupId } = (await request.json()) as {
    apiKey?: string;
    zoteroUserId?: string;
    groupId?: string;
  };

  if (!apiKey?.trim() || !zoteroUserId?.trim()) {
    return Response.json({ error: "apiKey and zoteroUserId are required" }, { status: 400 });
  }

  const key = apiKey.trim();
  const uid = zoteroUserId.trim();

  // Fetch group libraries the user belongs to
  const groupsRes = await fetch(`https://api.zotero.org/users/${uid}/groups?limit=100`, {
    headers: { "Zotero-API-Key": key, "Zotero-API-Version": "3" },
  });
  const groupsData = groupsRes.ok
    ? ((await groupsRes.json()) as { id?: number; data?: { name?: string } }[])
    : [];
  const groups = (Array.isArray(groupsData) ? groupsData : [])
    .filter((g) => g.id && g.data?.name)
    .map((g) => ({ id: String(g.id!), name: g.data!.name! }));

  // Fetch collections from the selected library (personal or a specific group)
  const base = groupId
    ? `https://api.zotero.org/groups/${groupId}`
    : `https://api.zotero.org/users/${uid}`;
  const collections = await fetchCollections(base, key);

  return Response.json({ collections, groups });
}
