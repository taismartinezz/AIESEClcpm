import type { Exchange, Goal } from "@/types";

export function mapExchange(row: Record<string, unknown>): Exchange {
  const s = (k: string) => (row[k] as string | null) ?? null;
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    product: row.product as Exchange["product"],
    stage: row.stage as Exchange["stage"],
    personName: row.person_name as string,
    email: s("email"), phone: s("phone"), opportunity: s("opportunity"), hostEntity: s("host_entity"),
    expaId: s("expa_id"), expaUrl: s("expa_url"), departmentId: s("department_id"), ownerId: s("owner_id"), notes: s("notes"),
    signedUpAt: s("signed_up_at"), appliedAt: s("applied_at"), acceptedAt: s("accepted_at"),
    approvedAt: s("approved_at"), realizedAt: s("realized_at"), finishedAt: s("finished_at"), completedAt: s("completed_at"),
    updatedAt: row.updated_at as string,
  };
}

export function mapGoal(row: Record<string, unknown>): Goal {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    departmentId: (row.department_id as string | null) ?? null,
    title: row.title as string,
    metric: row.metric as Goal["metric"],
    product: (row.product as Goal["product"]) ?? null,
    stage: (row.stage as Goal["stage"]) ?? null,
    target: Number(row.target),
    currentValue: Number(row.current_value),
    unit: (row.unit as string | null) ?? null,
    startsOn: row.starts_on as string,
    endsOn: row.ends_on as string,
  };
}

/** Days since a date (ISO), for "in this stage for N days". */
export function daysSince(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso + "T00:00:00").getTime()) / 86_400_000));
}

export function progressRatio(current: number, target: number): number {
  return target > 0 ? Math.min(1, Math.max(0, current / target)) : 0;
}

// ── Headline numbers ──────────────────────────────────────────────────────────

const inRange = (d: string | null, from: string, to: string) => d != null && d >= from && d <= to;
const pct = (num: number, den: number) => (den > 0 ? num / den : null);

export interface PipelineStats {
  applied: number;
  approved: number;
  realized: number;
  completed: number;
  /** Of the people who applied in the range, the share who were accepted / approved. */
  appliedToAccepted: number | null;
  appliedToApproved: number | null;
  /** Of the people approved in the range, the share who have realized. */
  approvedToRealized: number | null;
}

/** Term numbers, the way MCs count them: by the date each stage was reached. */
export function pipelineStats(exchanges: Exchange[], from: string, to: string): PipelineStats {
  const appliedIn = exchanges.filter((e) => inRange(e.appliedAt, from, to));
  const approvedIn = exchanges.filter((e) => inRange(e.approvedAt, from, to));
  return {
    applied: appliedIn.length,
    approved: approvedIn.length,
    realized: exchanges.filter((e) => inRange(e.realizedAt, from, to)).length,
    completed: exchanges.filter((e) => inRange(e.completedAt, from, to)).length,
    appliedToAccepted: pct(appliedIn.filter((e) => e.acceptedAt).length, appliedIn.length),
    appliedToApproved: pct(appliedIn.filter((e) => e.approvedAt).length, appliedIn.length),
    approvedToRealized: pct(approvedIn.filter((e) => e.realizedAt).length, approvedIn.length),
  };
}

export function formatPct(ratio: number | null): string {
  return ratio == null ? "-" : `${Math.round(ratio * 100)}%`;
}

/** Days after which an exchange counts as stuck in a stage. */
export const STUCK_AFTER_DAYS: Partial<Record<Exchange["stage"], number>> = { applied: 14, accepted: 14 };

export function stuckExchanges(exchanges: Exchange[], now = new Date()): { exchange: Exchange; days: number }[] {
  return exchanges
    .map((exchange) => {
      const limit = STUCK_AFTER_DAYS[exchange.stage];
      const field = exchange.stage === "applied" ? exchange.appliedAt : exchange.stage === "accepted" ? exchange.acceptedAt : null;
      const days = daysSince(field, now);
      return limit != null && days != null && days >= limit ? { exchange, days } : null;
    })
    .filter((x): x is { exchange: Exchange; days: number } => x !== null)
    .sort((a, b) => b.days - a.days);
}

/** YYYY-MM-DD in local time. */
export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday (ISO date) of the week containing `d`, `weeksBack` weeks earlier. */
export function weekStart(d: Date, weeksBack = 0): string {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7) - 7 * weeksBack);
  return x.toISOString().slice(0, 10);
}

/** Approvals / realizations this week and last week (Monday to Sunday). */
export function weekOverWeek(exchanges: Exchange[], now = new Date()) {
  const thisFrom = weekStart(now), lastFrom = weekStart(now, 1);
  const lastTo = new Date(thisFrom + "T00:00:00Z"); lastTo.setUTCDate(lastTo.getUTCDate() - 1);
  const lastToIso = lastTo.toISOString().slice(0, 10);
  const today = localIsoDate(now);
  const count = (field: "approvedAt" | "realizedAt", from: string, to: string) => exchanges.filter((e) => inRange(e[field], from, to)).length;
  return {
    approvedThisWeek: count("approvedAt", thisFrom, today),
    approvedLastWeek: count("approvedAt", lastFrom, lastToIso),
    realizedThisWeek: count("realizedAt", thisFrom, today),
    realizedLastWeek: count("realizedAt", lastFrom, lastToIso),
  };
}
