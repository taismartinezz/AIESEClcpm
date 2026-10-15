// Shared helpers for importing trackers (Google Sheets / CSV) into the app.
// Columns are matched by name with aliases; the person can correct the
// mapping before anything is written.

/** RFC 4180 CSV, with a BOM, CRLF and `;` as delimiter (European Excel) handled. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

export interface FieldSpec<F extends string = string> {
  field: F;
  label: string;
  aliases: string[];
}

export const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best guess of which column holds each field (index into the header row, or -1). */
export function guessColumns<F extends string>(headers: string[], fields: FieldSpec<F>[]): Record<F, number> {
  const normalized = headers.map(normHeader);
  const used = new Set<number>();
  const mapping = {} as Record<F, number>;
  for (const pass of ["exact", "contains"] as const) {
    for (const { field, aliases } of fields) {
      if (mapping[field] != null && mapping[field] >= 0) continue;
      let found = -1;
      for (const alias of aliases) {
        found = normalized.findIndex((h, i) => !used.has(i) && (pass === "exact" ? h === alias : alias.length >= 5 && h.includes(alias)));
        if (found >= 0) break;
      }
      mapping[field] = found;
      if (found >= 0) used.add(found);
    }
  }
  return mapping;
}

/** A date cell → YYYY-MM-DD, or null. Accepts ISO timestamps and d/m/y or m/d/y. */
export function toIsoDate(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (dmy) {
    const [a, b] = [Number(dmy[1]), Number(dmy[2])];
    // Day first unless that's impossible (AIESEC is mostly outside the US).
    const [day, month] = a > 12 || b <= 12 ? [a, b] : [b, a];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${dmy[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * A Google Sheets link → its CSV export URL (keeping the tab), or null if it
 * isn't a Google Sheets link. The sheet must be shared as "Anyone with the link".
 */
export function googleSheetCsvUrl(link: string): string | null {
  let url: URL;
  try { url = new URL(link.trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
  const m = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (!m) return null;
  const gid = url.searchParams.get("gid") ?? url.hash.match(/gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

/** Match a free-text name (department, person…) to one of `options` by name. */
export function matchByName<T>(value: string, options: T[], names: (o: T) => string[]): T | null {
  const v = normHeader(value);
  if (!v) return null;
  const exact = options.filter((o) => names(o).some((n) => normHeader(n) === v));
  if (exact.length === 1) return exact[0];
  const partial = options.filter((o) => names(o).some((n) => { const x = normHeader(n); return x.startsWith(v) || v.startsWith(x) && x.length >= 3; }));
  return partial.length === 1 ? partial[0] : null;
}
