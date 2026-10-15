import { getCrisisDefault, type CrisisDefault } from "./crisisDefaults";

// ── Shared resource shape ─────────────────────────────────────────────────────
// Compatible with DB rows from support_resources and with CrisisDefault.

export interface LabResource {
  id: string;
  label: string;
  description: string | null;
  confidentiality: string | null;
  category: string;
  contact_type: "phone" | "url" | "email" | "in_person";
  contact_value: string;
  availability: string | null;
  is_pinned: boolean;
  sort_order: number;
  active: boolean;
}

export type ResourceSource = "pi" | "registry" | "crisis";

export type ResolvedResource = LabResource & { _source: ResourceSource };

// ── Institution registry ──────────────────────────────────────────────────────

interface InstitutionEntry {
  key: string;
  name: string;
  active: boolean;
  resources: LabResource[];
}

export const INSTITUTION_REGISTRY: Record<string, InstitutionEntry> = {
  northwestern: {
    key: "northwestern",
    name: "Northwestern University",
    active: true,
    resources: [
      {
        id: "__reg__northwestern_caps_oncall",
        label: "CAPS counselor on call",
        description: "Call the CAPS line any hour and ask for the on call counselor.",
        confidentiality: "Confidential. Does not appear on your academic record.",
        category: "urgent",
        contact_type: "phone",
        contact_value: "847-491-2151",
        availability: "24/7, year round",
        is_pinned: false,
        sort_order: 0,
        active: true,
      },
      {
        id: "__reg__northwestern_caps",
        label: "Counseling and Psychological Services (CAPS)",
        description: "Free for enrolled students. Short term counseling, psychiatry, groups, and referrals.",
        confidentiality: "Confidential. Does not appear on your academic record.",
        category: "counseling",
        contact_type: "phone",
        contact_value: "847-491-2151",
        availability: "Mon to Fri 8:30am to 5pm",
        is_pinned: false,
        sort_order: 1,
        active: true,
      },
      {
        id: "__reg__northwestern_caps_website",
        label: "CAPS website",
        description: "Locations, how to book a first appointment, and the referral database.",
        confidentiality: null,
        category: "counseling",
        contact_type: "url",
        contact_value: "https://www.northwestern.edu/counseling/",
        availability: null,
        is_pinned: false,
        sort_order: 2,
        active: true,
      },
    ],
  },
};

export function getRegistryResources(institutionKey: string | null | undefined): LabResource[] {
  if (!institutionKey) return [];
  const entry = INSTITUTION_REGISTRY[institutionKey];
  if (!entry || !entry.active) return [];
  return entry.resources.filter((r) => r.active);
}

export function getInstitutionName(institutionKey: string | null | undefined): string | null {
  if (!institutionKey) return null;
  return INSTITUTION_REGISTRY[institutionKey]?.name ?? null;
}

export const INSTITUTION_OPTIONS: Array<{ key: string; name: string }> = Object.values(
  INSTITUTION_REGISTRY,
)
  .filter((e) => e.active)
  .map((e) => ({ key: e.key, name: e.name }));

// ── Resolver ──────────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ["urgent", "counseling", "academic", "workplace", "health", "other"];

function categoryRank(cat: string): number {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/**
 * Merge PI rows + institution registry + crisis default into one ordered list.
 *
 * - PI rows of a given category suppress registry rows of the same category.
 * - Crisis default is always appended after any other urgent entries.
 * - Order: urgent (PI → registry → crisis), then counseling, then other.
 *   Within non-urgent categories: PI rows before registry rows.
 */
export function resolveResources(
  piRows: LabResource[],
  institutionKey: string | null | undefined,
  countryCode?: string | null,
): ResolvedResource[] {
  const activePi = piRows.filter((r) => r.active);
  const piCategories = new Set(activePi.map((r) => r.category));

  const registryFiltered = getRegistryResources(institutionKey).filter(
    (r) => !piCategories.has(r.category),
  );

  const piResolved: ResolvedResource[] = activePi.map((r) => ({ ...r, _source: "pi" as const }));
  const regResolved: ResolvedResource[] = registryFiltered.map((r) => ({
    ...r,
    _source: "registry" as const,
  }));

  const crisis: ResolvedResource = {
    ...(getCrisisDefault(countryCode ?? undefined) as CrisisDefault),
    _source: "crisis" as const,
  };

  const isUrgentLike = (r: ResolvedResource) => r.category === "urgent" || r.is_pinned;

  const urgentPi = piResolved.filter(isUrgentLike);
  const urgentReg = regResolved.filter(isUrgentLike);

  const nonUrgent = [
    ...piResolved.filter((r) => !isUrgentLike(r)),
    ...regResolved.filter((r) => !isUrgentLike(r)),
  ].sort((a, b) => {
    const cd = categoryRank(a.category) - categoryRank(b.category);
    if (cd !== 0) return cd;
    const sd = (a._source === "pi" ? 0 : 1) - (b._source === "pi" ? 0 : 1);
    return sd !== 0 ? sd : a.sort_order - b.sort_order;
  });

  // Urgent: PI entries first, then registry entries, then crisis default always last.
  return [...urgentPi, ...urgentReg, crisis, ...nonUrgent];
}

/**
 * True when neither PI rows nor the institution registry has a counseling entry.
 * This is the condition for the "institution not recognized" PI admin banner.
 */
export function hasNoCounselingResources(
  piRows: LabResource[],
  institutionKey: string | null | undefined,
): boolean {
  const piHas = piRows.some((r) => r.active && r.category === "counseling");
  const regHas = getRegistryResources(institutionKey).some((r) => r.category === "counseling");
  return !piHas && !regHas;
}
