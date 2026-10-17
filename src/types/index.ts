// ── User & Roles ──────────────────────────────────────────────────────────────

/**
 * Permission level inside one Local Committee (LC). A person can hold a different
 * level in each LC they belong to — always read it for the active LC.
 *   president — the LCP: manages the LC, roles, invites, departments and settings
 *   vp        — executive board member; leads one or more departments
 *   member    — team member who reports to a VP
 */
export type UserRole = "president" | "vp" | "member";

/** A role title within one LC. Built-in: President, VP, Member. Custom titles map to a level. */
export interface LabRole {
  id: string;
  projectId: string;
  name: string;
  permissionLevel: UserRole;
  isSystem: boolean;
  createdAt: string;
}

/** A functional area of an LC (oGV, Marketing, …). Each member belongs to one; VPs lead them. */
export interface Department {
  id: string;
  projectId: string;
  name: string;
  color: string;
  vpUserId: string | null;
  /** The department whose VP is in charge of finance (Finance & Legality by default). */
  isFinance: boolean;
  sortOrder: number;
  /** AIESEC products this department runs (ogv, ogta, ogte, igv, igta, igte). */
  products: string[];
  /** Member Pulse area this department is pooled into; null = automatic from its products. */
  pulseArea?: "outgoing" | "incoming" | "support" | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarColor: string;   // CSS hex - pastel
  avatarInitials: string;
  avatarUrl?: string;    // profile photo URL from Supabase Storage
  institution?: string;
  currentTask?: string;  // public "this week I'm working on..."
}

// ── Project ───────────────────────────────────────────────────────────────────

/** A group inside an LC (a project team, committee, …). Stored in `sub_projects`. */
export interface SubProject {
  id: string;
  projectId: string;     // FK → projects.id (the LC)
  name: string;
  description?: string;
  createdBy?: string;
  createdAt: string;
  archived: boolean;
  color?: string;        // Material palette hex, auto-assigned on creation
}

/** A Local Committee. Stored in the `projects` table. */
export interface Project {
  id: string;
  name: string;
  institution: string;    // university or city
  createdAt: string;
  members: string[];      // User IDs
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
export type TaskPriority = "high" | "medium" | "low";

export interface TaskComment {
  id: string;
  authorId: string;
  content: string;
  createdAt: string;
  mentions?: string[];   // User IDs
}

export interface TaskFile {
  id: string;
  name: string;
  size: number;           // bytes
  uploaderId: string;
  uploadedAt: string;
  url: string;
  storagePath?: string;   // Supabase Storage object path for deletion
  type: "pdf" | "docx" | "image" | "spreadsheet" | "other";
}

export interface TaskLink {
  id: string;
  title: string;
  url: string;
  type: "google_doc" | "google_sheet" | "other";
}

export interface Task {
  id: string;
  projectId: string;
  parentId?: string | null; // null = top-level task; set = subtask
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeIds: string[];
  dueDate?: string;       // ISO date string
  scope?: "personal" | "project" | "lab";
  subProjectId?: string;
  departmentId?: string | null;
  createdAt: string;
  updatedAt: string;
  comments: TaskComment[];
  files: TaskFile[];
  links: TaskLink[];
}

// ── Journal ───────────────────────────────────────────────────────────────────

export type PromptCategory =
  | "emotional_processing"
  | "purpose_growth"
  | "team_support"
  | "boundaries_workload"
  | "looking_forward";

export interface JournalPrompt {
  id: string;
  text: string;
  category: PromptCategory;
  isCustom?: boolean;
  suggestedBy?: string;  // User ID (PI) if suggested
}

export interface PromptResponse {
  promptId: string;
  promptText: string;
  response: string;
}

export interface CheckinResponse {
  questionId: string;
  score: 1 | 2 | 3 | 4 | 5;
}

export interface JournalEntry {
  id: string;
  userId: string;
  date: string;           // ISO date string
  prompts: PromptResponse[];
  checkin: CheckinResponse[];
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CheckinQuestion {
  id: string;
  text: string;
}

// ── Team ──────────────────────────────────────────────────────────────────────

export interface TeamMember extends User {
  taskCounts: Record<TaskStatus, number>;
  weeklyUpdate?: string;
  weeklyUpdatedAt?: string;
  labRoleName?: string;
  departmentId?: string | null;
}

// ── Activity Feed ─────────────────────────────────────────────────────────────

export interface ActivityEvent {
  id: string;
  actorId: string;
  action: string;          // e.g. "moved", "created", "uploaded"
  objectType: "task" | "file" | "comment";
  objectLabel: string;     // e.g. "Write Proposal"
  destination?: string;    // e.g. "In Progress"
  createdAt: string;
}

// ── Events / Calendar ─────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;            // ISO date string
  time?: string;
  projectId: string;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export type NotificationType =
  | "task_assigned"
  | "task_moved"
  | "task_comment"
  | "task_mention"
  | "unassigned_tasks"
  | "checkin_requested"
  | "aggregate_ready"
  | "journal_reminder"
  | "meeting_proposed"
  | "meeting_response"
  | "reminder";

export interface Notification {
  id: string;
  type: NotificationType;
  recipientId: string;
  message: string;
  read: boolean;
  createdAt: string;
  linkTo?: string;
}

// ── Opportunities & Lab Wins ───────────────────────────────────────────────────

export interface DashboardPost {
  id: string;
  authorId: string;
  content: string;
  createdAt: string;
  type: "opportunity" | "lab_win";
}

// ── Settings ──────────────────────────────────────────────────────────────────

// Per-day working hours; key = "0" (Mon) … "6" (Sun), null = day off
export type DayWorkingHours = { start: string; end: string } | null;
export type WorkingHours = Record<string, DayWorkingHours>;

export interface UserSettings {
  userId: string;
  timezone: string;         // IANA timezone string, e.g. "America/New_York"
  workingHours: WorkingHours;
  updatedAt: string;
}

export type ReminderPriority = "low" | "medium" | "high";
export type ReminderRecurrence = "daily" | "weekly" | "monthly";
export type ReminderScope = "personal" | "lab" | "project";

export interface Reminder {
  id: string;
  userId: string;         // creator
  projectId?: string;     // required when scope = "lab"
  subProjectId?: string;  // required when scope = "project"
  scope?: ReminderScope;  // defaults to "personal"
  title: string;
  dueAt?: string;         // ISO datetime - optional (untimed reminders allowed)
  linkedTaskId?: string;
  linkedEventId?: string;
  emailEnabled: boolean;
  sent: boolean;
  completed: boolean;
  completedAt?: string;
  priority?: ReminderPriority;
  recurrence?: ReminderRecurrence;
  createdAt: string;
  position?: number;      // fractional index for manual drag order
  assigneeId?: string;    // user to notify (shows in their reminders)
}

// ── Finance ───────────────────────────────────────────────────────────────────

export type FinanceEntryType = "income" | "expense";
export type ClaimStatus = "pending" | "approved" | "rejected";

export interface FinanceCategory {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
}

/** A ledger line. `claimId` is set when it was created by approving a claim. */
export interface FinanceEntry {
  id: string;
  projectId: string;
  type: FinanceEntryType;
  amount: number;
  currency: string;
  date: string;            // ISO date
  categoryId: string | null;
  departmentId: string | null;
  description: string;
  recordedBy: string | null;
  receiptPath: string | null;
  claimId: string | null;
  createdAt: string;
}

export interface ExpenseClaim {
  id: string;
  projectId: string;
  submittedBy: string;
  amount: number;
  currency: string;
  date: string;            // date of the expense
  description: string;
  departmentId: string | null;
  categoryId: string | null;
  receiptPath: string;
  status: ClaimStatus;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

// ── Attendance ────────────────────────────────────────────────────────────────

export type LcEventType =
  | "local_event"
  | "local_conference"
  | "national_conference"
  | "international_conference"
  | "info_session"
  | "other";

export interface LcEvent {
  id: string;
  projectId: string;
  name: string;
  type: LcEventType;
  startsOn: string;        // ISO date
  endsOn: string;          // ISO date
  location: string | null;
  departmentId: string | null;
  createdBy: string | null;
  /** Timed events; null for all-day. */
  startsAt: string | null;
  endsAt: string | null;
  meetingUrl: string | null;
  description: string | null;
  audience: "lc" | "department" | "role" | "people";
  audienceRole: "president" | "vp" | "member" | "exec" | null;
  invitesSentAt: string | null;
}

export interface AttendanceRecord {
  eventId: string;
  userId: string;
  recordedBy: string | null;
  recordedAt: string;
}

// ── Tabling ───────────────────────────────────────────────────────────────────

export type TablingStatus = "signed_up" | "attended" | "no_show";

export interface TablingSlot {
  id: string;
  projectId: string;
  startsAt: string;        // ISO timestamp
  endsAt: string;
  location: string;
  purpose: string;
  capacity: number;
  taken: number;           // non-walk-in sign-ups (visible to everyone)
  departmentId: string | null;
  seriesId: string | null;
  createdBy: string | null;
}

export interface TablingSignup {
  slotId: string;
  userId: string;
  status: TablingStatus;
  walkIn: boolean;
  signedUpAt: string;
}

export interface TablingReportRow {
  userId: string;
  hours: number;
  attended: number;
  noShows: number;
  upcoming: number;
}

// ── Exchange pipeline & goals ─────────────────────────────────────────────────

export interface Exchange {
  id: string;
  projectId: string;
  product: import("@/lib/products").ProductCode;
  stage: import("@/lib/products").ExchangeStage;
  personName: string;
  email: string | null;
  phone: string | null;
  opportunity: string | null;
  hostEntity: string | null;
  expaId: string | null;
  expaUrl: string | null;
  departmentId: string | null;
  ownerId: string | null;
  notes: string | null;
  signedUpAt: string | null;
  appliedAt: string | null;
  acceptedAt: string | null;
  approvedAt: string | null;
  realizedAt: string | null;
  finishedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface Goal {
  id: string;
  projectId: string;
  departmentId: string | null;
  title: string;
  metric: "manual" | "pipeline";
  product: import("@/lib/products").ProductCode | null;
  stage: import("@/lib/products").ExchangeStage | null;
  target: number;
  currentValue: number;
  unit: string | null;
  startsOn: string;
  endsOn: string;
}

// ── Partner CRM ───────────────────────────────────────────────────────────────

export type PartnerStage = "lead" | "contacted" | "meeting" | "proposal" | "negotiation" | "partner" | "lost";

export interface Partner {
  id: string;
  projectId: string;
  name: string;
  industry: string | null;
  website: string | null;
  stage: PartnerStage;
  departmentId: string | null;
  ownerId: string | null;
  nextFollowUp: string | null;   // ISO date
  notes: string | null;
  updatedAt: string;
}

export interface PartnerContact {
  id: string;
  partnerId: string;
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
}

export interface PartnerActivity {
  id: string;
  partnerId: string;
  kind: "note" | "call" | "email" | "meeting";
  body: string;
  happenedOn: string;
  authorId: string | null;
}
