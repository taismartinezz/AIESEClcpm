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

const signed = (e: FinanceEntry) => (e.type === "income" ? e.amount : -e.amount);

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
