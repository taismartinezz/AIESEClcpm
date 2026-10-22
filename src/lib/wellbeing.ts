import type { CheckinQuestion, UserRole } from "@/types";

// ── Questions ─────────────────────────────────────────────────────────────────
// 1–5 agreement scale. IDs are stored with every answer and used by the SQL
// pulse functions, so never reuse an ID for a different question.

// "Lately", not "this week": check-ins are every two weeks by default.
export const CHECKIN_QUESTIONS: (CheckinQuestion & { short: string; vpText?: string; presidentText?: string })[] = [
  { id: "energy",    short: "Energy",     text: "I've had enough energy for my AIESEC responsibilities lately." },
  { id: "workload",  short: "Workload",   text: "My AIESEC workload has felt manageable lately." },
  { id: "purpose",   short: "Purpose",    text: "What I do in AIESEC has felt meaningful to me lately." },
  { id: "support",   short: "Support",    text: "I've felt supported by my VP lately.",
    vpText: "I've felt supported by my LCP lately.",
    presidentText: "I've felt supported by my executive board lately." },
  { id: "belonging", short: "Belonging",  text: "I've felt part of my team and my LC lately." },
  { id: "balance",   short: "Balance",    text: "I've been able to balance AIESEC with my studies, work and personal life." },
];

export const CHECKIN_LABELS: Record<number, string> = {
  1: "Strongly disagree",
  2: "Disagree",
  3: "Neutral",
  4: "Agree",
  5: "Strongly agree",
};

/** Question text as the given role should read it. */
export function questionText(q: (typeof CHECKIN_QUESTIONS)[number], role: UserRole | null): string {
  if (role === "president" && q.presidentText) return q.presidentText;
  return role === "vp" && q.vpText ? q.vpText : q.text;
}

export function activeQuestions(disabled: string[] | null | undefined) {
  const off = new Set(disabled ?? []);
  return CHECKIN_QUESTIONS.filter((q) => !off.has(q.id));
}

/** Who will see (aggregates of) this person's check-in: shown above the form. */
export function audienceCopy(role: UserRole | null): string {
  if (role === "vp") {
    return "Your LCP sees the average for the executive board, never your individual answers.";
  }
  if (role === "president") {
    return "As LCP your answers are just for you. They're never included in any average.";
  }
  return "Your VP and LCP see the average for your department, never your individual answers.";
}

// ── Pulse data ────────────────────────────────────────────────────────────────

/** A row from get_member_pulse / get_exec_pulse. */
export interface PulseRow {
  department_id?: string | null;
  period_start: string;
  question_id: string | null;
  avg_score: number | string | null;
  respondent_count: number | null;
  suppressed: boolean;
}

/** One check-in period (1 or 2 weeks, per LC) of a pulse series. */
export interface PulsePeriod {
  period: string;                     // ISO date of the period's first Monday
  suppressed: boolean;
  overall: number | null;             // mean of the question averages
  byQuestion: Record<string, number>;
  respondents: number | null;
}

export interface PulseSeries {
  groupId: string | null;             // department id, or null for exec / LC total
  periods: PulsePeriod[];             // oldest → newest, always the full window
}

/** Has any group in the window reached the privacy threshold at least once? */
export function hasVisibleData(series: PulseSeries[]): boolean {
  return series.some((s) => s.periods.some((p) => !p.suppressed && p.overall != null));
}

/** A drop this large (on the 1–5 scale) versus the average of the 4 previous periods gets flagged. */
export const NOTICEABLE_DROP = 0.5;

function isoDay(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** Group pulse rows into one 8-period series per department (or one series for exec). */
export function toSeries(rows: PulseRow[]): PulseSeries[] {
  const byGroup = new Map<string | null, Map<string, PulsePeriod>>();
  for (const row of rows) {
    const group = row.department_id ?? null;
    const period = isoDay(row.period_start);
    if (!byGroup.has(group)) byGroup.set(group, new Map());
    const periods = byGroup.get(group)!;
    if (!periods.has(period)) {
      periods.set(period, { period, suppressed: row.suppressed, overall: null, byQuestion: {}, respondents: row.respondent_count });
    }
    const p = periods.get(period)!;
    if (!row.suppressed && row.question_id && row.avg_score != null) {
      p.byQuestion[row.question_id] = Number(row.avg_score);
    }
  }
  return [...byGroup.entries()].map(([groupId, periods]) => ({
    groupId,
    periods: [...periods.values()]
      .map((p) => {
        const values = Object.values(p.byQuestion);
        return { ...p, overall: values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null };
      })
      .sort((a, b) => a.period.localeCompare(b.period)),
  }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PulseSummary {
  current: PulsePeriod | null;        // the current period (may be suppressed)
  latest: PulsePeriod | null;         // most recent period with numbers
  baseline: number | null;            // mean of up to 4 visible periods before `latest`
  change: number | null;              // latest.overall − baseline
  dropped: boolean;
}

export function summarize(series: PulseSeries | undefined): PulseSummary {
  const periods = series?.periods ?? [];
  const current = periods.at(-1) ?? null;
  const visible = periods.filter((p) => !p.suppressed && p.overall != null);
  const latest = visible.at(-1) ?? null;
  const previous = latest ? visible.filter((p) => p.period < latest.period).slice(-4) : [];
  // Need at least two earlier periods before calling anything a trend.
  const baseline = previous.length >= 2
    ? round2(previous.reduce((a, p) => a + (p.overall ?? 0), 0) / previous.length)
    : null;
  const change = latest && baseline != null ? round2((latest.overall ?? 0) - baseline) : null;
  return { current, latest, baseline, change, dropped: change != null && change <= -NOTICEABLE_DROP };
}

// ── Cadence ───────────────────────────────────────────────────────────────────

export type CheckinCadence = 1 | 2;   // weeks per check-in period (projects.checkin_period_weeks)
export const DEFAULT_CADENCE: CheckinCadence = 2;

/** "this fortnight" / "this week": for copy that refers to the current period. */
export function thisPeriod(weeks: CheckinCadence): string {
  return weeks === 2 ? "this fortnight" : "this week";
}

export function cadenceLabel(weeks: CheckinCadence): string {
  return weeks === 2 ? "every two weeks" : "every week";
}

export function privacyMessage(weeks: CheckinCadence): string {
  return `Not enough responses ${thisPeriod(weeks)} to protect privacy`;
}

/** First Monday of the period containing `at`: mirrors SQL checkin_period_start(). */
export function periodStart(weeks: CheckinCadence, at = new Date()): Date {
  const monday = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const epoch = Date.UTC(2024, 0, 1); // a Monday
  const days = weeks * 7;
  const offset = Math.floor((monday.getTime() - epoch) / 86_400_000 / days) * days;
  return new Date(epoch + offset * 86_400_000);
}

export function periodEnd(weeks: CheckinCadence, start: Date): Date {
  return new Date(start.getTime() + (weeks * 7 - 1) * 86_400_000);
}
