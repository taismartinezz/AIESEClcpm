// Import an EXPA CSV export into the exchange pipeline.
//
// EXPA's export columns differ between screens and over time, so columns are
// matched by name (with common aliases) and the person can correct the
// mapping before importing. Rows are matched to existing exchanges by EXPA ID
// in the database (import_exchanges), so the same file can be imported again.

import type { ExchangeStage } from "@/lib/products";
import { guessColumns, normHeader, toIsoDate, type FieldSpec } from "@/lib/sheet-import";

export { parseCsv, toIsoDate } from "@/lib/sheet-import";

export type ImportField =
  | "expa_id" | "person_name" | "last_name" | "email" | "phone" | "status" | "opportunity" | "host_entity" | "expa_url"
  | "signed_up_at" | "applied_at" | "accepted_at" | "approved_at" | "realized_at" | "finished_at" | "completed_at";

export const IMPORT_FIELDS: FieldSpec<ImportField>[] = [
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

/** Best guess of which column holds each field (index into the header row, or -1). */
export function guessMapping(headers: string[]): Record<ImportField, number> {
  return guessColumns(headers, IMPORT_FIELDS);
}

/** EXPA status → pipeline stage; null for rejected / withdrawn / broken applications. */
export function statusToStage(status: string): ExchangeStage | null | undefined {
  const s = normHeader(status);
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
