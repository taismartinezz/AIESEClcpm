// Import an EXPA CSV export into the exchange pipeline.
//
// EXPA's export columns differ between screens and over time, so columns are
// matched by name (with common aliases) and the person can correct the
// mapping before importing. Rows are matched to existing exchanges by EXPA ID
// in the database (import_exchanges), so the same file can be imported again.

import type { ExchangeStage } from "@/lib/products";

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

export type ImportField =
  | "expa_id" | "person_name" | "last_name" | "email" | "phone" | "status" | "opportunity" | "host_entity" | "expa_url"
  | "signed_up_at" | "applied_at" | "accepted_at" | "approved_at" | "realized_at" | "finished_at" | "completed_at";

export const IMPORT_FIELDS: { field: ImportField; label: string; aliases: string[] }[] = [
  { field: "expa_id",      label: "EXPA application ID", aliases: ["application id", "app id", "expa id", "id", "ep id", "person id"] },
  { field: "person_name",  label: "Name",                aliases: ["full name", "name", "ep name", "person name", "person", "first name"] },
  { field: "last_name",    label: "Last name",           aliases: ["last name", "surname", "family name"] },
  { field: "email",        label: "Email",               aliases: ["email", "e mail", "ep email", "email address"] },
  { field: "phone",        label: "Phone",               aliases: ["phone", "phone number", "contact number", "mobile"] },
  { field: "status",       label: "Status",              aliases: ["status", "application status", "stage", "current status"] },
  { field: "opportunity",  label: "Project / position",  aliases: ["opportunity", "opportunity title", "opportunity name", "project", "project name", "position", "title"] },
  { field: "host_entity",  label: "Host / home LC",      aliases: ["host lc", "host entity", "host", "home lc", "home entity", "host mc", "home mc", "lc", "entity"] },
  { field: "expa_url",     label: "EXPA link",           aliases: ["link", "url", "expa link", "application link"] },
  { field: "signed_up_at", label: "Signed up on",        aliases: ["signed up", "sign up date", "signup date", "registered", "registration date", "person created at"] },
  { field: "applied_at",   label: "Applied on",          aliases: ["applied", "applied at", "date applied", "applied on", "application date", "created at"] },
  { field: "accepted_at",  label: "Accepted on",         aliases: ["accepted", "accepted at", "date accepted", "matched", "matched at", "date matched"] },
  { field: "approved_at",  label: "Approved on",         aliases: ["approved", "approved at", "date approved", "approval date"] },
  { field: "realized_at",  label: "Realized on",         aliases: ["realized", "realized at", "date realized", "realised", "realization date", "experience start date"] },
  { field: "finished_at",  label: "Finished on",         aliases: ["finished", "finished at", "date finished", "experience end date"] },
  { field: "completed_at", label: "Completed on",        aliases: ["completed", "completed at", "date completed"] },
];

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best guess of which column holds each field (index into the header row, or -1). */
export function guessMapping(headers: string[]): Record<ImportField, number> {
  const normalized = headers.map(norm);
  const used = new Set<number>();
  const mapping = {} as Record<ImportField, number>;
  // Exact alias matches first (in alias order), then "header contains alias".
  for (const pass of ["exact", "contains"] as const) {
    for (const { field, aliases } of IMPORT_FIELDS) {
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

/** EXPA status → pipeline stage; null for rejected / withdrawn / broken applications. */
export function statusToStage(status: string): ExchangeStage | null | undefined {
  const s = norm(status);
  if (!s) return undefined;
  if (/(reject|withdraw|declin|broken|break|cancel|deleted|expired|ineligible)/.test(s)) return null;
  if (/complet/.test(s)) return "completed";
  if (/finish/.test(s)) return "finished";
  if (/reali[sz]/.test(s)) return "realized";
  if (/approv/.test(s)) return "approved";
  if (/(accept|match)/.test(s)) return "accepted";
  if (/(appl)/.test(s)) return "applied";
  if (/(open|sign|regist|lead|new)/.test(s)) return "signed_up";
  return undefined;
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

const DATE_FIELDS: [ImportField, ExchangeStage][] = [
  ["completed_at", "completed"], ["finished_at", "finished"], ["realized_at", "realized"],
  ["approved_at", "approved"], ["accepted_at", "accepted"], ["applied_at", "applied"],
];

export type ImportRow = Partial<Record<Exclude<ImportField, "status" | "last_name">, string>> & { stage: ExchangeStage };

export interface ImportPlan {
  rows: ImportRow[];
  /** Rejected / withdrawn applications, left out. */
  skipped: number;
  /** Rows without a name or EXPA ID, left out. */
  empty: number;
}

/** Turn CSV rows into import_exchanges() payload rows using the mapping. */
export function buildImport(data: string[][], mapping: Record<ImportField, number>): ImportPlan {
  const rows: ImportRow[] = [];
  let skipped = 0, empty = 0;
  for (const line of data) {
    const get = (f: ImportField) => (mapping[f] >= 0 ? (line[mapping[f]] ?? "").trim() : "");
    const name = [get("person_name"), get("last_name")].filter(Boolean).join(" ");
    const expaId = get("expa_id");
    if (!name && !expaId) { empty++; continue; }

    const dates: Partial<Record<ImportField, string>> = {};
    for (const f of ["signed_up_at", "applied_at", "accepted_at", "approved_at", "realized_at", "finished_at", "completed_at"] as const) {
      const d = toIsoDate(get(f));
      if (d) dates[f] = d;
    }
    const fromStatus = mapping.status >= 0 ? statusToStage(get("status")) : undefined;
    if (fromStatus === null) { skipped++; continue; }
    const fromDates = DATE_FIELDS.find(([f]) => dates[f])?.[1];
    const stage: ExchangeStage = fromStatus ?? fromDates ?? "signed_up";

    const url = get("expa_url");
    rows.push({
      stage,
      ...(expaId ? { expa_id: expaId } : {}),
      ...(name ? { person_name: name } : {}),
      ...(get("email") ? { email: get("email") } : {}),
      ...(get("phone") ? { phone: get("phone") } : {}),
      ...(get("opportunity") ? { opportunity: get("opportunity") } : {}),
      ...(get("host_entity") ? { host_entity: get("host_entity") } : {}),
      ...(/^https:\/\//i.test(url) ? { expa_url: url } : {}),
      ...dates,
    });
  }
  return { rows, skipped, empty };
}
