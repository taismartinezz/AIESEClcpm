// Targets, pace and "Needs attention" for the national (MC) view. No network:
// the page loads mc_dashboard / mc_lc_health / mc_lc_targets and passes them in.

export type PaceStatus = "ahead" | "on-track" | "slightly-behind" | "behind";

export const PACE_LABEL: Record<PaceStatus, string> = {
  ahead: "Ahead", "on-track": "On track", "slightly-behind": "Slightly behind", behind: "Behind",
};

const DAY = 86_400_000;
const TERM_DAYS = 365;

const daysBetween = (from: string, to: Date) => Math.floor((to.getTime() - new Date(`${from.slice(0, 10)}T00:00:00`).getTime()) / DAY);

/** How far into the term we are, 0 to 1 (a term is a year from its start). */
export function termProgress(termStart: string, today = new Date()): number {
  return Math.min(1, Math.max(0, daysBetween(termStart, today) / TERM_DAYS));
}

/**
 * Where an LC stands against its target for this point in the term. Null
 * without a target. "On track" means at least 90% of what's expected by now.
 */
export function pace(actual: number, target: number, progress: number): { status: PaceStatus; expected: number; pct: number } | null {
  if (!(target > 0)) return null;
  const expected = Math.round(target * progress);
  const ratio = expected === 0 ? (actual > 0 ? 2 : 1) : actual / expected;
  const status: PaceStatus = ratio >= 1.1 ? "ahead" : ratio >= 0.9 ? "on-track" : ratio >= 0.7 ? "slightly-behind" : "behind";
  return { status, expected, pct: Math.round((actual / target) * 100) };
}

/** mc_lc_health() row. */
export interface LcHealth {
  project_id: string;
  last_approved: string | null;
  approved_30d: number;
  stuck_approved: number;
  last_activity: string | null;
  from_expa: number;
  total: number;
  last_expa_sync: string | null;
}

export interface LcSummary {
  id: string;
  name: string;
  applied: number;
  approved: number;
  /** Sum of the LC's approval targets this term, if any were set. */
  approvedTarget: number | null;
  health: LcHealth | null;
}

/** Days since a date, or null. */
export function daysAgo(iso: string | null | undefined, today = new Date()): number | null {
  return iso ? Math.max(0, daysBetween(iso, today)) : null;
}

/**
 * LCs an MCVP should look at, each with the reasons, most reasons first.
 * Counts only: the rules never need a person's name.
 */
export function needsAttention(lcs: LcSummary[], progress: number, today = new Date()): { id: string; name: string; reasons: string[] }[] {
  const applied = lcs.reduce((s, l) => s + l.applied, 0);
  const approved = lcs.reduce((s, l) => s + l.approved, 0);
  const national = applied >= 10 ? approved / applied : null;
  const termDays = progress * TERM_DAYS;

  return lcs.map((l) => {
    const reasons: string[] = [];
    const h = l.health;
    if (h) {
      if (termDays >= 30 && h.approved_30d === 0) {
        reasons.push(h.last_approved ? `No approvals in ${daysAgo(h.last_approved, today)} days` : "No approvals yet");
      }
      if (h.stuck_approved > 0) {
        reasons.push(`${h.stuck_approved} approved 60+ days ago, not realized yet`);
      }
      const idle = daysAgo(h.last_activity, today);
      if (idle === null) reasons.push("No pipeline data yet");
      else if (idle > 21) reasons.push(`Pipeline not updated in ${idle} days`);
    }
    if (national !== null && l.applied >= 10 && l.approved / l.applied < national * 0.6) {
      reasons.push(`Applied → approved ${Math.round((l.approved / l.applied) * 100)}% (national ${Math.round(national * 100)}%)`);
    }
    const p = l.approvedTarget ? pace(l.approved, l.approvedTarget, progress) : null;
    if (p && p.status === "behind") {
      reasons.push(`Behind pace: ${l.approved} / ${l.approvedTarget} approvals (${p.expected} expected by now)`);
    }
    return { id: l.id, name: l.name, reasons };
  }).filter((x) => x.reasons.length > 0).sort((a, b) => b.reasons.length - a.reasons.length);
}

/** "EXPA, synced 2 days ago" / "Entered by hand", for a row's source line. */
export function sourceLabel(h: LcHealth | null, today = new Date()): string {
  if (!h) return "";
  const updated = daysAgo(h.last_activity, today);
  const when = updated === null ? "No data yet" : updated === 0 ? "Updated today" : `Updated ${updated}d ago`;
  const sync = daysAgo(h.last_expa_sync, today);
  const source = sync !== null ? `EXPA sync ${sync === 0 ? "today" : `${sync}d ago`}` : h.total > 0 ? "entered by hand" : "";
  return source ? `${when} · ${source}` : when;
}
