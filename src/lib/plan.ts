// The LC plan's battles: which months show by default.

/** First of a month, as "YYYY-MM-01". */
export const monthOf = (d: Date) => `${d.toISOString().slice(0, 7)}-01`;

/**
 * The term's months split for display: this month and the next two show; the
 * months before fold under "Earlier", the rest under "Later". Before the term
 * starts, its first three months show.
 */
export function battleMonths(months: string[], now: string): { earlier: string[]; shown: string[]; later: string[] } {
  const from = Math.max(0, months.findIndex((m) => m >= now));
  const start = months.some((m) => m >= now) ? from : Math.max(0, months.length - 3);
  return { earlier: months.slice(0, start), shown: months.slice(start, start + 3), later: months.slice(start + 3) };
}
