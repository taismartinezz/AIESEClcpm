/**
 * The MC budget (budget vs actuals), as in the MC Budget Tool sheet: account
 * lines per fiscal year (July to June), each with last year's and this year's
 * budget, an optional plan per month, and any number of payments (the actuals).
 */

export const FY_MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"] as const;

export interface BudgetLine {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  prevBudget: number | null;
  budget: number;
  monthBudgets: number[] | null;
  notes: string | null;
  sortOrder: number;
}

export interface BudgetPayment {
  id: string;
  lineId: string;
  paidOn: string;
  amount: number;
  description: string;
  tags: string[];
  comment: string | null;
}

export interface LineSummary {
  line: BudgetLine;
  children: LineSummary[];
  /** Last year's budget: the line's own, or that year's line with the same code. */
  prevBudget: number | null;
  budget: number;
  /** The plan per month (July first), or null when no month has one. */
  plan: number[] | null;
  /** Spent per month (July first). */
  actual: number[];
  spent: number;
  remaining: number;
  payments: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const zeros = () => Array.from({ length: 12 }, () => 0);

/** "26.27" for the year that starts in July 2026. */
export function fyLabel(fy: number): string {
  const two = (n: number) => String(((n % 100) + 100) % 100).padStart(2, "0");
  return `${two(fy)}.${two(fy + 1)}`;
}

/** The fiscal year a date (YYYY-MM-DD) falls in: July 2026 to June 2027 is 2026. */
export function fyOf(date: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m >= 7 ? y : y - 1;
}

/** 0 for July ... 11 for June. */
export function monthIndex(date: string): number {
  return (Number(date.slice(5, 7)) + 5) % 12;
}

export function fyRange(fy: number): { from: string; to: string } {
  return { from: `${fy}-07-01`, to: `${fy + 1}-06-30` };
}

/** A date inside the year: the given month's first day, or today when it's in the year. */
export function defaultPaymentDate(fy: number, month: number | null, today: string): string {
  if (month !== null) {
    const m = ((month + 6) % 12) + 1;
    const y = m >= 7 ? fy : fy + 1;
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    return fyOf(today) === fy && monthIndex(today) === month ? today : first;
  }
  return fyOf(today) === fy ? today : fyRange(fy).from;
}

export const compareCodes = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function mapLine(row: Record<string, unknown>): BudgetLine {
  const months = row.month_budgets as (number | string | null)[] | null;
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    parentId: (row.parent_id as string | null) ?? null,
    prevBudget: row.prev_budget === null || row.prev_budget === undefined ? null : Number(row.prev_budget),
    budget: Number(row.budget ?? 0),
    monthBudgets: months ? months.map((m) => Number(m ?? 0)) : null,
    notes: (row.notes as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export function mapPayment(row: Record<string, unknown>): BudgetPayment {
  return {
    id: row.id as string,
    lineId: row.line_id as string,
    paidOn: row.paid_on as string,
    amount: Number(row.amount),
    description: (row.description as string) ?? "",
    tags: (row.tags as string[] | null) ?? [],
    comment: (row.comment as string | null) ?? null,
  };
}

/** Every tag used this year with what was spent under it, biggest first. */
export function tagTotals(payments: BudgetPayment[]): { tag: string; spent: number; count: number }[] {
  const by = new Map<string, { spent: number; count: number }>();
  for (const p of payments) for (const t of p.tags) {
    const cur = by.get(t) ?? { spent: 0, count: 0 };
    by.set(t, { spent: round(cur.spent + p.amount), count: cur.count + 1 });
  }
  return [...by.entries()].map(([tag, v]) => ({ tag, ...v })).sort((a, b) => b.spent - a.spent || a.tag.localeCompare(b.tag));
}

/**
 * Lines as a tree (sub-lines under their line), each with its budget, plan and
 * actuals per month. A line with sub-lines adds them up (plus anything paid on
 * the line itself). With a tag, only payments carrying it count as actuals.
 */
export function summarize(lines: BudgetLine[], payments: BudgetPayment[], opts: { tag?: string | null; prevLines?: BudgetLine[] } = {}): LineSummary[] {
  const prevByCode = new Map((opts.prevLines ?? []).map((l) => [l.code, l]));
  const counted = opts.tag ? payments.filter((p) => p.tags.includes(opts.tag!)) : payments;
  const byLine = new Map<string, BudgetPayment[]>();
  for (const p of counted) byLine.set(p.lineId, [...(byLine.get(p.lineId) ?? []), p]);
  const order = (a: BudgetLine, b: BudgetLine) => a.sortOrder - b.sortOrder || compareCodes(a.code, b.code);
  const ids = new Set(lines.map((l) => l.id));

  const own = (l: BudgetLine): LineSummary => {
    const actual = zeros();
    const mine = byLine.get(l.id) ?? [];
    for (const p of mine) actual[monthIndex(p.paidOn)] = round(actual[monthIndex(p.paidOn)] + p.amount);
    const plan = l.monthBudgets && l.monthBudgets.some((m) => m !== 0) ? l.monthBudgets.map(round) : null;
    const prevOwn = prevByCode.get(l.code);
    const spent = round(actual.reduce((s, n) => s + n, 0));
    return { line: l, children: [], prevBudget: l.prevBudget ?? (prevOwn ? prevOwn.budget : null), budget: l.budget, plan, actual, spent, remaining: round(l.budget - spent), payments: mine.length };
  };

  const tops = lines.filter((l) => !l.parentId || !ids.has(l.parentId)).sort(order);
  return tops.map((top) => {
    const base = own(top);
    const kids = lines.filter((l) => l.parentId === top.id).sort(order).map(own);
    if (kids.length === 0) return base;
    const actual = base.actual.map((n, i) => round(n + kids.reduce((s, k) => s + k.actual[i], 0)));
    const plans = kids.filter((k) => k.plan);
    const plan = plans.length ? zeros().map((_, i) => round(plans.reduce((s, k) => s + k.plan![i], 0))) : null;
    const budget = round(kids.reduce((s, k) => s + k.budget, 0));
    const prevKnown = kids.some((k) => k.prevBudget !== null);
    const prevBudget = base.line.prevBudget ?? (prevKnown ? round(kids.reduce((s, k) => s + (k.prevBudget ?? 0), 0)) : base.prevBudget);
    const spent = round(actual.reduce((s, n) => s + n, 0));
    return { ...base, children: kids, budget, plan, actual, prevBudget, spent, remaining: round(budget - spent), payments: base.payments + kids.reduce((s, k) => s + k.payments, 0) };
  });
}

/** The whole budget's totals, from the top-level lines. */
export function totals(tree: LineSummary[]): { budget: number; prevBudget: number | null; spent: number; remaining: number; plan: number[] | null; actual: number[] } {
  const anyPrev = tree.some((t) => t.prevBudget !== null);
  const plans = tree.filter((t) => t.plan);
  return {
    budget: round(tree.reduce((s, t) => s + t.budget, 0)),
    prevBudget: anyPrev ? round(tree.reduce((s, t) => s + (t.prevBudget ?? 0), 0)) : null,
    spent: round(tree.reduce((s, t) => s + t.spent, 0)),
    remaining: round(tree.reduce((s, t) => s + t.remaining, 0)),
    plan: plans.length ? zeros().map((_, i) => round(plans.reduce((s, t) => s + t.plan![i], 0))) : null,
    actual: zeros().map((_, i) => round(tree.reduce((s, t) => s + t.actual[i], 0))),
  };
}

/** Spread a yearly amount over 12 months, cents exact (the last month takes the rest). */
export function spreadEvenly(total: number): number[] {
  const cents = Math.round(total * 100);
  const each = Math.trunc(cents / 12);
  return Array.from({ length: 12 }, (_, i) => (i === 11 ? cents - each * 11 : each) / 100);
}

/** "1,234.50", "1.234,50", "(250)", "$ 80", "-" → numbers; empty or unreadable → null. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/[\s ]/g, "").replace(/[^\d.,()\-+]/g, "");
  if (s === "" || s === "-" || s === "–") return s === "" ? null : 0;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()+-]/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    s = s.split(dec === "." ? "," : ".").join("").replace(",", ".");
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && s.split(",").length === 2 ? s.replace(",", ".") : s.split(",").join("");
  } else if (lastDot >= 0 && s.split(".").length > 2) {
    s = s.split(".").join("");
  }
  const n = Number(s);
  if (!Number.isFinite(n) || s === "") return null;
  return Math.round((negative ? -n : n) * 100) / 100;
}

export interface PastedLine { code: string; name: string; prevBudget: number | null; budget: number; monthBudgets: number[] | null; parentCode: string | null }

/**
 * Rows copied from the budget sheet: code, account name, last year's budget,
 * this year's budget and, optionally, the 12 months (July first). The code and
 * name can share a cell ("6251 Strategic Fund"). Header and ACTUALS rows are
 * skipped. "6251-01" sits under "6251" when that line is there.
 */
export function parsePastedBudget(text: string, existingCodes: string[] = []): { lines: PastedLine[]; skipped: number } {
  const rows = text.split(/\r?\n/).map((r) => r.replace(/\s+$/, "")).filter((r) => r.trim() !== "");
  const out: PastedLine[] = [];
  let skipped = 0;
  for (const row of rows) {
    let cells = (row.includes("\t") ? row.split("\t") : row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).map((c) => c.trim().replace(/^"|"$/g, ""));
    // "6251 Strategic Fund" in one cell, numbers after it.
    const joined = /^(\d[\w.\-/]*)\s+(.+)$/.exec(cells[0] ?? "");
    if (joined && (cells.length < 2 || parseAmount(cells[1]) !== null)) cells = [joined[1], joined[2], ...cells.slice(1)];
    const [code = "", name = ""] = cells;
    const label = `${code} ${name}`.toLowerCase();
    if (!code || !name || /^(code|account|acc\.?|total|actuals?|budget)\b/.test(code.toLowerCase()) || /\bactuals?\b/.test(label)) { skipped++; continue; }
    if (code.length > 20 || name.length > 120) { skipped++; continue; }
    const nums = cells.slice(2).map(parseAmount);
    const months = nums.slice(2, 14);
    out.push({
      code, name,
      prevBudget: nums[0] ?? null,
      budget: nums[1] ?? 0,
      monthBudgets: months.length === 12 && months.some((m) => m !== null) ? months.map((m) => m ?? 0) : null,
      parentCode: null,
    });
  }
  const known = new Set([...existingCodes, ...out.map((l) => l.code)]);
  for (const l of out) {
    const m = /^(.+?)[-.](\d+)$/.exec(l.code);
    if (m && known.has(m[1]) && m[1] !== l.code) l.parentCode = m[1];
  }
  return { lines: out, skipped };
}

/** The budget as rows for a CSV: a Budget row and an Actuals row per line, as in the sheet. */
export function budgetCsvRows(tree: LineSummary[], fy: number): (string | number)[][] {
  const header = ["Code", "Account", "Row", `Budget ${fyLabel(fy - 1)}`, `Budget ${fyLabel(fy)}`, ...FY_MONTHS, "Total", "Left"];
  const rows: (string | number)[][] = [header];
  const add = (s: LineSummary, indent: string) => {
    rows.push([s.line.code, indent + s.line.name, "Budget", s.prevBudget ?? "", s.budget, ...(s.plan ?? zeros().map(() => "")), s.plan ? round(s.plan.reduce((a, b) => a + b, 0)) : "", ""]);
    rows.push([s.line.code, indent + s.line.name, "Actuals", "", "", ...s.actual, s.spent, s.remaining]);
    for (const c of s.children) add(c, "  ");
  };
  for (const t of tree) add(t, "");
  return rows;
}
