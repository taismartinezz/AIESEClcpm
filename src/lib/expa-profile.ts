// What onboarding fills in from someone's EXPA profile (src/lib/expa-sync.ts
// ExpaProfile). Client-safe: no network, no secrets.

import { AIESEC_COUNTRIES, foldText } from "@/lib/aiesecCountries";
import type { ExpaProfile } from "@/lib/expa-sync";

export type { ExpaProfile };

// EXPA entity names that differ from our country names.
const MC_ALIASES: Record<string, string> = {
  "usa": "US", "united states of america": "US", "uk": "GB", "great britain": "GB",
  "czechia": "CZ", "korea": "KR", "republic of korea": "KR", "china": "CN", "mainland of china": "CN",
  "ivory coast": "CI", "macedonia": "MK", "fyr macedonia": "MK", "turkiye": "TR", "uae": "AE",
  "russian federation": "RU", "viet nam": "VN",
};

/** The country of an EXPA entity name ("AIESEC in Dominican Republic", "Dominican Republic"). */
export function countryFromMc(mcName: string | null | undefined): string | null {
  if (!mcName) return null;
  const name = foldText(mcName).replace(/^aiesec (in )?/, "");
  if (MC_ALIASES[name]) return MC_ALIASES[name];
  return AIESEC_COUNTRIES.find((c) => foldText(c.name) === name || foldText(c.name).replace(/ \(.*\)$/, "") === name)?.code ?? null;
}

/** "Santo Domingo" → "AIESEC in Santo Domingo"; names already starting with AIESEC stay. */
export function lcDisplayName(lcName: string | null | undefined): string {
  const n = (lcName ?? "").trim();
  if (!n) return "";
  return /^aiesec\b/i.test(n) ? n : `AIESEC in ${n}`;
}

/** Is their current EXPA position LC President? (Not a VP.) */
export function isLcPresident(p: ExpaProfile): boolean {
  return p.positions.some(({ role }) => {
    const r = (role ?? "").toLowerCase();
    return /\b(lcp|president)\b/.test(r) && !/\b(vice|vp|lcvp|mcp|mcvp)\b/.test(r) && !/member committee/.test(r);
  });
}
