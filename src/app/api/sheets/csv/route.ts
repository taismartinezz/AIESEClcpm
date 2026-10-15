import { requireAuth } from "@/lib/api-auth";
import { googleSheetCsvUrl } from "@/lib/sheet-import";

const MAX_BYTES = 5 * 1024 * 1024;

// POST /api/sheets/csv { url } → { csv }
// Downloads a Google Sheet shared as "Anyone with the link can view" as CSV, so
// trackers can be imported without downloading a file first. Only Google Sheets
// export URLs are fetched (built from the link, never fetched as given).
export async function POST(request: Request) {
  const userId = await requireAuth(request);
  if (!userId) return Response.json({ error: "Sign in to import" }, { status: 401 });

  let link = "";
  try { link = String((await request.json()).url ?? ""); } catch { /* handled below */ }
  const exportUrl = googleSheetCsvUrl(link);
  if (!exportUrl) {
    return Response.json({ error: "That isn't a Google Sheets link. Copy it from the browser's address bar while the sheet is open." }, { status: 400 });
  }

  try {
    const res = await fetch(exportUrl, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("text/csv")) {
      return Response.json({
        error: "Google didn't share this sheet. In the sheet, click Share → General access → \"Anyone with the link\" (Viewer), or download it as CSV and upload the file instead.",
      }, { status: 400 });
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return Response.json({ error: "The sheet is larger than 5 MB." }, { status: 413 });
    const csv = await res.text();
    if (csv.length > MAX_BYTES) return Response.json({ error: "The sheet is larger than 5 MB." }, { status: 413 });
    return Response.json({ csv });
  } catch (e) {
    const msg = e instanceof Error && e.name === "TimeoutError" ? "Google took too long to answer." : "Couldn't reach Google Sheets.";
    return Response.json({ error: `${msg} Try again, or download the sheet as CSV and upload it.` }, { status: 502 });
  }
}
