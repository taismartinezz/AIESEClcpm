// Term handover notes: one per department per term, plus an LC-wide note from
// the president. Mirrors handover_notes in supabase/migrations/20261017004.

export interface HandoverNote {
  id: string;
  departmentId: string | null;
  termLabel: string;
  title: string;
  body: string;
  updatedBy: string | null;
  updatedAt: string;
}

export function mapHandoverNote(r: Record<string, unknown>): HandoverNote {
  return {
    id: r.id as string,
    departmentId: (r.department_id as string | null) ?? null,
    termLabel: r.term_label as string,
    title: r.title as string,
    body: (r.body as string) ?? "",
    updatedBy: (r.updated_by as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

/** "2026-02-01" → "2026/27": the term that starts on that date. */
export function termLabel(termStart: string): string {
  const y = Number(termStart.slice(0, 4));
  return `${y}/${String((y + 1) % 100).padStart(2, "0")}`;
}

/** Newest term first; always includes the current one. */
export function termOptions(current: string, existing: string[]): string[] {
  return [...new Set([current, ...existing])].sort().reverse();
}

export const HANDOVER_TEMPLATE = `## What we did this term
-

## What worked
-

## What didn't, and why
-

## Open items and deadlines
-

## Key contacts (partners, MC, other LCs)
-

## Where things are (LC Drive folders, accounts, passwords via the president)
-

## Advice for whoever comes next
-
`;
