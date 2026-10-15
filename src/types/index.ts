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

// ── Literature ────────────────────────────────────────────────────────────────

export type LiteratureType = "article" | "book" | "preprint" | "report" | "thesis";
export type ReadStatus = "read" | "reading" | "unread";
export type LibraryScope = "personal" | "lab" | "project";

export interface LiteratureFile {
  id: string;
  name: string;
  size: number;
  uploaderId: string;
  uploadedAt: string;
  ocrStatus?: "pending" | "ready" | null;
  url?: string;
  storagePath?: string;
}

export interface LiteratureItem {
  id: string;
  projectId: string;
  scope: LibraryScope;
  subProjectId?: string;
  type: LiteratureType;
  title: string;
  authors: string[];
  year: number;
  journal?: string;
  publisher?: string;
  volume?: string;
  pages?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  tags: string[];
  removedTags: string[];    // Tags explicitly removed by user - excluded from future syncs
  status: ReadStatus;
  rating: number;          // 1–5
  notes?: string;
  files: LiteratureFile[];
  addedById: string;
  addedAt: string;
  deletedAt?: string | null;
  collections: string[];   // Collection IDs
  relatedIds: string[];    // Related item IDs
  importSource?: "manual" | "zotero_json" | "zotero_api" | "doi" | "bibtex" | "url";
  zoteroKey?: string;   // Stable Zotero item key (e.g. "AIXIUGN3") - used as dedup key when DOI absent
}

export interface LiteratureCollection {
  id: string;
  name: string;
  iconName: string;
  itemCount: number;
}

export interface AnnotationBbox {
  x: number; y: number; w: number; h: number;  // 0–1 fractions of page canvas dimensions
  rects?: { x: number; y: number; w: number; h: number }[]; // per-line rects for multi-line selections
}

export interface LitAnnotation {
  id: string;
  itemId: string;
  authorId: string;
  text: string;          // quoted passage (empty for standalone comments)
  comment: string;
  pageRef?: string;
  parentId?: string;     // null = top-level; set = reply
  createdAt: string;
  updatedAt?: string;
  color?: string;        // hex color tag e.g. "#3B82F6"; undefined = no tag
  pageNumber?: number;   // 1-indexed PDF page; only set for PDF-anchored annotations
  bbox?: AnnotationBbox; // normalized position within that page; only set with pageNumber
}

export interface LitReadingStatus {
  userId: string;
  itemId: string;
  status: ReadStatus;
  updatedAt: string;
}

export type AssignmentReadingStatus = "not_started" | "in_progress" | "done";

export interface LitAssignedReading {
  id: string;
  itemId: string;
  projectId: string;
  assignedBy: string;    // PI user ID
  assigneeId: string;
  dueDate?: string;      // ISO date
  note?: string;
  readingStatus: AssignmentReadingStatus | null; // null = masked server-side (peer view of hidden row)
  createdAt: string;
  statusHidden?: boolean; // when true, peers see "-" instead of status; PI always sees real status
  aggDone?: number;       // server-computed total done count (includes hidden entries)
  aggTotal?: number;      // server-computed total assignee count
}

export interface ZoteroCredentials {
  userId: string;
  apiKey: string;
  zoteroUserId: string;
  groupId?: string;      // Zotero group library ID
  lastSyncedAt?: string;
}

export interface LitRecommendation {
  id: string;
  sourceItemId: string;
  projectId: string;
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  doi?: string;
  abstract?: string;
  openAlexId?: string;
  score?: number;        // relevance score from API
  cachedAt: string;
  dismissed: boolean;
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

// ── Scheduling ────────────────────────────────────────────────────────────────

// Per-day working hours; key = "0" (Mon) … "6" (Sun), null = day off
export type DayWorkingHours = { start: string; end: string } | null;
export type WorkingHours = Record<string, DayWorkingHours>;

export interface UserSettings {
  userId: string;
  timezone: string;         // IANA timezone string, e.g. "America/New_York"
  workingHours: WorkingHours;
  updatedAt: string;
}

// "day-slot" key where day=0..4 (Mon-Fri), slot=0..15 (9:00-16:30 in 30-min steps)
export interface WeeklyAvailability {
  userId: string;
  projectId: string;
  subProjectId?: string | null;
  slots: string[];
  updatedAt: string;
}

export type MeetingResponseStatus = "pending" | "accepted" | "declined";

export interface MeetingResponse {
  userId: string;
  status: MeetingResponseStatus;
  respondedAt?: string;
}

export interface MeetingProposal {
  id: string;
  projectId: string;
  proposerId: string;
  title: string;
  description?: string;
  proposedDate: string;    // ISO date "YYYY-MM-DD"
  proposedTime: string;    // "HH:MM"
  durationMinutes: number;
  inviteeIds: string[];
  responses: MeetingResponse[];
  createdAt: string;
}

export type ScheduleEventScope = "lab" | "personal" | "project";

export interface ScheduleEvent {
  id: string;
  projectId: string;
  title: string;
  date: string;            // ISO date "YYYY-MM-DD"
  time?: string;           // "HH:MM"
  endTime?: string;        // "HH:MM"
  scope: ScheduleEventScope;
  createdBy: string;
  description?: string;
  subProjectId?: string | null;
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
