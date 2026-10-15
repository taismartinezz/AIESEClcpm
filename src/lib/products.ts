// AIESEC products and exchange stages. Colours follow the AIESEC product brand:
// Global Volunteer red-orange, Global Talent teal, Global Teacher orange.

export type ProductCode = "ogv" | "ogta" | "ogte" | "igv" | "igta" | "igte";
export type ExchangeStage = "signed_up" | "applied" | "accepted" | "approved" | "realized" | "finished";

export const PRODUCTS: { code: ProductCode; label: string; name: string; color: string }[] = [
  { code: "ogv",  label: "oGV",  name: "Outgoing Global Volunteer", color: "#F85A40" },
  { code: "ogta", label: "oGTa", name: "Outgoing Global Talent",    color: "#0CB9C1" },
  { code: "ogte", label: "oGTe", name: "Outgoing Global Teacher",   color: "#F48924" },
  { code: "igv",  label: "iGV",  name: "Incoming Global Volunteer", color: "#F85A40" },
  { code: "igta", label: "iGTa", name: "Incoming Global Talent",    color: "#0CB9C1" },
  { code: "igte", label: "iGTe", name: "Incoming Global Teacher",   color: "#F48924" },
];

export const PRODUCT_BY_CODE = Object.fromEntries(PRODUCTS.map((p) => [p.code, p])) as Record<ProductCode, (typeof PRODUCTS)[number]>;

export const STAGES: { code: ExchangeStage; label: string }[] = [
  { code: "signed_up", label: "Sign-up" },
  { code: "applied",   label: "Applied" },
  { code: "accepted",  label: "Accepted" },
  { code: "approved",  label: "Approved" },
  { code: "realized",  label: "Realized" },
  { code: "finished",  label: "Finished" },
];

export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.code, s.label])) as Record<ExchangeStage, string>;

/** Column holding the date an exchange reached `stage`. */
export const STAGE_DATE_FIELD: Record<ExchangeStage, "signedUpAt" | "appliedAt" | "acceptedAt" | "approvedAt" | "realizedAt" | "finishedAt"> = {
  signed_up: "signedUpAt", applied: "appliedAt", accepted: "acceptedAt",
  approved: "approvedAt", realized: "realizedAt", finished: "finishedAt",
};
