// Build-time crisis defaults -- never DB rows.
// These render whenever the lab has zero active urgent-category resources of their own.
// A lab can override by adding their own urgent-category resource; they cannot end up with neither.

export interface CrisisDefault {
  id: string;
  label: string;
  description: string;
  contact_type: "phone" | "url";
  contact_value: string;
  availability: string;
  category: "urgent";
  confidentiality: null;
  is_pinned: boolean;
  sort_order: number;
  active: true;
}

export const CRISIS_DEFAULT_US: CrisisDefault = {
  id: "__crisis_default_us__",
  label: "988 Suicide & Crisis Lifeline",
  description: "Call or text 988. You don't need to be in an emergency to use it.",
  contact_type: "phone",
  contact_value: "988",
  availability: "24/7",
  category: "urgent",
  confidentiality: null,
  is_pinned: true,
  sort_order: -1,
  active: true,
};

// Keyed by ISO 3166-1 alpha-2 country code. Extend as labs in other countries are onboarded.
export const CRISIS_DEFAULTS_BY_COUNTRY: Record<string, CrisisDefault> = {
  US: CRISIS_DEFAULT_US,
  CA: {
    id: "__crisis_default_ca__",
    label: "Talk Suicide Canada",
    description: "Call 1-833-456-4566 (24/7) or text 45645 (4pm-midnight ET).",
    contact_type: "phone",
    contact_value: "18334564566",
    availability: "24/7 by phone",
    category: "urgent",
    confidentiality: null,
    is_pinned: true,
    sort_order: -1,
    active: true,
  },
  GB: {
    id: "__crisis_default_gb__",
    label: "Samaritans",
    description: "Call 116 123, free, 24/7.",
    contact_type: "phone",
    contact_value: "116123",
    availability: "24/7",
    category: "urgent",
    confidentiality: null,
    is_pinned: true,
    sort_order: -1,
    active: true,
  },
  AU: {
    id: "__crisis_default_au__",
    label: "Lifeline Australia",
    description: "Call 13 11 14, 24/7.",
    contact_type: "phone",
    contact_value: "131114",
    availability: "24/7",
    category: "urgent",
    confidentiality: null,
    is_pinned: true,
    sort_order: -1,
    active: true,
  },
};

// International fallback when country is unset or unmapped.
export const CRISIS_DEFAULT_INTERNATIONAL: CrisisDefault = {
  id: "__crisis_default_intl__",
  label: "Crisis support",
  description: "findahelpline.com has local crisis lines for most countries.",
  contact_type: "url",
  contact_value: "https://findahelpline.com",
  availability: "Directory, always available",
  category: "urgent",
  confidentiality: null,
  is_pinned: true,
  sort_order: -1,
  active: true,
};

export function getCrisisDefault(countryCode?: string | null): CrisisDefault {
  if (!countryCode) return CRISIS_DEFAULT_INTERNATIONAL;
  return CRISIS_DEFAULTS_BY_COUNTRY[countryCode.toUpperCase()] ?? CRISIS_DEFAULT_INTERNATIONAL;
}
