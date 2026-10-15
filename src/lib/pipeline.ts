import type { Exchange, Goal } from "@/types";

export function mapExchange(row: Record<string, unknown>): Exchange {
  const s = (k: string) => (row[k] as string | null) ?? null;
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    product: row.product as Exchange["product"],
    stage: row.stage as Exchange["stage"],
    personName: row.person_name as string,
    email: s("email"), phone: s("phone"), opportunity: s("opportunity"), hostEntity: s("host_entity"),
    expaId: s("expa_id"), expaUrl: s("expa_url"), departmentId: s("department_id"), ownerId: s("owner_id"), notes: s("notes"),
    signedUpAt: s("signed_up_at"), appliedAt: s("applied_at"), acceptedAt: s("accepted_at"),
    approvedAt: s("approved_at"), realizedAt: s("realized_at"), finishedAt: s("finished_at"),
    updatedAt: row.updated_at as string,
  };
}

export function mapGoal(row: Record<string, unknown>): Goal {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    departmentId: (row.department_id as string | null) ?? null,
    title: row.title as string,
    metric: row.metric as Goal["metric"],
    product: (row.product as Goal["product"]) ?? null,
    stage: (row.stage as Goal["stage"]) ?? null,
    target: Number(row.target),
    currentValue: Number(row.current_value),
    unit: (row.unit as string | null) ?? null,
    startsOn: row.starts_on as string,
    endsOn: row.ends_on as string,
  };
}

/** Days since a date (ISO), for "in this stage for N days". */
export function daysSince(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso + "T00:00:00").getTime()) / 86_400_000));
}

export function progressRatio(current: number, target: number): number {
  return target > 0 ? Math.min(1, Math.max(0, current / target)) : 0;
}
