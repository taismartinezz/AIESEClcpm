// The MC's Monday email: the week per linked LC and what needs attention.
// No network: notify-server loads the rows (as the service role, since the
// mc_* functions answer only MC members) and passes them in.

import { needsAttention, termProgress, type LcHealth } from "@/lib/mcPace";

export interface DigestExchange {
  project_id: string;
  stage: string;
  applied_at: string | null;
  approved_at: string | null;
  realized_at: string | null;
  updated_at: string | null;
}

export interface McWeek {
  lcs: { id: string; name: string; approvedWeek: number; approvedPrev: number; realizedWeek: number }[];
  totals: { approvedWeek: number; approvedPrev: number; realizedWeek: number };
  attention: { id: string; name: string; reasons: string[] }[];
}

const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** This MC's week: approvals and realizations in the last 7 days (and the 7 before), per LC. */
export function mcWeek(
  lcs: { id: string; name: string }[], exchanges: DigestExchange[], approvedTargets: Record<string, number>,
  termStart: string, now = new Date(),
): McWeek {
  const weekAgo = day(new Date(now.getTime() - 7 * DAY));
  const twoWeeksAgo = day(new Date(now.getTime() - 14 * DAY));
  const monthAgo = day(new Date(now.getTime() - 30 * DAY));
  const twoMonthsAgo = day(new Date(now.getTime() - 60 * DAY));
  const today = day(now);
  const inRange = (d: string | null, from: string, to: string) => Boolean(d && d.slice(0, 10) > from && d.slice(0, 10) <= to);

  const rows = lcs.map((l) => {
    const ex = exchanges.filter((e) => e.project_id === l.id);
    const max = (xs: (string | null)[]) => xs.filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
    const health: LcHealth = {
      project_id: l.id,
      last_approved: max(ex.map((e) => e.approved_at)),
      approved_30d: ex.filter((e) => inRange(e.approved_at, monthAgo, today)).length,
      stuck_approved: ex.filter((e) => e.stage === "approved" && e.approved_at && e.approved_at.slice(0, 10) <= twoMonthsAgo).length,
      last_activity: max(ex.map((e) => e.updated_at)),
      from_expa: 0, total: ex.length, last_expa_sync: null,
    };
    return {
      id: l.id, name: l.name, health,
      approvedWeek: ex.filter((e) => inRange(e.approved_at, weekAgo, today)).length,
      approvedPrev: ex.filter((e) => inRange(e.approved_at, twoWeeksAgo, weekAgo)).length,
      realizedWeek: ex.filter((e) => inRange(e.realized_at, weekAgo, today)).length,
      applied: ex.filter((e) => (e.applied_at ?? "") >= termStart).length,
      approved: ex.filter((e) => (e.approved_at ?? "") >= termStart).length,
    };
  });

  const attention = needsAttention(rows.map((r) => ({
    id: r.id, name: r.name, applied: r.applied, approved: r.approved,
    approvedTarget: approvedTargets[r.id] ?? null, health: r.health,
  })), termProgress(termStart, now), now);

  return {
    lcs: rows.map(({ id, name, approvedWeek, approvedPrev, realizedWeek }) => ({ id, name, approvedWeek, approvedPrev, realizedWeek })),
    totals: {
      approvedWeek: rows.reduce((s, r) => s + r.approvedWeek, 0),
      approvedPrev: rows.reduce((s, r) => s + r.approvedPrev, 0),
      realizedWeek: rows.reduce((s, r) => s + r.realizedWeek, 0),
    },
    attention,
  };
}

/** The MC's term start: its own, or the latest 1 February (as mc_term_start()). */
export function mcTermStart(termStart: string | null, now = new Date()): string {
  if (termStart) return termStart;
  const y = now.getUTCFullYear();
  return now >= new Date(Date.UTC(y, 1, 1)) ? `${y}-02-01` : `${y - 1}-02-01`;
}
