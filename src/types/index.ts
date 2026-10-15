// ── User & Roles ──────────────────────────────────────────────────────────────

export type UserRole = "pi" | "researcher";

/** A role defined within a single lab. Built-in: PI, Researcher. Custom: anything the PI adds. */
export interface LabRole {
  id: string;
  projectId: string;
  name: string;
  permissionLevel: UserRole;
  isSystem: boolean;
  createdAt: string;
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

export interface SubProject {
  id: string;
  projectId: string;     // FK → projects.id (the lab)
  name: string;
  description?: string;
  createdBy?: string;
  createdAt: string;
  archived: boolean;
  color?: string;        // Material palette hex, auto-assigned on creation
}

export type ResearchType =
  | "trauma"
  | "oncology"
  | "conflict_zone"
  | "forensic"
  | "crisis_response"
  | "other";

export type ResearchParticipation =
  | "both_publications"
  | "wellbeing_only"
  | "private";

export interface Project {
  id: string;
  name: string;
  institution: string;
  researchType: ResearchType;
  researchParticipation: ResearchParticipation;
  createdAt: string;
  members: string[];      // User IDs
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
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
  createdAt: string;
  updatedAt: string;
  comments: TaskComment[];
  files: TaskFile[];
  links: TaskLink[];
}

// ── Journal ───────────────────────────────────────────────────────────────────

export type PromptCategory =
  | "emotional_processing"
  | "research_reflection"
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
