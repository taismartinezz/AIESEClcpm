// Member lifecycle for Talent Management: recruitment, onboarding, term dates
// and activity signals. Mirrors supabase/migrations/20261019001_member_lifecycle.sql.

export type RecruitStage = "applied" | "interview" | "offer" | "joined" | "rejected" | "withdrawn";

export const RECRUIT_STAGES: { code: RecruitStage; label: string; open: boolean }[] = [
  { code: "applied",   label: "Applied",   open: true },
  { code: "interview", label: "Interview", open: true },
  { code: "offer",     label: "Offer",     open: true },
  { code: "joined",    label: "Joined",    open: false },
  { code: "rejected",  label: "Rejected",  open: false },
  { code: "withdrawn", label: "Withdrawn", open: false },
];
export const RECRUIT_STAGE_LABEL = Object.fromEntries(RECRUIT_STAGES.map((s) => [s.code, s.label])) as Record<RecruitStage, string>;

export interface Recruit {
  id: string; name: string; email: string | null; phone: string | null; source: string | null;
  departmentId: string | null; stage: RecruitStage; interviewAt: string | null; notes: string | null;
  ownerId: string | null; appliedOn: string;
}

export function mapRecruit(r: Record<string, unknown>): Recruit {
  const s = (k: string) => (r[k] as string | null) ?? null;
  return {
    id: r.id as string, name: r.name as string, email: s("email"), phone: s("phone"), source: s("source"),
    departmentId: s("department_id"), stage: r.stage as RecruitStage, interviewAt: s("interview_at"), notes: s("notes"),
    ownerId: s("owner_id"), appliedOn: r.applied_on as string,
  };
}

export interface OnboardingStep { id: string; title: string; description: string | null; departmentId: string | null; sortOrder: number }

export function mapStep(r: Record<string, unknown>): OnboardingStep {
  return { id: r.id as string, title: r.title as string, description: (r.description as string | null) ?? null, departmentId: (r.department_id as string | null) ?? null, sortOrder: r.sort_order as number };
}

/** Steps that apply to someone in `departmentId`. */
export function stepsFor(steps: OnboardingStep[], departmentId: string | null): OnboardingStep[] {
  return steps.filter((s) => !s.departmentId || s.departmentId === departmentId).sort((a, b) => a.sortOrder - b.sortOrder);
}

export interface MemberActivity {
  userId: string; departmentId: string | null; role: string; termStart: string | null; termEnd: string | null;
  lastSeenAt: string | null; eventsHeld: number; eventsAttended: number; tablingNoShows: number;
  overdueTasks: number; onboardingDone: number; onboardingTotal: number;
}

export function mapActivity(r: Record<string, unknown>): MemberActivity {
  return {
    userId: r.user_id as string, departmentId: (r.department_id as string | null) ?? null, role: r.role as string,
    termStart: (r.term_start as string | null) ?? null, termEnd: (r.term_end as string | null) ?? null,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
    eventsHeld: Number(r.events_held), eventsAttended: Number(r.events_attended), tablingNoShows: Number(r.tabling_no_shows),
    overdueTasks: Number(r.overdue_tasks), onboardingDone: Number(r.onboarding_done), onboardingTotal: Number(r.onboarding_total),
  };
}

export interface ActivityFlag { kind: "inactive" | "attendance" | "no_shows" | "overdue" | "term_ending"; label: string }

/** Signals worth a conversation, not a judgement. Thresholds are deliberately gentle. */
export function activityFlags(a: MemberActivity, now = new Date()): ActivityFlag[] {
  const flags: ActivityFlag[] = [];
  const days = (iso: string) => Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (!a.lastSeenAt) flags.push({ kind: "inactive", label: "Hasn't opened the app yet" });
  else if (days(a.lastSeenAt) >= 14) flags.push({ kind: "inactive", label: `Not seen for ${days(a.lastSeenAt)} days` });
  if (a.eventsHeld >= 3 && a.eventsAttended / a.eventsHeld < 0.5) {
    flags.push({ kind: "attendance", label: `At ${a.eventsAttended} of ${a.eventsHeld} events` });
  }
  if (a.tablingNoShows >= 2) flags.push({ kind: "no_shows", label: `${a.tablingNoShows} tabling no-shows` });
  if (a.overdueTasks >= 3) flags.push({ kind: "overdue", label: `${a.overdueTasks} overdue tasks` });
  if (a.termEnd) {
    const left = -days(a.termEnd + "T00:00:00");
    if (left >= 0 && left <= 30) flags.push({ kind: "term_ending", label: `Term ends in ${left} days` });
  }
  return flags;
}
