// One way to show a day everywhere: "Oct 20" this year, "Oct 20, 2025" otherwise.

/** A YYYY-MM-DD date or an ISO timestamp → "Oct 20" (adds the year when it isn't this year). */
export function formatDay(value: string | null | undefined, now = new Date()): string {
  if (!value) return "-";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T12:00:00") : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
