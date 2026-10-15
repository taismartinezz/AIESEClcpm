import type {
  User, Project, Task, JournalEntry, JournalPrompt,
  TeamMember, ActivityEvent, Department,
  CalendarEvent, DashboardPost, Notification, Reminder,
} from "@/types";

// Demo data shown when no Supabase project is configured (prototype mode).
// It models one AIESEC Local Committee; every name here is fictional.

// ── Users ─────────────────────────────────────────────────────────────────────

export const CURRENT_USER_ID = "u1"; // The signed-in demo user (a Marketing member)

export const USERS: User[] = [
  { id: "u0", name: "Sofia Almeida", email: "sofia.almeida@example.com", role: "president", avatarColor: "#B4D4F7", avatarInitials: "SA" },
  { id: "u1", name: "Tais Martinez", email: "tais.martinez@example.com", role: "member",    avatarColor: "#B4E3E5", avatarInitials: "TM" },
  { id: "u2", name: "Kwame Mensah",  email: "kwame.mensah@example.com",  role: "vp",        avatarColor: "#FBD3CB", avatarInitials: "KM" },
  { id: "u3", name: "Lena Fischer",  email: "lena.fischer@example.com",  role: "vp",        avatarColor: "#FFEBB5", avatarInitials: "LF" },
  { id: "u4", name: "Priya Nair",    email: "priya.nair@example.com",    role: "member",    avatarColor: "#B5ECD3", avatarInitials: "PN" },
  { id: "u5", name: "Diego Rojas",   email: "diego.rojas@example.com",   role: "member",    avatarColor: "#D9CCF2", avatarInitials: "DR" },
];

export function getUser(id: string) {
  return USERS.find((u) => u.id === id);
}

// ── Local Committee ───────────────────────────────────────────────────────────

export const PROJECT: Project = {
  id: "p1",
  name: "AIESEC in Lisbon",
  institution: "University of Lisbon",
  createdAt: "2026-02-01T00:00:00Z",
  members: USERS.map((u) => u.id),
};

export const DEPARTMENTS: Department[] = [
  { id: "d-ogv",  projectId: "p1", name: "Outgoing Global Volunteer",      color: "#F85A40", vpUserId: "u2", isFinance: false, sortOrder: 1, products: ["ogv"] },
  { id: "d-ogta", projectId: "p1", name: "Outgoing Global Talent/Teacher", color: "#0CB9C1", vpUserId: "u2", isFinance: false, sortOrder: 2, products: ["ogta", "ogte"] },
  { id: "d-igv",  projectId: "p1", name: "Incoming Global Volunteer",      color: "#D9442B", vpUserId: null, isFinance: false, sortOrder: 3, products: ["igv"] },
  { id: "d-igta", projectId: "p1", name: "Incoming Global Talent/Teacher", color: "#0A8F96", vpUserId: null, isFinance: false, sortOrder: 4, products: ["igta", "igte"] },
  { id: "d-mkt",  projectId: "p1", name: "Marketing",                      color: "#FFC845", vpUserId: "u3", isFinance: false, sortOrder: 5, products: [] },
  { id: "d-tm",   projectId: "p1", name: "Talent Management",              color: "#00C16E", vpUserId: null, isFinance: false, sortOrder: 6, products: [] },
  { id: "d-fl",   projectId: "p1", name: "Finance & Legality",             color: "#037EF3", vpUserId: null, isFinance: true,  sortOrder: 7, products: [] },
  { id: "d-bd",   projectId: "p1", name: "Business Development",           color: "#7552CC", vpUserId: null, isFinance: false, sortOrder: 8, products: [] },
];

/** Which department each demo member belongs to. */
export const MEMBER_DEPARTMENTS: Record<string, string | null> = {
  u0: null, u1: "d-mkt", u2: null, u3: null, u4: "d-ogv", u5: "d-mkt",
};

// ── Tasks ─────────────────────────────────────────────────────────────────────

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().split("T")[0];
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

function task(t: Partial<Task> & Pick<Task, "id" | "title" | "status">): Task {
  return {
    projectId: "p1", priority: "medium", assigneeIds: [], scope: "lab",
    createdAt: hoursAgo(240), updatedAt: hoursAgo(24),
    comments: [], files: [], links: [], ...t,
  };
}

export const TASKS: Task[] = [
  task({ id: "t1", title: "Design recruitment posters for the oGV info session", status: "in_progress", priority: "high",
    assigneeIds: ["u1", "u5"], departmentId: "d-mkt", dueDate: daysFromNow(3),
    description: "Two formats: A3 print and Instagram story. Use the new brand templates.",
    links: [{ id: "l1", title: "Poster brief (Google Doc)", url: "https://docs.google.com/", type: "google_doc" }] }),
  task({ id: "t2", title: "Book the auditorium for the info session", status: "todo", priority: "high",
    assigneeIds: ["u4"], departmentId: "d-ogv", dueDate: daysFromNow(5) }),
  task({ id: "t3", title: "Prepare onboarding pack for new members", status: "in_review", priority: "medium",
    assigneeIds: ["u0"], departmentId: "d-tm", dueDate: daysFromNow(7) }),
  task({ id: "t4", title: "Reach out to 10 partner companies for summer internships", status: "backlog", priority: "medium",
    departmentId: "d-bd" }),
  task({ id: "t5", title: "Post weekly exchange story on Instagram", status: "done", priority: "low",
    assigneeIds: ["u1"], departmentId: "d-mkt", dueDate: daysFromNow(-2) }),
  task({ id: "t6", title: "Collect reimbursement receipts from the national conference", status: "todo", priority: "medium",
    assigneeIds: ["u2"], departmentId: "d-fl", dueDate: daysFromNow(-1) }),
  task({ id: "t7", title: "Match 3 applicants with Global Volunteer projects", status: "in_progress", priority: "high",
    assigneeIds: ["u4", "u2"], departmentId: "d-ogv", dueDate: daysFromNow(10) }),
];

// ── Activity Feed ─────────────────────────────────────────────────────────────

export const ACTIVITY: ActivityEvent[] = [
  { id: "a1", actorId: "u4", action: "moved", objectType: "task", objectLabel: "Match 3 applicants with Global Volunteer projects", destination: "In progress", createdAt: hoursAgo(1) },
  { id: "a2", actorId: "u1", action: "uploaded", objectType: "file", objectLabel: "poster_v2.png", createdAt: hoursAgo(2) },
  { id: "a3", actorId: "u0", action: "commented on", objectType: "comment", objectLabel: "Prepare onboarding pack for new members", createdAt: hoursAgo(22) },
  { id: "a4", actorId: "u3", action: "created", objectType: "task", objectLabel: "Post weekly exchange story on Instagram", createdAt: hoursAgo(48) },
];

// ── Calendar Events ───────────────────────────────────────────────────────────

export const EVENTS: CalendarEvent[] = [
  { id: "e1", title: "oGV info session", date: daysFromNow(6), time: "18:00", projectId: "p1" },
  { id: "e2", title: "LC meeting", date: daysFromNow(2), time: "19:00", projectId: "p1" },
  { id: "e3", title: "National conference registration closes", date: daysFromNow(14), projectId: "p1" },
];

// ── Dashboard Posts ───────────────────────────────────────────────────────────

export const DASHBOARD_POSTS: DashboardPost[] = [
  { id: "dp1", authorId: "u3", content: "Applications are open for the national conference organising committee. Great for anyone who wants event experience.", createdAt: hoursAgo(36), type: "opportunity" },
  { id: "dp2", authorId: "u2", content: "Two applicants approved for Global Volunteer projects in Brazil this week!", createdAt: hoursAgo(72), type: "lab_win" },
  { id: "dp3", authorId: "u0", content: "Our info-session sign-ups doubled compared to last term. Great work, Marketing!", createdAt: hoursAgo(120), type: "lab_win" },
];

// ── Journal Prompts ───────────────────────────────────────────────────────────

export const JOURNAL_PROMPTS: JournalPrompt[] = [
  // Emotional processing
  { id: "jp1", text: "What emotions came up for you in your AIESEC work this week?", category: "emotional_processing" },
  { id: "jp2", text: "Was there a moment this week that really stuck with you, good or hard? What happened?", category: "emotional_processing" },
  { id: "jp3", text: "What have you done to take care of yourself this week?", category: "emotional_processing" },
  // Purpose & growth
  { id: "jp4", text: "What felt meaningful in your AIESEC experience this week?", category: "purpose_growth" },
  { id: "jp5", text: "What's one skill you're building through your role right now, and how is it going?", category: "purpose_growth" },
  { id: "jp6", text: "How does what you did this week connect to why you joined AIESEC?", category: "purpose_growth" },
  // Boundaries & workload
  { id: "jp7", text: "How did you balance AIESEC with your studies, work and personal life this week? What helped or made it hard?", category: "boundaries_workload" },
  { id: "jp8", text: "What's one thing you wish your VP or team knew about your workload this week?", category: "boundaries_workload" },
  // Team & support
  { id: "jp9", text: "Is there something you'd like more support with right now? What would that support look like?", category: "team_support" },
  { id: "jp10", text: "How connected did you feel to your team and LC this week?", category: "team_support" },
  // Looking forward
  { id: "jp11", text: "What's one thing you're looking forward to next week, in or outside of AIESEC?", category: "looking_forward" },
  { id: "jp12", text: "If you could change one thing about how your term is going, what would it be?", category: "looking_forward" },
];

export const ACTIVE_PROMPT_IDS = ["jp2", "jp7", "jp11"];

// ── Checkin Questions ─────────────────────────────────────────────────────────

// The check-in questions live in src/lib/wellbeing.ts (they are shared with the
// SQL pulse functions); re-exported here for existing imports.
export { CHECKIN_QUESTIONS, CHECKIN_LABELS } from "@/lib/wellbeing";

export const CHECKIN_COLORS: Record<number, string> = {
  1: "#C0392B",  // red       - very low
  2: "#D97706",  // amber     - low
  3: "#CA8A04",  // yellow    - neutral midpoint
  4: "#2E7D52",  // green     - good
  5: "#059669",  // emerald   - excellent
};

// ── Journal Entries ───────────────────────────────────────────────────────────

export const JOURNAL_ENTRIES: JournalEntry[] = [
  {
    id: "je1",
    userId: "u1",
    date: daysFromNow(-7),
    prompts: [
      { promptId: "jp2", promptText: "Was there a moment this week that really stuck with you, good or hard? What happened?",
        response: "Seeing the first poster go up on campus. I was nervous it looked amateur but people actually stopped to read it." },
      { promptId: "jp7", promptText: "How did you balance AIESEC with your studies, work and personal life this week? What helped or made it hard?",
        response: "Harder than usual: two exams plus the poster deadline. Told my VP early and we moved one task, which helped a lot." },
    ],
    checkin: [],
    isDraft: false,
    createdAt: hoursAgo(24 * 7),
    updatedAt: hoursAgo(24 * 7),
  },
];

// ── Team Members ──────────────────────────────────────────────────────────────

const WEEKLY_UPDATES: Record<string, string | undefined> = {
  u0: "Preparing the LC meeting agenda and the new-member onboarding pack.",
  u1: "Finishing the info-session posters.",
  u2: "Matching applicants and chasing conference receipts.",
  u3: "Planning next month's content calendar.",
  u4: "Booking rooms for the oGV info session.",
};

export const TEAM_MEMBERS: TeamMember[] = USERS.map((u, i) => ({
  ...u,
  departmentId: MEMBER_DEPARTMENTS[u.id] ?? null,
  taskCounts: { backlog: i % 2, todo: 1, in_progress: (i + 1) % 2, in_review: i === 0 ? 1 : 0, done: 1 },
  weeklyUpdate: WEEKLY_UPDATES[u.id],
  weeklyUpdatedAt: WEEKLY_UPDATES[u.id] ? hoursAgo(8 + i * 4) : undefined,
}));

// ── Notifications ─────────────────────────────────────────────────────────────

export const NOTIFICATIONS: Notification[] = [
  { id: "n1", type: "task_comment", recipientId: "u1", message: "Lena Fischer commented on Design recruitment posters for the oGV info session", read: false, createdAt: hoursAgo(1), linkTo: "/tasks" },
  { id: "n2", type: "task_assigned", recipientId: "u1", message: "You were assigned Post weekly exchange story on Instagram", read: true, createdAt: hoursAgo(30), linkTo: "/tasks" },
  { id: "n3", type: "journal_reminder", recipientId: "u1", message: "Your check-in for this fortnight is ready when you are.", read: false, createdAt: hoursAgo(36), linkTo: "/checkin" },
];

// ── Reminders ─────────────────────────────────────────────────────────────────

export const REMINDERS: Reminder[] = [
  { id: "rem1", userId: "u1", scope: "personal", title: "Send poster files to the print shop", dueAt: new Date(Date.now() + 86_400_000).toISOString(), linkedTaskId: "t1", emailEnabled: false, sent: false, completed: false, createdAt: hoursAgo(20) },
  { id: "rem2", userId: "u1", projectId: "p1", scope: "lab", title: "LC meeting: bring your department update", dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), emailEnabled: false, sent: false, completed: false, createdAt: hoursAgo(48) },
];

// ── Stored data helpers ───────────────────────────────────────────────────────

function nameToInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getStoredProject(): Project {
  if (typeof window === "undefined") return PROJECT;
  try {
    const stored = localStorage.getItem("aiesec_project");
    return stored ? ({ ...PROJECT, ...JSON.parse(stored) } as Project) : PROJECT;
  } catch {
    return PROJECT;
  }
}

export function getStoredUser(): User {
  const fallback = USERS.find((u) => u.id === CURRENT_USER_ID)!;
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem("aiesec_user");
    if (!stored) return fallback;
    const data = JSON.parse(stored);
    const name: string = data.name || fallback.name;
    return {
      ...fallback,
      name,
      role: (data.role as import("@/types").UserRole) || fallback.role,
      institution: data.institution ?? fallback.institution,
      avatarInitials: nameToInitials(name),
    };
  } catch {
    return fallback;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const diff = now - new Date(isoString).getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(isoDateString: string): string {
  const d = new Date(isoDateString + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatFullDate(isoDateString: string): string {
  const d = new Date(isoDateString + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
