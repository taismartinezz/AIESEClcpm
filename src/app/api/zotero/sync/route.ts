// Zotero Web API v3 proxy - fetches items in CSL JSON format for a user library.
// Runs server-side so the API key is never exposed in browser network requests.

export const runtime = "nodejs";

import { requireAuth } from "@/lib/api-auth";

// Canopy uses five highlight colors. Zotero uses a broader palette - map to nearest.
const ZOTERO_COLOR_MAP: Record<string, string> = {
  "#ffd400": "#FBBF24", // yellow → yellow
  "#ff6666": "#F87171", // red    → red
  "#5fb236": "#34D399", // green  → green
  "#2ea8e5": "#60A5FA", // blue   → blue
  "#a28ae5": "#A78BFA", // purple → purple
  "#e56eee": "#A78BFA", // magenta → purple (closest)
  "#f19837": "#FBBF24", // orange  → yellow (closest)
  "#aaaaaa": "#FBBF24", // grey    → yellow (default)
};

function mapZoteroColor(hex?: string): string {
  if (!hex) return "#FBBF24";
  const lower = hex.toLowerCase();
  return ZOTERO_COLOR_MAP[lower] ?? "#FBBF24";
}

// Convert a Zotero PDF annotation position (PDF coordinate space, origin at
// bottom-left) to Canopy's normalized bbox (0–1 fractions, origin at top-left).
// Uses US Letter (612 × 792 pt) as the default page size, which produces < 3%
// error on A4 pages - acceptable for highlight placement.
function zoteroPosToBbox(
  pos: unknown
): { x: number; y: number; w: number; h: number } | null {
  if (!pos) return null;
  let parsed: { pageIndex?: number; rects?: number[][]; width?: number } | null = null;
  if (typeof pos === "string") {
    try { parsed = JSON.parse(pos); } catch { return null; }
  } else if (typeof pos === "object") {
    parsed = pos as unknown as typeof parsed;
  }
  if (!parsed?.rects?.length) return null;
  const rect = parsed.rects[0];
  if (!rect || rect.length < 4) return null;
  const [x1, y1, x2, y2] = rect;
  const pageW = parsed.width ?? 612;
  const pageH = 792; // height is not provided by Zotero - assume Letter
  const x = Math.max(0, Math.min(1, x1 / pageW));
  const y = Math.max(0, Math.min(1, (pageH - y2) / pageH)); // flip Y axis
  const w = Math.max(0, Math.min(1, (x2 - x1) / pageW));
  const h = Math.max(0, Math.min(1, (y2 - y1) / pageH));
  if (w < 0.001 || h < 0.001) return null; // degenerate rect
  return { x, y, w, h };
}

export interface ZoteroAnnotation {
  zoteroKey: string;
  type: "highlight" | "note" | "underline" | "image" | "ink" | "other";
  text: string;
  comment: string;
  color: string;
  pageNumber: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
}

export async function POST(request: Request) {
  const callerId = await requireAuth(request);
  if (!callerId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { apiKey, zoteroUserId, groupId, collectionKey } = (await request.json()) as {
    apiKey?: string;
    zoteroUserId?: string;
    groupId?: string;
    collectionKey?: string;
  };

  if (!apiKey?.trim() || !zoteroUserId?.trim()) {
    return Response.json({ error: "apiKey and zoteroUserId are required" }, { status: 400 });
  }

  const base = groupId
    ? `https://api.zotero.org/groups/${groupId}`
    : `https://api.zotero.org/users/${zoteroUserId}`;

  // When a collection key is provided, scope items to that collection.
  // &recursive=1 ensures sub-collections are included, matching the CSL JSON pass behavior.
  const itemsPath = collectionKey
    ? `${base}/collections/${collectionKey}/items`
    : `${base}/items`;
  const recursiveSuffix = collectionKey ? "&recursive=1" : "";

  // First pass: fetch all non-attachment items in CSL JSON format (batched)
  const items: unknown[] = [];
  let start = 0;
  const limit = 100;

  while (true) {
    const url = `${itemsPath}?format=csljson&limit=${limit}&start=${start}&itemType=-attachment${recursiveSuffix}`;
    const res = await fetch(url, {
      headers: {
        "Zotero-API-Key": apiKey,
        "Zotero-API-Version": "3",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `Zotero API error ${res.status}: ${text}` }, { status: 502 });
    }

    const data = (await res.json()) as { items?: unknown[] } | unknown[];
    const batch = Array.isArray(data)
      ? data
      : (data as { items?: unknown[] }).items ?? [];

    items.push(...batch);

    if (batch.length < limit) break;
    start += limit;
    if (start > 5000) break;
  }

  // Second pass: discover PDF attachments stored in Zotero cloud.
  // Both "imported_file" (added from local) and "imported_url" (added from URL) mean the
  // PDF is stored in Zotero cloud - group libraries predominantly use "imported_url".
  // Also builds attachmentParentMap (attachmentKey → parentItemKey) for the annotation pass.
  // Also tracks linkedUrlItems (parentKey → url) - items with only a linked/web URL and no
  // stored PDF, so the UI can show a distinct "no PDF available" message instead of "Attach PDF".
  const pdfAttachments: Record<string, { attachmentKey: string; filename: string }> = {};
  const attachmentParentMap: Record<string, string> = {};
  const linkedUrlItems: Record<string, true> = {};
  // Child items (attachments, notes) are never direct collection members - the collection-scoped
  // endpoint always returns 0 for itemType=attachment/note. Always query the library root
  // (${base}/items) so child items are found regardless of whether a collection filter is active.
  // The resulting maps are naturally filtered downstream because only items whose parentItem
  // matches a key from the first-pass CSL response will ever be looked up.
  const childItemsBase = `${base}/items`;
  let attStart = 0;
  while (true) {
    const attUrl = `${childItemsBase}?itemType=attachment&format=json&limit=100&start=${attStart}`;
    const attRes = await fetch(attUrl, {
      headers: { "Zotero-API-Key": apiKey, "Zotero-API-Version": "3" },
    });
    if (!attRes.ok) break;
    const attBatch = (await attRes.json()) as Array<{
      key: string;
      data: {
        parentItem?: string;
        contentType?: string;
        title?: string;
        linkMode?: string;
        url?: string;
      };
    }>;
    if (!Array.isArray(attBatch) || attBatch.length === 0) break;
    for (const att of attBatch) {
      const { parentItem, contentType, title, linkMode } = att.data ?? {};
      // Track every attachment for annotation resolution
      if (parentItem) attachmentParentMap[att.key] = parentItem;
      // Accept both linkModes - both mean the file lives in Zotero cloud storage
      if (
        contentType === "application/pdf" &&
        (linkMode === "imported_file" || linkMode === "imported_url") &&
        parentItem &&
        !pdfAttachments[parentItem]
      ) {
        pdfAttachments[parentItem] = {
          attachmentKey: att.key,
          filename: title ?? "attachment.pdf",
        };
      }
      // Track linked-URL-only items (linked_url / linked_file = not stored in Zotero cloud)
      if (parentItem && linkMode === "linked_url" && !pdfAttachments[parentItem]) {
        linkedUrlItems[parentItem] = true;
      }
    }
    if (attBatch.length < 100) break;
    attStart += 100;
    if (attStart > 5000) break;
  }
  // Clear linkedUrlItems for any parent that DOES have a stored PDF
  for (const key of Object.keys(pdfAttachments)) {
    delete linkedUrlItems[key];
  }

  // Third pass: fetch all child text notes and map parentItem key → HTML strings.
  const notesMap: Record<string, string[]> = {};
  let noteStart = 0;
  while (true) {
    const noteUrl = `${childItemsBase}?itemType=note&format=json&limit=100&start=${noteStart}`;
    const noteRes = await fetch(noteUrl, {
      headers: { "Zotero-API-Key": apiKey, "Zotero-API-Version": "3" },
    });
    if (!noteRes.ok) break;
    const noteBatch = (await noteRes.json()) as Array<{
      key: string;
      data: { parentItem?: string; note?: string };
    }>;
    if (!Array.isArray(noteBatch) || noteBatch.length === 0) break;
    for (const n of noteBatch) {
      const parent = n.data?.parentItem;
      const html = n.data?.note;
      if (parent && html) {
        if (!notesMap[parent]) notesMap[parent] = [];
        notesMap[parent].push(html);
      }
    }
    if (noteBatch.length < 100) break;
    noteStart += 100;
    if (noteStart > 5000) break;
  }

  // Fourth pass: fetch PDF annotation items as STRUCTURED objects.
  // Annotations are resolved to their top-level item key via:
  //   annotation.parentItem → PDF attachment key → top-level item key
  // Returns annotationsMap: Record<topItemKey, ZoteroAnnotation[]>
  //
  // IMPORTANT: annotations are GRANDCHILDREN of top-level items (child of PDF
  // attachment, which is child of the main item). Zotero's collection-scoped
  // endpoint only returns direct children - querying itemsPath?itemType=annotation
  // returns 0 results when a collection is selected. Always use the library root
  // so we get all annotations; attachmentParentMap then filters to only those
  // belonging to items we actually processed.
  const annotationsBase = `${base}/items`;
  const annotationsMap: Record<string, ZoteroAnnotation[]> = {};
  let annStart = 0;
  while (true) {
    const annUrl = `${annotationsBase}?itemType=annotation&format=json&limit=100&start=${annStart}`;
    const annRes = await fetch(annUrl, {
      headers: { "Zotero-API-Key": apiKey, "Zotero-API-Version": "3" },
    });
    if (!annRes.ok) break;
    const annBatch = (await annRes.json()) as Array<{
      key: string;
      data: {
        parentItem?: string;
        annotationType?: string;
        annotationText?: string;
        annotationComment?: string;
        annotationColor?: string;
        annotationPageLabel?: string;
        annotationPosition?: unknown;
      };
    }>;
    if (!Array.isArray(annBatch) || annBatch.length === 0) break;
    for (const ann of annBatch) {
      const attachKey = ann.data?.parentItem;
      if (!attachKey) continue;
      const topKey = attachmentParentMap[attachKey];
      if (!topKey) continue;

      const {
        annotationType, annotationText, annotationComment,
        annotationColor, annotationPageLabel, annotationPosition,
      } = ann.data;

      // Parse position once - shared by both pageNumber and bbox.
      // pageIndex is 0-based and maps directly to PDF viewer page numbers (pageIndex 0 = page 1).
      // annotationPageLabel is the *printed* journal page (e.g. "77" for an article on pp. 77–101)
      // which does NOT correspond to the PDF's internal page numbers, so we prefer pageIndex.
      let parsedPos: { pageIndex?: number; rects?: number[][]; width?: number } | null = null;
      if (annotationPosition) {
        if (typeof annotationPosition === "string") {
          try { parsedPos = JSON.parse(annotationPosition); } catch { /* ignore */ }
        } else if (typeof annotationPosition === "object") {
          parsedPos = annotationPosition as unknown as typeof parsedPos;
        }
      }
      const pageNumber =
        typeof parsedPos?.pageIndex === "number" ? parsedPos.pageIndex + 1
        : annotationPageLabel ? Math.max(1, parseInt(annotationPageLabel, 10))
        : 1;

      const bbox = zoteroPosToBbox(annotationPosition);
      const type =
        annotationType === "highlight" ? "highlight"
        : annotationType === "note"      ? "note"
        : annotationType === "underline" ? "underline"
        : annotationType === "image"     ? "image"
        : annotationType === "ink"       ? "ink"
        : "other";

      const annot: ZoteroAnnotation = {
        zoteroKey: ann.key,
        type,
        text: annotationText ?? "",
        comment: annotationComment ?? "",
        color: mapZoteroColor(annotationColor),
        pageNumber,
        bbox,
      };

      if (!annotationsMap[topKey]) annotationsMap[topKey] = [];
      annotationsMap[topKey].push(annot);
    }
    if (annBatch.length < 100) break;
    annStart += 100;
    if (annStart > 5000) break;
  }
  const annotItemCount = Object.keys(annotationsMap).length;
  const annotTotal = Object.values(annotationsMap).reduce((s, a) => s + a.length, 0);
  console.log(`[ZoteroSync] annotations found: ${annotTotal} across ${annotItemCount} item(s)`);

  // Fifth pass: native JSON items to collect Zotero tags AND detect CSL-drop gaps.
  // CSL JSON format does not include Zotero-specific tags - a separate native-format
  // pass is required. Each item's key matches the key embedded in the CSL id URI.
  // We also use this pass to cross-reference against the CSL JSON output: if an item
  // is present in native JSON but absent from CSL JSON, it was silently dropped by
  // Zotero's CSL serializer. We surface those as droppedItems in the response.
  const tagsMap: Record<string, string[]> = {};
  const nativeItems: { key: string; title: string }[] = [];
  let tagStart = 0;
  while (true) {
    const tagUrl = `${itemsPath}?format=json&limit=100&start=${tagStart}&itemType=-attachment${recursiveSuffix}`;
    const tagRes = await fetch(tagUrl, {
      headers: { "Zotero-API-Key": apiKey, "Zotero-API-Version": "3" },
    });
    if (!tagRes.ok) break;
    const tagBatch = (await tagRes.json()) as Array<{
      key: string;
      data: { tags?: Array<{ tag: string }>; title?: string };
    }>;
    if (!Array.isArray(tagBatch) || tagBatch.length === 0) break;
    for (const t of tagBatch) {
      nativeItems.push({ key: t.key, title: t.data?.title ?? "" });
      if (t.data?.tags?.length) {
        tagsMap[t.key] = t.data.tags.map((tag) => tag.tag).filter(Boolean);
      }
    }
    if (tagBatch.length < 100) break;
    tagStart += 100;
    if (tagStart > 5000) break;
  }

  // Keys present in the CSL JSON first pass (extracted from the id URI field)
  const cslKeys = new Set(
    (items as Array<{ id?: string }>)
      .map((z) => z.id?.split("/").pop())
      .filter(Boolean) as string[]
  );
  const droppedItems = nativeItems
    .filter(({ key }) => !cslKeys.has(key))
    .map(({ key, title }) => ({ key, title }));

  if (droppedItems.length > 0) {
    console.warn(
      `[ZoteroSync] ${droppedItems.length} item(s) present in native JSON but missing from CSL JSON:`,
      droppedItems.map((d) => `${d.key}: "${d.title}"`).join(", ")
    );
  }

  return Response.json({
    items, pdfAttachments, notesMap, tagsMap, droppedItems,
    annotationsMap, linkedUrlItems,
  });
}
