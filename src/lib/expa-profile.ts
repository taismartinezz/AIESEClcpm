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

// ── Where EXPA sign-in puts someone ─────────────────────────────────────────
// From their current EXPA positions: the office (an LC or an MC) and the role
// in it. join_from_expa() (migration 077) finds that LC or MC on the app and
// adds them with this role, so no invite code is needed.

/** A department by what it does; join_from_expa() finds the LC's matching one. */
export type DepartmentKey = "ogv" | "ogt" | "igv" | "igt" | "mkt" | "tm" | "fin" | "bd";

export interface ExpaPlacement {
  kind: "lc" | "mc";
  /** The office's EXPA id, when EXPA gave it. */
  expaId: string | null;
  name: string | null;
  country: string | null;
  role: "president" | "vp" | "member" | "mcp";
  department: DepartmentKey | null;
}

const isPresident = (r: string) => /\b(lcp|mcp|president)\b/.test(r) && !/\b(vice|vp|lcvp|mcvp)\b/.test(r);

/** "Outgoing Global Volunteer", "oGV", "LCVP Marketing" → the department key. */
export function departmentFromFunction(text: string | null | undefined): DepartmentKey | null {
  const f = foldText(text ?? "");
  if (/\bogv\b|outgoing.*volunteer/.test(f)) return "ogv";
  if (/\bogt[ae]?\b|outgoing.*(talent|teacher)/.test(f)) return "ogt";
  if (/\bigv\b|incoming.*volunteer/.test(f)) return "igv";
  if (/\bigt[ae]?\b|incoming.*(talent|teacher)/.test(f)) return "igt";
  if (/marketing|\bmkt\b|brand|communication/.test(f)) return "mkt";
  if (/talent management|\btm\b|people|human resources|\bhr\b/.test(f)) return "tm";
  if (/financ|legal|\bf l\b|\bfnl\b/.test(f)) return "fin";
  if (/business development|\bbd\b|partnership|\bb2b\b/.test(f)) return "bd";
  return null;
}

/**
 * Their highest current position: an MC one before an LC one, and president
 * before VP before member. Null when they hold no position (an exchange
 * participant also has a home LC, but isn't a member of it).
 */
export function placementFromExpa(p: ExpaProfile): ExpaPlacement | null {
  const rank = (x: ExpaPlacement) => (x.kind === "mc" ? 10 : 0) + ({ mcp: 3, president: 3, vp: 2, member: 1 })[x.role];
  let best: ExpaPlacement | null = null;
  for (const pos of p.positions) {
    const r = foldText(pos.role ?? "");
    const tag = pos.office?.tag ?? null;
    if (tag && tag !== "LC" && tag !== "MC") continue;           // a region or AIESEC International
    const mc = tag === "MC" || (!tag && /\bmc(p|vp)?\b|member committee/.test(r));
    const officeName = pos.office?.name ?? null;
    const x: ExpaPlacement = mc
      ? {
          kind: "mc", expaId: pos.office?.id ?? null, name: officeName ?? p.mcName,
          country: countryFromMc(officeName) ?? countryFromMc(p.mcName),
          role: isPresident(r) ? "mcp" : "member", department: null,
        }
      : {
          kind: "lc", expaId: pos.office?.id ?? p.lcId, name: officeName ?? p.lcName,
          country: countryFromMc(p.mcName),
          role: isPresident(r) ? "president" : /\b(lcvp|vp|vice)\b/.test(r) ? "vp" : "member",
          department: departmentFromFunction(pos.fn) ?? departmentFromFunction(pos.role),
        };
    if (!x.expaId && !x.name) continue;
    if (!best || rank(x) > rank(best)) best = x;
  }
  return best;
}

/** What join_from_expa() answers. */
export interface ExpaJoin {
  status: "joined" | "already" | "create_lc" | "create_mc" | "lc_missing" | "mc_missing" | "none";
  kind?: "lc" | "mc";
  id?: string;
  name?: string | null;
}

/** Where to go once join_from_expa() has placed them; null: the usual destination. */
export function destinationAfterJoin(j: ExpaJoin | null): string | null {
  if (!j) return null;
  if (j.status === "joined" || j.status === "already") return j.kind === "mc" ? "/mc" : "/";
  if (j.status === "create_mc") return "/mc";
  return null;
}
