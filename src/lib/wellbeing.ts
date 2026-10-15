import type { CheckinQuestion, UserRole } from "@/types";

// ── Questions ─────────────────────────────────────────────────────────────────
// 1–5 agreement scale. IDs are stored with every answer and used by the SQL
// pulse functions, so never reuse an ID for a different question.

export const CHECKIN_QUESTIONS: (CheckinQuestion & { short: string; vpText?: string })[] = [
  { id: "energy",    short: "Energy",     text: "I've had enough energy for my AIESEC responsibilities this week." },
  { id: "workload",  short: "Workload",   text: "My AIESEC workload has felt manageable this week." },
  { id: "purpose",   short: "Purpose",    text: "What I do in AIESEC has felt meaningful to me this week." },
  { id: "support",   short: "Support",    text: "I've felt supported by my VP this week.",
    vpText: "I've felt supported by my LCP this week." },
  { id: "belonging", short: "Belonging",  text: "I've felt part of my team and my LC this week." },
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
  return role === "vp" && q.vpText ? q.vpText : q.text;
}

export function activeQuestions(disabled: string[] | null | undefined) {
  const off = new Set(disabled ?? []);
  return CHECKIN_QUESTIONS.filter((q) => !off.has(q.id));
}

/** Who will see (aggregates of) this person's check-in — shown above the form. */
export function audienceCopy(role: UserRole | null): string {
  if (role === "vp") {
    return "Your LCP sees the average for the executive board, never your individual answers.";
  }
  if (role === "president") {
    return "As LCP your answers are just for you — they're never included in any average.";
  }
  return "Your VP and LCP see the average for your department, never your individual answers.";
}

// ── Pulse data ────────────────────────────────────────────────────────────────

/** A row from get_member_pulse / get_exec_pulse. */
export interface PulseRow {
  department_id?: string | null;
  week_start: string;
  question_id: string | null;
  avg_score: number | string | null;
  respondent_count: number | null;
  suppressed: boolean;
}

export interface PulseWeek {
  week: string;                       // ISO date (Monday)
  suppressed: boolean;
  overall: number | null;             // mean of the question averages
  byQuestion: Record<string, number>;
  respondents: number | null;
}

export interface PulseSeries {
  groupId: string | null;             // department id, or null for exec / LC total
  weeks: PulseWeek[];                 // oldest → newest, always the full window
}

/** A drop this large (on the 1–5 scale) versus the 4-week average gets flagged. */
export const NOTICEABLE_DROP = 0.5;

function isoDay(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** Group pulse rows into one 8-week series per department (or one series for exec). */
export function toSeries(rows: PulseRow[]): PulseSeries[] {
  const byGroup = new Map<string | null, Map<string, PulseWeek>>();
  for (const row of rows) {
    const group = row.department_id ?? null;
    const week = isoDay(row.week_start);
    if (!byGroup.has(group)) byGroup.set(group, new Map());
    const weeks = byGroup.get(group)!;
    if (!weeks.has(week)) {
      weeks.set(week, { week, suppressed: row.suppressed, overall: null, byQuestion: {}, respondents: row.respondent_count });
    }
    const w = weeks.get(week)!;
    if (!row.suppressed && row.question_id && row.avg_score != null) {
      w.byQuestion[row.question_id] = Number(row.avg_score);
    }
  }
  return [...byGroup.entries()].map(([groupId, weeks]) => ({
    groupId,
    weeks: [...weeks.values()]
      .map((w) => {
        const values = Object.values(w.byQuestion);
        return { ...w, overall: values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null };
      })
      .sort((a, b) => a.week.localeCompare(b.week)),
  }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PulseSummary {
  current: PulseWeek | null;          // this week (may be suppressed)
  latest: PulseWeek | null;           // most recent week with numbers
  baseline: number | null;            // mean of up to 4 visible weeks before `latest`
  change: number | null;              // latest.overall − baseline
  dropped: boolean;
}

export function summarize(series: PulseSeries | undefined): PulseSummary {
  const weeks = series?.weeks ?? [];
  const current = weeks.at(-1) ?? null;
  const visible = weeks.filter((w) => !w.suppressed && w.overall != null);
  const latest = visible.at(-1) ?? null;
  const previous = latest ? visible.filter((w) => w.week < latest.week).slice(-4) : [];
  // Need at least two earlier weeks before calling anything a trend.
  const baseline = previous.length >= 2
    ? round2(previous.reduce((a, w) => a + (w.overall ?? 0), 0) / previous.length)
    : null;
  const change = latest && baseline != null ? round2((latest.overall ?? 0) - baseline) : null;
  return { current, latest, baseline, change, dropped: change != null && change <= -NOTICEABLE_DROP };
}

/** Monday of the current week (UTC), matching date_trunc('week', now()) in Postgres. */
export function currentWeekStart(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}
