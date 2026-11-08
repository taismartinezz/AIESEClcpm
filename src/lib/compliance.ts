// Membership criteria (the LC planning template): green / yellow / red per
// criterion, from lc_compliance() (migration 20261109003). No network.

export type Status = "ok" | "warn" | "fail";
export type CheckKind = "sona" | "hr_report";

export interface ComplianceData {
  balance: number; currency: string | null; approvals_12m: number; meetings_12m: number;
  boa_members: number; university_affiliated: boolean; debt_plan: string | null;
  checks: { kind: CheckKind; month: string; done_on: string }[];
}

export interface Criterion {
  key: "balance" | "boa" | "university" | "approvals" | "meetings" | CheckKind;
  title: string;
  owner: string;
  status: Status;
  detail: string;
}

export const STATUS_LABEL: Record<Status, string> = { ok: "Met", warn: "At risk", fail: "Not met" };

const pad = (n: number) => String(n).padStart(2, "0");
const firstOf = (y: number, m: number) => `${y}-${pad(m)}-01`;               // m: 1…12
const lastOf = (y: number, m: number) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The months of the current half-year (January–June or July–December) up to this one. */
export function semesterMonths(today: string): { y: number; m: number }[] {
  const [y, m] = today.split("-").map(Number);
  const start = m <= 6 ? 1 : 7;
  return Array.from({ length: m - start + 1 }, (_, i) => ({ y, m: start + i }));
}

/**
 * A monthly deadline over this semester. SONA is due by the 1st of the month;
 * the HR report by the month's last day. Late counts as missed; more than 2
 * missed in a semester and the LC is downgraded.
 */
export function monthlyDeadline(kind: CheckKind, checks: ComplianceData["checks"], today: string) {
  const months = semesterMonths(today).map(({ y, m }) => {
    const month = firstOf(y, m);
    const due = kind === "sona" ? month : lastOf(y, m);
    const done = checks.find((c) => c.kind === kind && c.month === month)?.done_on ?? null;
    return { month, due, done, missed: due < today && (!done || done > due) };
  });
  const missed = months.filter((x) => x.missed).length;
  const current = months.at(-1)!;
  return { months, missed, current };
}

export function evaluate(d: ComplianceData, today: string): Criterion[] {
  const money = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${d.currency ? ` ${d.currency}` : ""}`;
  const monthly = (kind: CheckKind, title: string, owner: string): Criterion => {
    const { missed, current } = monthlyDeadline(kind, d.checks, today);
    const [, m] = current.month.split("-").map(Number);
    const now = current.done ? `${MONTH[m - 1]}'s is done.` : current.due < today ? `${MONTH[m - 1]}'s wasn't sent on time.` : `${MONTH[m - 1]}'s is due ${current.due === today ? "today" : `by ${current.due}`}.`;
    return {
      key: kind, title, owner,
      status: missed > 2 ? "fail" : missed > 0 ? "warn" : "ok",
      detail: `${missed} missed this semester (more than 2 means a downgrade). ${now}`,
    };
  };
  return [
    {
      key: "balance", title: "Bank balance not below zero", owner: "VP Finance",
      status: d.balance >= 0 ? "ok" : d.debt_plan?.trim() ? "warn" : "fail",
      detail: d.balance >= 0 ? `Balance ${money(d.balance)}.` : d.debt_plan?.trim()
        ? `Balance ${money(d.balance)}, with a debt repayment plan.` : `Balance ${money(d.balance)} and no debt repayment plan yet.`,
    },
    {
      key: "boa", title: "3 board of advisors (BoA) members", owner: "LCP",
      status: d.boa_members >= 3 ? "ok" : d.boa_members > 0 ? "warn" : "fail",
      detail: `${d.boa_members} of 3.`,
    },
    {
      key: "university", title: "University affiliation", owner: "LCP",
      status: d.university_affiliated ? "ok" : "fail",
      detail: d.university_affiliated ? "Affiliated." : "Not marked as affiliated yet.",
    },
    {
      key: "approvals", title: "5 oGX approvals a year", owner: "VPs oGX",
      status: d.approvals_12m >= 5 ? "ok" : d.approvals_12m >= 3 ? "warn" : "fail",
      detail: `${d.approvals_12m} in the last 12 months, from the pipeline.`,
    },
    {
      key: "meetings", title: "8 iGTa meetings a year", owner: "VP iGTa",
      status: d.meetings_12m >= 8 ? "ok" : d.meetings_12m >= 5 ? "warn" : "fail",
      detail: `${d.meetings_12m} in the last 12 months, from meetings logged on partners.`,
    },
    monthly("sona", "SONA to the MC by the 1st of each month", "LCP"),
    monthly("hr_report", "Monthly HR data report", "VP MXP"),
  ];
}
