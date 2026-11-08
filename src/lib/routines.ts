// Recurring routines (migration 20261109002). The database creates the tasks
// (run_routines); this mirrors routine_due_on() to show "next due" and the
// schedule in words, and holds the AIESEC routines LCs can start from.

export type Freq = "weekly" | "biweekly" | "monthly";
export type Assignee = "president" | "department_vp" | "person";

export interface Schedule {
  freq: Freq;
  weekday?: number | null;      // ISO: 1 = Monday … 7 = Sunday
  anchor?: string | null;       // biweekly: a date it falls on (YYYY-MM-DD)
  month_day?: number | null;    // 1…28, or -1 = last day of the month
  nth?: number | null;          // with weekday: 1…4, or -1 = last
  months?: number[] | null;     // only these months (1…12); null = every month
}

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NTH = { 1: "first", 2: "second", 3: "third", 4: "fourth", [-1]: "last" } as Record<number, string>;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const isoDow = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;
const lastOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

/** Does the schedule fall on this date? Same rule as routine_due_on() in the database. */
export function dueOn(s: Schedule, date: string): boolean {
  const d = parse(date);
  if (s.freq === "weekly") return isoDow(d) === s.weekday;
  if (s.freq === "biweekly") {
    if (!s.anchor || isoDow(d) !== s.weekday) return false;
    const days = Math.round((d.getTime() - parse(s.anchor).getTime()) / 86_400_000);
    return ((days % 14) + 14) % 14 === 0;
  }
  if (s.months?.length && !s.months.includes(d.getUTCMonth() + 1)) return false;
  const day = d.getUTCDate();
  if (s.month_day === -1) return day === lastOfMonth(d);
  if (s.month_day) return day === s.month_day;
  if (isoDow(d) !== s.weekday) return false;
  if (s.nth === -1) return day + 7 > lastOfMonth(d);
  return Math.ceil(day / 7) === s.nth;
}

/** The next date on or after `from` (within two years), or null. */
export function nextDue(s: Schedule, from: string): string | null {
  const d = parse(from);
  for (let i = 0; i < 731; i++) {
    const x = iso(d);
    if (dueOn(s, x)) return x;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

/** "Every Monday", "Every other Tuesday", "Last Monday of the month", "1st of February and September". */
export function describe(s: Schedule): string {
  if (s.freq === "weekly") return `Every ${WEEKDAYS[s.weekday ?? 1]}`;
  if (s.freq === "biweekly") return `Every other ${WEEKDAYS[s.weekday ?? 1]}`;
  const when = s.month_day === -1 ? "Last day"
    : s.month_day ? ordinal(s.month_day)
    : `${NTH[s.nth ?? 1][0].toUpperCase()}${NTH[s.nth ?? 1].slice(1)} ${WEEKDAYS[s.weekday ?? 1]}`;
  if (!s.months?.length || s.months.length === 12) return `${when} of every month`;
  const quarterly = [1, 4, 7, 10].every((m) => s.months!.includes(m)) && s.months.length === 4;
  if (quarterly) return `${when} of January, April, July and October`;
  const names = s.months.map((m) => MONTHS[m]);
  return `${when} of ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}`;
}

// ── AIESEC routines (from the LC planning template) ────────────────────────

/** Which department a routine belongs to, matched by product or name. */
export type Area = "lcp" | "mxp" | "fin" | "mkt" | "ogv" | "igta";

export interface RoutineTemplate extends Schedule {
  key: string;
  area: Area;
  title: string;
  why: string;
  assignee: Assignee;
  lead_days: number;
}

export const AREA_LABEL: Record<Area, string> = {
  lcp: "LCP", mxp: "MXP / Talent Management", fin: "Finance & Legality", mkt: "Marketing", ogv: "oGV", igta: "iGTa",
};

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  { key: "lcp-eb-meeting", area: "lcp", title: "Weekly EB meeting", why: "Align the board on priorities, numbers and blockers every week.", assignee: "president", freq: "weekly", weekday: 1, lead_days: 2 },
  { key: "lcp-lc-meeting", area: "lcp", title: "Monthly LC meeting", why: "The whole LC hears where it stands, celebrates wins and gets the next month's focus.", assignee: "president", freq: "monthly", nth: 1, weekday: 3, lead_days: 7 },
  { key: "lcp-sona", area: "lcp", title: "Send the SONA report to the MC", why: "Due by the 1st of each month; missing more than 2 deadlines in a semester gets the LC downgraded.", assignee: "president", freq: "monthly", month_day: -1, lead_days: 5 },
  { key: "lcp-one-on-ones", area: "lcp", title: "1:1s with your VPs", why: "Every other week: how they're doing, what they need, how their area is going.", assignee: "president", freq: "biweekly", weekday: 4, anchor: "2026-01-01", lead_days: 2 },
  { key: "lcp-vp-development", area: "lcp", title: "Monthly development check-in with VPs", why: "Each VP's own growth goals, not just their area's numbers.", assignee: "president", freq: "monthly", nth: 3, weekday: 4, lead_days: 5 },
  { key: "lcp-boa", area: "lcp", title: "Board of advisors (BoA) meeting", why: "Quarterly advice from your BoA; the LC needs 3 BoA members to keep full-member status.", assignee: "president", freq: "monthly", month_day: 15, months: [1, 4, 7, 10], lead_days: 14 },
  { key: "mxp-nms", area: "mxp", title: "Open the NMS survey for members", why: "Members take the NMS every month: it opens the last Monday and closes the first Monday of the next month.", assignee: "department_vp", freq: "monthly", nth: -1, weekday: 1, lead_days: 3 },
  { key: "mxp-hr-update", area: "mxp", title: "Monthly HR data update", why: "Members' data reported every month (Podio / to the MC) is a membership criterion.", assignee: "department_vp", freq: "monthly", month_day: 28, lead_days: 5 },
  { key: "mxp-vp-team-development", area: "mxp", title: "Weekly meeting with VPs on their teams' development", why: "Talent Management keeps track of how every team is growing.", assignee: "department_vp", freq: "weekly", weekday: 2, lead_days: 2 },
  { key: "fin-audit", area: "fin", title: "Semester audit", why: "An audit every semester, in February and September.", assignee: "department_vp", freq: "monthly", month_day: 15, months: [2, 9], lead_days: 14 },
  { key: "fin-weekly-goals", area: "fin", title: "Weekly finance goal tracking", why: "Keep income, spending and the bank balance in view every week.", assignee: "department_vp", freq: "weekly", weekday: 5, lead_days: 2 },
  { key: "fin-monthly-review", area: "fin", title: "Monthly finance review", why: "Close the month: books, budget against actual, and a non-negative balance (a membership criterion).", assignee: "department_vp", freq: "monthly", month_day: -1, lead_days: 5 },
  { key: "mkt-info-session", area: "mkt", title: "Weekly info session", why: "A steady flow of sign-ups for the exchange products.", assignee: "department_vp", freq: "weekly", weekday: 3, lead_days: 4 },
  { key: "mkt-activity-1", area: "mkt", title: "Marketing activity (1 of 2 this week)", why: "Marketing activities twice a week keep the sign-up funnel full.", assignee: "department_vp", freq: "weekly", weekday: 2, lead_days: 3 },
  { key: "mkt-activity-2", area: "mkt", title: "Marketing activity (2 of 2 this week)", why: "Marketing activities twice a week keep the sign-up funnel full.", assignee: "department_vp", freq: "weekly", weekday: 4, lead_days: 3 },
  { key: "ogv-signup-review", area: "ogv", title: "Check every new sign-up was contacted", why: "New sign-ups should be contacted within 24 to 48 hours; the oGV goal is 80% within 48h.", assignee: "department_vp", freq: "weekly", weekday: 1, lead_days: 1 },
  { key: "igta-cold-outreach", area: "igta", title: "Weekly cold outreach to companies", why: "New leads every week; the LC needs 8 iGTa meetings a year to keep full-member status.", assignee: "department_vp", freq: "weekly", weekday: 2, lead_days: 2 },
];

/** The LC's department for an area: by product, then by name. */
export function departmentForArea(area: Area, departments: { id: string; name: string; products: string[] }[]): string | null {
  const byProduct = (p: string) => departments.find((d) => d.products.includes(p))?.id ?? null;
  const byName = (re: RegExp) => departments.find((d) => re.test(d.name))?.id ?? null;
  switch (area) {
    case "lcp": return null;
    case "ogv": return byProduct("ogv") ?? byName(/outgoing.*volunteer|\bogv\b/i);
    case "igta": return byProduct("igta") ?? byName(/incoming.*talent|\bigt/i);
    case "fin": return byName(/financ|\bf&l\b|\bfin\b/i);
    case "mkt": return byName(/marketing|\bmkt\b/i);
    case "mxp": return byName(/talent management|\bmxp\b|\btm\b|people|member/i);
  }
}
