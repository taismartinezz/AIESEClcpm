import type { ExpenseClaim, FinanceCategory, FinanceEntry } from "@/types";

export const DEFAULT_CURRENCY = "EUR";

export const RECEIPT_BUCKET = "receipts";
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function mapEntry(row: Record<string, unknown>): FinanceEntry {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    type: row.type as FinanceEntry["type"],
    amount: Number(row.amount),
    currency: row.currency as string,
    date: row.entry_date as string,
    categoryId: (row.category_id as string | null) ?? null,
    departmentId: (row.department_id as string | null) ?? null,
    description: (row.description as string) ?? "",
    recordedBy: (row.recorded_by as string | null) ?? null,
    receiptPath: (row.receipt_path as string | null) ?? null,
    claimId: (row.claim_id as string | null) ?? null,
    createdAt: row.created_at as string,
    account: (row.account as FinanceEntry["account"] | undefined) ?? "lc",
    paymentMethod: (row.payment_method as string | null) ?? null,
    processedVia: (row.processed_via as string | null) ?? null,
    area: (row.area as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  };
}

export function mapClaim(row: Record<string, unknown>): ExpenseClaim {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    submittedBy: row.submitted_by as string,
    amount: Number(row.amount),
    currency: row.currency as string,
    date: row.expense_date as string,
    description: row.description as string,
    departmentId: (row.department_id as string | null) ?? null,
    categoryId: (row.category_id as string | null) ?? null,
    receiptPath: row.receipt_path as string,
    status: row.status as ExpenseClaim["status"],
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function mapCategory(row: Record<string, unknown>): FinanceCategory {
  return { id: row.id as string, projectId: row.project_id as string, name: row.name as string, sortOrder: (row.sort_order as number) ?? 0 };
}

/** Expenses take money out; income and the opening balance put it in. */
export const signed = (e: Pick<FinanceEntry, "type" | "amount">) => (e.type === "expense" ? -e.amount : e.amount);

export interface FinanceTotals {
  balance: number;
  monthIn: number;
  monthOut: number;
  yearIn: number;
  yearOut: number;
}

/** Totals over the given entries (already filtered to what the caller may see). */
export function totals(entries: FinanceEntry[], today = new Date()): FinanceTotals {
  const month = today.toISOString().slice(0, 7);
  const year = today.toISOString().slice(0, 4);
  const t: FinanceTotals = { balance: 0, monthIn: 0, monthOut: 0, yearIn: 0, yearOut: 0 };
  for (const e of entries) {
    t.balance += signed(e);
    if (e.type === "opening") continue;          // a starting balance isn't income
    const income = e.type === "income";
    if (e.date.startsWith(year)) {
      if (income) t.yearIn += e.amount; else t.yearOut += e.amount;
    }
    if (e.date.startsWith(month)) {
      if (income) t.monthIn += e.amount; else t.monthOut += e.amount;
    }
  }
  return t;
}

/** Entries oldest → newest with the running balance after each one. */
export function withRunningBalance(entries: FinanceEntry[]): (FinanceEntry & { runningBalance: number })[] {
  let running = 0;
  return [...entries]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((e) => ({ ...e, runningBalance: (running += signed(e)) }));
}

/** Sum of amounts by key (category or department), for one entry type. */
export function breakdown(entries: FinanceEntry[], type: FinanceEntry["type"], key: (e: FinanceEntry) => string | null): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const e of entries) {
    if (e.type !== type) continue;
    const k = key(e);
    out.set(k, (out.get(k) ?? 0) + e.amount);
  }
  return out;
}

export function receiptExtension(file: File): string {
  const fromName = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  if (/^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return file.type === "application/pdf" ? "pdf" : "jpg";
}

// ── The National Finance Tracker: balances, growth and the trend ─────────────

/** What the tracker offers in its Payment method / Processed on columns. */
export const PAYMENT_METHODS = ["Debit card", "Credit card", "Cash", "Check", "ACH transfer", "Zelle", "PayPal", "Wire transfer", "Venmo"];
/** The tracker's Department / Area column. */
export const TRACKER_AREAS = ["MXP", "OGX", "ICX", "B2B", "LCP", "F&L", "TM", "Marketing", "EwA"];

/** Balance after every entry dated on or before `date` (YYYY-MM-DD). */
export function balanceAt(entries: Pick<FinanceEntry, "type" | "amount" | "date">[], date: string): number {
  return round2(entries.reduce((s, e) => (e.date <= date ? s + signed(e) : s), 0));
}

/** Growth of the balance since `date`, as a fraction (0.19 = +19%). Null when it started at or below zero. */
export function growthSince(entries: Pick<FinanceEntry, "type" | "amount" | "date">[], date: string | null, today = isoToday()): number | null {
  if (!date) return null;
  const before = balanceAt(entries, date);
  if (before <= 0) return null;
  return (balanceAt(entries, today) - before) / before;
}

/** End-of-month balance for every month from `from`'s month to `to`'s month (inclusive). */
export function monthlyBalances(entries: Pick<FinanceEntry, "type" | "amount" | "date">[], from: string, to = isoToday()): { month: string; balance: number }[] {
  const out: { month: string; balance: number }[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  for (let guard = 0; (y < ty || (y === ty && m <= tm)) && guard < 120; guard++) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    out.push({ month, balance: balanceAt(entries, lastDay < to ? lastDay : to) });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Income and spend between two dates (inclusive), leaving out opening balances. */
export function flowBetween(entries: Pick<FinanceEntry, "type" | "amount" | "date">[], from: string, to = isoToday()): { income: number; expense: number } {
  let income = 0, expense = 0;
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    if (e.type === "income") income += e.amount;
    else if (e.type === "expense") expense += e.amount;
  }
  return { income: round2(income), expense: round2(expense) };
}

/** "Mar 2026" from "2026-03". */
export function monthLabel(month: string, withYear = true): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function isoToday() { return new Date().toISOString().slice(0, 10); }
