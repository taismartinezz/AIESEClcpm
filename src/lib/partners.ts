import type { Partner, PartnerActivity, PartnerContact, PartnerStage } from "@/types";

export const PARTNER_STAGES: { code: PartnerStage; label: string }[] = [
  { code: "lead",        label: "Lead" },
  { code: "contacted",   label: "Contacted" },
  { code: "meeting",     label: "Meeting" },
  { code: "proposal",    label: "Proposal" },
  { code: "negotiation", label: "Negotiation" },
  { code: "partner",     label: "Partner" },
  { code: "lost",        label: "Lost" },
];
export const PARTNER_STAGE_LABEL = Object.fromEntries(PARTNER_STAGES.map((s) => [s.code, s.label])) as Record<PartnerStage, string>;

export function mapPartner(row: Record<string, unknown>): Partner {
  const s = (k: string) => (row[k] as string | null) ?? null;
  return {
    id: row.id as string, projectId: row.project_id as string, name: row.name as string,
    industry: s("industry"), website: s("website"), stage: row.stage as PartnerStage,
    departmentId: s("department_id"), ownerId: s("owner_id"), nextFollowUp: s("next_follow_up"),
    notes: s("notes"), updatedAt: row.updated_at as string,
  };
}

export function mapContact(row: Record<string, unknown>): PartnerContact {
  const s = (k: string) => (row[k] as string | null) ?? null;
  return { id: row.id as string, partnerId: row.partner_id as string, name: row.name as string, roleTitle: s("role_title"), email: s("email"), phone: s("phone") };
}

export function mapActivity(row: Record<string, unknown>): PartnerActivity {
  return {
    id: row.id as string, partnerId: row.partner_id as string, kind: row.kind as PartnerActivity["kind"],
    body: row.body as string, happenedOn: row.happened_on as string, authorId: (row.author_id as string | null) ?? null,
  };
}

/** "overdue" | "soon" (within 7 days) | null, for a follow-up date. */
export function followUpState(date: string | null, today = new Date().toISOString().slice(0, 10)): "overdue" | "soon" | null {
  if (!date) return null;
  if (date < today) return "overdue";
  const soon = new Date(new Date(today + "T00:00:00Z").getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  return date <= soon ? "soon" : null;
}
