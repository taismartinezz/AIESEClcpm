// Turn EXPA (GIS GraphQL) applications into import_exchanges() rows.
//
// No network here, so it can be tested on its own; src/lib/expa-server.ts does
// the fetching. Field names follow the GIS GraphQL schema
// (gis-api.aiesec.org/graphiql); if AIESEC renames one, fix APPLICATIONS_QUERY
// and the type below together.

import type { ProductCode } from "@/lib/products";
import { statusToStage, type ImportRow } from "@/lib/expa-import";

export const APPLICATIONS_QUERY = `
query Applications($page: Int, $perPage: Int, $filters: ApplicationFilter) {
  allOpportunityApplication(page: $page, per_page: $perPage, filters: $filters) {
    paging { current_page total_pages }
    data {
      id
      status
      created_at
      date_matched
      date_approved
      date_realized
      experience_end_date
      person { id full_name email contact_detail { phone } home_lc { id name } }
      opportunity { id title programme { id short_name_display } host_lc { id name } }
    }
  }
}`;

export const CURRENT_PERSON_QUERY = `query { currentPerson { id full_name email home_lc { id name } } }`;

export interface ExpaApplication {
  id: string | number;
  status: string | null;
  created_at: string | null;
  date_matched: string | null;
  date_approved: string | null;
  date_realized: string | null;
  experience_end_date: string | null;
  person: { id: string | number; full_name: string | null; email: string | null; contact_detail: { phone: string | null } | null; home_lc: { id: string | number; name: string } | null } | null;
  opportunity: { id: string | number; title: string | null; programme: { id: string | number; short_name_display: string | null } | null; host_lc: { id: string | number; name: string } | null } | null;
}

/** GV / GTa / GTe, by short name or by GIS programme id (7, 8, 9). */
function programmeOf(p: ExpaApplication["opportunity"]): "gv" | "gta" | "gte" | null {
  const name = (p?.programme?.short_name_display ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const id = String(p?.programme?.id ?? "");
  if (name === "gv" || id === "7") return "gv";
  if (name === "gta" || id === "8") return "gta";
  if (name === "gte" || id === "9") return "gte";
  return null;
}

const day = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : undefined);

export interface SyncPlan {
  byProduct: Partial<Record<ProductCode, ImportRow[]>>;
  /** Rejected, withdrawn or broken applications, left out. */
  skipped: number;
  /** Programmes the pipeline doesn't track, or applications not about this LC. */
  ignored: number;
}

/**
 * Sort applications into products: outgoing when the EP's home LC is ours,
 * incoming when the opportunity is hosted by ours.
 */
export function planSync(apps: ExpaApplication[], lcId: string): SyncPlan {
  const byProduct: SyncPlan["byProduct"] = {};
  let skipped = 0, ignored = 0;
  for (const a of apps) {
    const prog = programmeOf(a.opportunity);
    const outgoing = String(a.person?.home_lc?.id ?? "") === lcId;
    const incoming = String(a.opportunity?.host_lc?.id ?? "") === lcId;
    if (!prog || (!outgoing && !incoming)) { ignored++; continue; }
    const fromStatus = statusToStage(a.status ?? "");
    if (fromStatus === null) { skipped++; continue; }
    // Every application has been applied for; "open" means applied, not just signed up.
    const stage = !fromStatus || fromStatus === "signed_up" ? "applied" : fromStatus;
    const product = `${outgoing ? "o" : "i"}${prog}` as ProductCode;
    const finished = stage === "finished" || stage === "completed";
    const row: ImportRow = {
      stage,
      expa_id: String(a.id),
      ...(a.person?.full_name ? { person_name: a.person.full_name.trim() } : {}),
      ...(a.person?.email ? { email: a.person.email } : {}),
      ...(a.person?.contact_detail?.phone ? { phone: a.person.contact_detail.phone } : {}),
      ...(a.opportunity?.title ? { opportunity: a.opportunity.title } : {}),
      ...((outgoing ? a.opportunity?.host_lc?.name : a.person?.home_lc?.name) ? { host_entity: (outgoing ? a.opportunity?.host_lc?.name : a.person?.home_lc?.name)! } : {}),
      ...(a.person?.id ? { expa_url: `https://expa.aiesec.org/people/${a.person.id}` } : {}),
      ...(day(a.created_at) ? { applied_at: day(a.created_at) } : {}),
      ...(day(a.date_matched) ? { accepted_at: day(a.date_matched) } : {}),
      ...(day(a.date_approved) ? { approved_at: day(a.date_approved) } : {}),
      ...(day(a.date_realized) ? { realized_at: day(a.date_realized) } : {}),
      // The end date is planned in advance; it's only a "finished" date once it happened.
      ...(finished && day(a.experience_end_date) ? { finished_at: day(a.experience_end_date) } : {}),
    };
    (byProduct[product] ??= []).push(row);
  }
  return { byProduct, skipped, ignored };
}

// ── Profile, for filling in onboarding ──────────────────────────────────────
// Asked separately from CURRENT_PERSON_QUERY and allowed to fail: a field
// AIESEC renamed must not stop anyone signing in.

export const PROFILE_QUERY = `query { currentPerson { first_name last_name profile_photo home_mc { name } } }`;
export const POSITIONS_QUERY = `query { currentPerson { current_positions { role { name } function { name } } } }`;

/** What onboarding can use from EXPA. Stored on expa_connections.profile. */
export interface ExpaProfile {
  fullName: string | null;
  firstName: string | null;
  photoUrl: string | null;
  lcId: string | null;
  lcName: string | null;
  mcName: string | null;
  positions: { role: string | null; fn: string | null }[];
}

type RawPerson = {
  full_name?: string | null; first_name?: string | null; last_name?: string | null; profile_photo?: string | null;
  home_lc?: { id: string | number; name: string } | null; home_mc?: { name: string } | null;
  current_positions?: { role?: { name: string } | null; function?: { name: string } | null }[] | null;
};

export function profileFromExpa(p: RawPerson): ExpaProfile {
  const photo = p.profile_photo && /^https:\/\//i.test(p.profile_photo) ? p.profile_photo : null;
  return {
    fullName: p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || null,
    firstName: p.first_name?.trim() || null,
    photoUrl: photo,
    lcId: p.home_lc ? String(p.home_lc.id) : null,
    lcName: p.home_lc?.name?.trim() || null,
    mcName: p.home_mc?.name?.trim() || null,
    positions: (p.current_positions ?? []).map((x) => ({ role: x.role?.name ?? null, fn: x.function?.name ?? null })),
  };
}
