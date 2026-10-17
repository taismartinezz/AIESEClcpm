// Tracker import targets: what each tracker's columns mean, and how a CSV row
// becomes a row for the matching import_* database function. Pure functions,
// so they are unit-tested; the wizard (components/import) does the I/O.

import type { Department } from "@/types";
import type { ProductCode } from "@/lib/products";
import { IMPORT_FIELDS as EXCHANGE_FIELDS, buildImport as buildExchanges } from "@/lib/expa-import";
import { matchByName, normHeader, toIsoDate, type FieldSpec } from "@/lib/sheet-import";

export type ImportTargetId = "exchanges" | "partners" | "recruits" | "tasks";

export interface ImportContext {
  departments: Department[];
  roster: { id: string; name: string }[];
  /** Used when a row names no department (members may only add to their own). */
  defaultDepartmentId: string | null;
  product: ProductCode;
}

export interface BuiltImport {
  rows: Record<string, unknown>[];
  /** Rows left out on purpose (rejected applications, empty lines…), with why. */
  leftOut: { count: number; reason: string }[];
  /** Values we couldn't match (e.g. an unknown department name), shown as a warning. */
  unmatched: string[];
}

export interface ImportTarget {
  id: ImportTargetId;
  title: string;
  /** Used in "Import …" buttons and titles. */
  noun: string;
  description: string;
  rpc: "import_exchanges" | "import_partners" | "import_recruits" | "import_tasks";
  /** Fields that need a column before importing (any one of them). */
  requiresOneOf: string[];
  fields: FieldSpec[];
  build: (data: string[][], mapping: Record<string, number>, ctx: ImportContext) => BuiltImport;
}

const cell = (line: string[], mapping: Record<string, number>, f: string) => (mapping[f] >= 0 ? (line[mapping[f]] ?? "").trim() : "");

function departmentFor(value: string, ctx: ImportContext, unmatched: Set<string>): string | null {
  if (!value) return ctx.defaultDepartmentId;
  const d = matchByName(value, ctx.departments, (x) => [x.name, initials(x.name)]);
  if (!d) { unmatched.add(`department "${value}"`); return ctx.defaultDepartmentId; }
  return d.id;
}

/** "Outgoing Global Volunteer" → "ogv", so sheets can say oGV. */
function initials(name: string): string {
  return name.split(/[\s/&]+/).filter(Boolean).map((w) => w[0]).join("").toLowerCase();
}

function pick<T extends string>(value: string, table: [RegExp, T][]): T | undefined {
  const v = normHeader(value);
  if (!v) return undefined;
  return table.find(([re]) => re.test(v))?.[1];
}

// ── Partners ──────────────────────────────────────────────────────────────────

const PARTNER_FIELDS: FieldSpec[] = [
  { field: "name",           label: "Organisation",     aliases: ["company", "organisation", "organization", "company name", "partner", "name", "org"] },
  { field: "industry",       label: "Industry",         aliases: ["industry", "sector", "type"] },
  { field: "website",        label: "Website",          aliases: ["website", "web", "url", "site"] },
  { field: "stage",          label: "Stage / status",   aliases: ["stage", "status", "pipeline stage"] },
  { field: "department",     label: "Department",       aliases: ["department", "dept", "area", "product", "team"] },
  { field: "next_follow_up", label: "Next follow-up",   aliases: ["next follow up", "follow up", "follow up date", "next step date", "next contact"] },
  { field: "notes",          label: "Notes",            aliases: ["notes", "comments", "comment", "remarks"] },
  { field: "contact_name",   label: "Contact name",     aliases: ["contact name", "contact", "contact person", "poc"] },
  { field: "contact_role",   label: "Contact role",     aliases: ["contact role", "position", "job title", "role"] },
  { field: "contact_email",  label: "Contact email",    aliases: ["contact email", "email", "e mail"] },
  { field: "contact_phone",  label: "Contact phone",    aliases: ["contact phone", "phone", "phone number", "mobile"] },
];

const PARTNER_STAGE_WORDS: [RegExp, string][] = [
  [/(lost|declin|reject|no deal|dead)/, "lost"], [/(partner|signed|closed won|won|active)/, "partner"],
  [/negotiat/, "negotiation"], [/(proposal|offer|pitch)/, "proposal"], [/(meeting|met|call)/, "meeting"],
  [/(contact|reached|emailed|sent)/, "contacted"], [/(lead|prospect|to contact|new|research)/, "lead"],
];

// ── Recruits ──────────────────────────────────────────────────────────────────

const RECRUIT_FIELDS: FieldSpec[] = [
  { field: "name",       label: "Name",           aliases: ["full name", "name", "first name", "applicant", "candidate"] },
  { field: "last_name",  label: "Last name",      aliases: ["last name", "surname", "family name"] },
  { field: "email",      label: "Email",          aliases: ["email", "email address", "e mail", "university email"] },
  { field: "phone",      label: "Phone",          aliases: ["phone", "phone number", "mobile", "whatsapp"] },
  { field: "source",     label: "Where they heard about us", aliases: ["source", "how did you hear about us", "how did you hear", "channel", "referral"] },
  { field: "department", label: "Department of interest", aliases: ["department", "area of interest", "preferred department", "department of interest", "interest", "first choice"] },
  { field: "stage",      label: "Status",         aliases: ["status", "stage", "result", "decision"] },
  { field: "applied_on", label: "Applied on",     aliases: ["timestamp", "applied", "date", "application date", "submitted"] },
  { field: "notes",      label: "Notes",          aliases: ["notes", "comments", "interview notes", "remarks"] },
];

const RECRUIT_STAGE_WORDS: [RegExp, string][] = [
  [/(withdr|dropped|no show)/, "withdrawn"], [/(reject|not accepted|declin|no$)/, "rejected"],
  [/(joined|member|onboard|accepted|yes$)/, "joined"], [/(offer)/, "offer"],
  [/(interview|scheduled)/, "interview"], [/(appl|new|pending)/, "applied"],
];

// ── Tasks ─────────────────────────────────────────────────────────────────────

const TASK_FIELDS: FieldSpec[] = [
  { field: "title",       label: "Task",          aliases: ["task", "title", "to do", "todo", "action", "action item", "name"] },
  { field: "description", label: "Details",       aliases: ["description", "details", "notes", "comments"] },
  { field: "status",      label: "Status",        aliases: ["status", "state", "progress", "done"] },
  { field: "priority",    label: "Priority",      aliases: ["priority", "urgency", "importance"] },
  { field: "due_date",    label: "Due date",      aliases: ["due date", "due", "deadline", "date"] },
  { field: "department",  label: "Department",    aliases: ["department", "dept", "area", "team"] },
  { field: "assignees",   label: "Responsible",   aliases: ["responsible", "assignee", "assignees", "owner", "who", "assigned to", "person in charge"] },
];

const TASK_STATUS_WORDS: [RegExp, string][] = [
  [/(done|complete|finished|true|yes|x$)/, "done"], [/(review|check)/, "in_review"],
  [/(progress|doing|ongoing|started|wip)/, "in_progress"], [/(backlog|later|someday|idea)/, "backlog"], [/(to do|todo|open|pending|not started|false|no$)/, "todo"],
];
const PRIORITY_WORDS: [RegExp, string][] = [[/(high|urgent|critical|p1|1$)/, "high"], [/(low|p3|3$)/, "low"], [/(med|normal|p2|2$)/, "medium"]];

// ── Targets ───────────────────────────────────────────────────────────────────

export const IMPORT_TARGETS: Record<ImportTargetId, ImportTarget> = {
  exchanges: {
    id: "exchanges",
    title: "Exchanges (EXPA or oGX/iGX tracker)",
    noun: "exchanges",
    description: "Sign-ups and applications, per product. Re-importing updates people with the same EXPA ID.",
    rpc: "import_exchanges",
    requiresOneOf: ["person_name", "expa_id"],
    fields: EXCHANGE_FIELDS,
    build(data, mapping) {
      const plan = buildExchanges(data, mapping as Parameters<typeof buildExchanges>[1]);
      return {
        rows: plan.rows,
        leftOut: [
          ...(plan.skipped ? [{ count: plan.skipped, reason: "rejected or withdrawn" }] : []),
          ...(plan.empty ? [{ count: plan.empty, reason: "without a name or EXPA ID" }] : []),
        ],
        unmatched: [],
      };
    },
  },
  partners: {
    id: "partners",
    title: "Partners (B2B / sponsor tracker)",
    noun: "partners",
    description: "Companies and organisations, their stage and a contact. Matched by name on re-import.",
    rpc: "import_partners",
    requiresOneOf: ["name"],
    fields: PARTNER_FIELDS,
    build(data, mapping, ctx) {
      const unmatched = new Set<string>();
      let empty = 0;
      const rows = data.flatMap((line) => {
        const name = cell(line, mapping, "name");
        if (!name) { empty++; return []; }
        const stageText = cell(line, mapping, "stage");
        const stage = pick(stageText, PARTNER_STAGE_WORDS);
        if (stageText && !stage) unmatched.add(`stage "${stageText}"`);
        const website = cell(line, mapping, "website");
        return [{
          name, stage: stage ?? "lead",
          industry: cell(line, mapping, "industry") || undefined,
          website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : undefined,
          department_id: departmentFor(cell(line, mapping, "department"), ctx, unmatched),
          next_follow_up: toIsoDate(cell(line, mapping, "next_follow_up")) ?? undefined,
          notes: cell(line, mapping, "notes") || undefined,
          contact_name: cell(line, mapping, "contact_name") || undefined,
          contact_role: cell(line, mapping, "contact_role") || undefined,
          contact_email: cell(line, mapping, "contact_email") || undefined,
          contact_phone: cell(line, mapping, "contact_phone") || undefined,
        }];
      });
      return { rows, leftOut: empty ? [{ count: empty, reason: "without an organisation name" }] : [], unmatched: [...unmatched] };
    },
  },
  recruits: {
    id: "recruits",
    title: "Recruitment (applications to join the LC)",
    noun: "applications",
    description: "People who applied to become members, e.g. your Google Form responses. Matched by email on re-import.",
    rpc: "import_recruits",
    requiresOneOf: ["name"],
    fields: RECRUIT_FIELDS,
    build(data, mapping, ctx) {
      const unmatched = new Set<string>();
      let empty = 0;
      const rows = data.flatMap((line) => {
        const name = [cell(line, mapping, "name"), cell(line, mapping, "last_name")].filter(Boolean).join(" ");
        if (!name) { empty++; return []; }
        const stageText = cell(line, mapping, "stage");
        const stage = pick(stageText, RECRUIT_STAGE_WORDS);
        if (stageText && !stage) unmatched.add(`status "${stageText}"`);
        const dept = cell(line, mapping, "department");
        return [{
          name, stage: stage ?? "applied",
          email: cell(line, mapping, "email") || undefined,
          phone: cell(line, mapping, "phone") || undefined,
          source: cell(line, mapping, "source") || undefined,
          department_id: dept ? departmentFor(dept, { ...ctx, defaultDepartmentId: null }, unmatched) : null,
          applied_on: toIsoDate(cell(line, mapping, "applied_on")) ?? undefined,
          notes: cell(line, mapping, "notes") || undefined,
        }];
      });
      return { rows, leftOut: empty ? [{ count: empty, reason: "without a name" }] : [], unmatched: [...unmatched] };
    },
  },
  tasks: {
    id: "tasks",
    title: "Tasks (to-do or action-item sheet)",
    noun: "tasks",
    description: "Action items with a due date and who is responsible. Identical tasks (same title and due date) are skipped.",
    rpc: "import_tasks",
    requiresOneOf: ["title"],
    fields: TASK_FIELDS,
    build(data, mapping, ctx) {
      const unmatched = new Set<string>();
      let empty = 0;
      const rows = data.flatMap((line) => {
        const title = cell(line, mapping, "title");
        if (!title) { empty++; return []; }
        const assignees = cell(line, mapping, "assignees").split(/[,;/&+]| and /).map((s) => s.trim()).filter(Boolean);
        const assigneeIds = assignees.flatMap((n) => {
          const m = matchByName(n, ctx.roster, (p) => [p.name, p.name.split(/\s+/)[0]]);
          if (!m) unmatched.add(`person "${n}"`);
          return m ? [m.id] : [];
        });
        const dept = cell(line, mapping, "department");
        return [{
          title,
          description: cell(line, mapping, "description"),
          status: pick(cell(line, mapping, "status"), TASK_STATUS_WORDS) ?? "todo",
          priority: pick(cell(line, mapping, "priority"), PRIORITY_WORDS) ?? "medium",
          due_date: toIsoDate(cell(line, mapping, "due_date")) ?? undefined,
          department_id: dept ? departmentFor(dept, { ...ctx, defaultDepartmentId: null }, unmatched) : null,
          assignee_ids: [...new Set(assigneeIds)],
        }];
      });
      return { rows, leftOut: empty ? [{ count: empty, reason: "without a title" }] : [], unmatched: [...unmatched] };
    },
  },
};
