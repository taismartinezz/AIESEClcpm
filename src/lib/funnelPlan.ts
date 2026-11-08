// Working backwards from approval goals (the planning template's MKT tab):
// with conversion rates, how many sign-ups, applicants and acceptances the
// approvals need, and how many more per week for the rest of the term.

import type { Exchange } from "@/types";

export interface Rates { signupToApplied: number; appliedToAccepted: number; acceptedToApproved: number }

/**
 * The template's rule of thumb: sign-up → applicant 12–18%, applicant →
 * accepted 40–55%; accepted → approved is typically about half.
 */
export const DEFAULT_RATES: Rates = { signupToApplied: 0.15, appliedToAccepted: 0.47, acceptedToApproved: 0.55 };

export interface FunnelCounts { signups: number; applied: number; accepted: number; approved: number }

/** What a number of approvals needs at each earlier stage. */
export function backwards(approvals: number, r: Rates): FunnelCounts {
  const accepted = Math.ceil(approvals / r.acceptedToApproved);
  const applied = Math.ceil(accepted / r.appliedToAccepted);
  const signups = Math.ceil(applied / r.signupToApplied);
  return { signups, applied, accepted, approved: approvals };
}

/**
 * The LC's own rates from exchanges that signed up in the last year (each
 * exchange counted at every stage it reached). Null below 10 sign-ups, or
 * where a step has nothing to go on.
 */
export function lcRates(exchanges: Pick<Exchange, "signedUpAt" | "appliedAt" | "acceptedAt" | "approvedAt">[], since: string): Rates | null {
  const cohort = exchanges.filter((e) => (e.signedUpAt ?? "") >= since);
  const applied = cohort.filter((e) => e.appliedAt || e.acceptedAt || e.approvedAt).length;
  const accepted = cohort.filter((e) => e.acceptedAt || e.approvedAt).length;
  const approved = cohort.filter((e) => e.approvedAt).length;
  if (cohort.length < 10 || applied === 0 || accepted === 0) return null;
  return { signupToApplied: applied / cohort.length, appliedToAccepted: accepted / applied, acceptedToApproved: Math.max(approved / accepted, 0.01) };
}

/** Reached this term so far, by the date each stage was reached. */
export function achieved(exchanges: Pick<Exchange, "signedUpAt" | "appliedAt" | "acceptedAt" | "approvedAt">[], termStart: string): FunnelCounts {
  const since = (d: string | null | undefined) => Boolean(d && d >= termStart);
  return {
    signups: exchanges.filter((e) => since(e.signedUpAt)).length,
    applied: exchanges.filter((e) => since(e.appliedAt)).length,
    accepted: exchanges.filter((e) => since(e.acceptedAt)).length,
    approved: exchanges.filter((e) => since(e.approvedAt)).length,
  };
}

export interface Plan { needed: FunnelCounts; done: FunnelCounts; left: FunnelCounts; perWeek: FunnelCounts; weeksLeft: number }

/** The whole term's needs, what's done, what's left, and per week until the term ends. */
export function plan(approvalsGoal: number, rates: Rates, done: FunnelCounts, termEnd: string, today: string): Plan {
  const needed = backwards(approvalsGoal, rates);
  const days = Math.max(0, (new Date(`${termEnd}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
  const weeksLeft = Math.max(1, Math.ceil(days / 7));
  const left = {
    signups: Math.max(0, needed.signups - done.signups),
    applied: Math.max(0, needed.applied - done.applied),
    accepted: Math.max(0, needed.accepted - done.accepted),
    approved: Math.max(0, needed.approved - done.approved),
  };
  const per = (n: number) => Math.ceil(n / weeksLeft);
  return { needed, done, left, weeksLeft, perWeek: { signups: per(left.signups), applied: per(left.applied), accepted: per(left.accepted), approved: per(left.approved) } };
}
