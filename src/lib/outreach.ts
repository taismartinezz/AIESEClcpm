// oGX outreach templates: merge fields and rendering. Shared by the editor
// (preview, validation) and the sending job.

export const MERGE_FIELDS: { key: string; label: string; sample: string }[] = [
  { key: "first_name",  label: "First name",          sample: "Ana" },
  { key: "full_name",   label: "Full name",           sample: "Ana Silva" },
  { key: "lc_name",     label: "LC name",             sample: "AIESEC in Lisbon" },
  { key: "sender_name", label: "Your name",           sample: "Marta" },
  { key: "product",     label: "Programme",           sample: "Global Volunteer" },
  { key: "opportunity", label: "Project / position",  sample: "Teaching English to kids" },
  { key: "host_entity", label: "Host / home LC",      sample: "AIESEC in Bogotá" },
  { key: "project_link", label: "EXPA link",          sample: "https://aiesec.org/opportunity/123" },
];

const FIELD = /\{([a-z_]+)\}/g;

/** Merge fields used in a text that the app doesn't know (typos like {firstname}). */
export function unknownFields(text: string): string[] {
  const known = new Set(MERGE_FIELDS.map((f) => f.key));
  return [...new Set([...text.matchAll(FIELD)].map((m) => m[1]).filter((k) => !known.has(k)))];
}

/** Fill merge fields; empty values become "" and missing optional ones read naturally. */
export function renderTemplate(text: string, values: Record<string, string | null | undefined>): string {
  return text.replace(FIELD, (whole, key: string) => (key in values ? (values[key] ?? "").trim() : whole)).replace(/[ \t]{2,}/g, " ");
}

export const SAMPLE_VALUES = Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.sample]));

export const PRODUCT_NAMES: Record<string, string> = {
  ogv: "Global Volunteer", ogta: "Global Talent", ogte: "Global Teacher",
  igv: "Global Volunteer", igta: "Global Talent", igte: "Global Teacher",
};

export function valuesFor(ex: { person_name: string; product: string; opportunity: string | null; host_entity: string | null; expa_url: string | null },
  lcName: string, senderName: string): Record<string, string> {
  return {
    first_name: ex.person_name.trim().split(/\s+/)[0] ?? ex.person_name,
    full_name: ex.person_name.trim(),
    lc_name: lcName,
    sender_name: senderName.trim().split(/\s+/)[0] ?? senderName,
    product: PRODUCT_NAMES[ex.product] ?? ex.product,
    opportunity: ex.opportunity ?? "",
    host_entity: ex.host_entity ?? "",
    project_link: ex.expa_url ?? "",
  };
}

export const TEMPLATE_STATUS_LABEL = { draft: "Draft", pending: "Waiting for approval", approved: "Approved", rejected: "Changes requested" } as const;
