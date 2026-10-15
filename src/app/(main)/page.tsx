"use client";

import { useState, useCallback, useEffect } from "react";
import { Plus } from "lucide-react";
import {
  TASKS, DASHBOARD_POSTS, SCHEDULE_EVENTS,
  getUser, CURRENT_USER_ID, getStoredProject,
} from "@/lib/mock-data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Task, CalendarEvent, DashboardPost, TaskStatus, User } from "@/types";
import { useProject } from "@/context/ProjectContext";
import TaskDetailPanel from "@/components/tasks/TaskDetailPanel";
import TaskModal from "@/components/tasks/TaskModal";
import Toast from "@/components/ui/Toast";
import type { OverdueReminder } from "./_components/NeedsAttentionWidget";
import { TodayWidget } from "./_components/TodayWidget";
import { LabPulseWidget } from "./_components/LabPulseWidget";

// ── Add Reminder modal ────────────────────────────────────────────────────────

const MR = {
  card:        "var(--color-surface)",
  border:      "var(--color-border)",
  textPrimary: "var(--color-body)",
  textMuted:   "var(--color-secondary)",
  accent:      "#0A84FF",
};

function AddReminderModal({
  onClose, projectId, userId, teamMembers,
}: {
  onClose: () => void;
  projectId: string;
  userId: string;
  teamMembers: User[];
}) {
  const [title, setTitle] = useState("");
  const [date, setDate]   = useState("");
  const [time, setTime]   = useState("");
  const [assigneeId, setAssigneeId] = useState(userId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    const dueAt = date ? `${date}T${time || "09:00"}:00` : null;
    if (isSupabaseConfigured && projectId && userId) {
      await supabase.from("reminders").insert({
        user_id: userId,
        project_id: projectId,
        title: title.trim(),
        due_at: dueAt,
        assignee_id: assigneeId !== userId ? assigneeId : null,
        email_enabled: false,
        sent: false,
        completed: false,
        scope: "lab",
      });
    }
    setSaving(false);
    onClose();
  }

  const inputStyle: React.CSSProperties = {
    display: "block", width: "100%", boxSizing: "border-box", height: 40,
    border: `1px solid ${MR.border}`, borderRadius: 8, padding: "0 12px",
    fontSize: 14, color: MR.textPrimary, backgroundColor: "var(--color-surface-2)",
    fontFamily: "var(--font-roboto)", outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, fontWeight: 600, color: MR.textMuted, marginBottom: 6,
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 50, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: MR.card, border: `1px solid ${MR.border}`, borderRadius: 12, padding: "28px 28px 24px", width: "100%", maxWidth: 420, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 18, color: MR.textPrimary, margin: "0 0 20px" }}>
          Add Reminder
        </h2>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Title</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) handleSave(); }}
            placeholder="Reminder title"
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: teamMembers.length > 1 ? 14 : 20 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Date (optional)</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, fontSize: 13 }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Time (optional)</label>
            <input
              type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date}
              style={{ ...inputStyle, fontSize: 13, color: date ? MR.textPrimary : MR.textMuted, opacity: date ? 1 : 0.5 }}
            />
          </div>
        </div>

        {teamMembers.length > 1 && (
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Assignee</label>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} style={{ ...inputStyle, fontSize: 13 }}>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.id === userId ? " (you)" : ""}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ height: 36, padding: "0 14px", fontSize: 13, color: MR.textMuted, background: "none", border: `1px solid ${MR.border}`, borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-roboto)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || saving}
            style={{ height: 36, padding: "0 16px", fontSize: 13, fontWeight: 600, color: "#fff", backgroundColor: title.trim() && !saving ? MR.accent : "rgba(84,84,88,0.5)", border: "none", borderRadius: 8, cursor: title.trim() && !saving ? "pointer" : "default", fontFamily: "var(--font-roboto)" }}
          >
            {saving ? "Saving…" : "Add Reminder"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { activeScope, subProjectId, subProjects, projectId: activeProjectId } = useProject();
  const [tasks, setTasks]             = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [modalStatus, setModalStatus] = useState<TaskStatus | null>(null);
  const [projectName, setProjectName]           = useState("");
  const [projectId, setProjectId]               = useState("");
  const [userId, setUserId]                     = useState("");
  const [currentUserFirstName, setCurrentUserFirstName] = useState("");
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [dashEvents, setDashEvents]   = useState<CalendarEvent[]>([]);
  const [dashPosts, setDashPosts]     = useState<DashboardPost[]>([]);
  const [overdueReminders, setOverdueReminders] = useState<OverdueReminder[]>([]);
  const [loading, setLoading]         = useState(isSupabaseConfigured);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [reminderModalOpen, setReminderModalOpen] = useState(false);

  useEffect(() => {
    if (isSupabaseConfigured) {
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        const user = session?.user ?? null;
        if (!user) { setLoading(false); return; }
        setUserId(user.id);

        const { data: up } = await supabase
          .from("user_profiles")
          .select("project_id, name, projects(name)")
          .eq("id", user.id)
          .maybeSingle();

        if (!up?.project_id) { setLoading(false); return; }
        const pid = up.project_id as string;
        setProjectId(pid);

        if (up.name) setCurrentUserFirstName((up.name as string).trim().split(/\s+/)[0]);

        const proj = Array.isArray(up.projects) ? up.projects[0] : up.projects;
        if (proj) setProjectName((proj as Record<string, string>).name ?? "");

        // Fetch team members for avatar display
        const { data: members } = await supabase
          .from("team_members")
          .select("*, user_profiles(name, avatar_color, avatar_initials, avatar_url, role)")
          .eq("project_id", pid);

        if (members) {
          setTeamMembers(members.map((row) => {
            const p = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
            const profile = p as Record<string, string> | null;
            return {
              id: row.user_id as string,
              name: profile?.name ?? "Team Member",
              email: "",
              role: (row.role ?? "researcher") as User["role"],
              avatarColor: profile?.avatar_color ?? "#B4D4E3",
              avatarInitials: profile?.avatar_initials ?? "??",
              avatarUrl: profile?.avatar_url ?? undefined,
            } as User;
          }));
        }

        // Fetch tasks (exclude archived)
        const { data: taskData, error: taskError } = await supabase
          .from("tasks")
          .select("*, task_assignees(user_id)")
          .eq("project_id", pid)
          .is("parent_id", null)
          .or("archived.is.null,archived.eq.false")
          .order("created_at", { ascending: false });
        if (taskError) console.error("[Dashboard] tasks error:", taskError);
        if (!taskError && taskData) {
          setTasks(taskData.map((row) => ({
            id: row.id as string,
            projectId: row.project_id as string,
            title: row.title as string,
            description: (row.description as string) ?? "",
            status: row.status as TaskStatus,
            priority: row.priority as Task["priority"],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assigneeIds: ((row.task_assignees as any[]) ?? []).map((ta) => ta.user_id as string),
            dueDate: row.due_date as string | undefined,
            createdAt: row.created_at as string,
            updatedAt: row.updated_at as string,
            comments: (row.comments as Task["comments"]) ?? [],
            files: (row.files as Task["files"]) ?? [],
            links: (row.links as Task["links"]) ?? [],
            scope: (row.scope as Task["scope"]) ?? undefined,
            subProjectId: (row.sub_project_id as string | null) ?? undefined,
          })));
        }

        // Fetch events — only upcoming (from today through next 30 days)
        const todayStr = new Date().toISOString().split("T")[0];
        const thirtyDaysOut = new Date(); thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
        const { data: evData, error: evError } = await supabase
          .from("events")
          .select("*")
          .eq("project_id", pid)
          .gte("date", todayStr)
          .lte("date", thirtyDaysOut.toISOString().split("T")[0])
          .order("date", { ascending: true });
        if (evError) console.error("[Dashboard] events error:", evError);
        if (!evError && evData) {
          setDashEvents(evData.map((row) => ({
            id: row.id as string,
            title: row.title as string,
            date: row.date as string,
            time: (row.time as string) ?? undefined,
            projectId: row.project_id as string,
          })));
        }

        // Fetch lab wins
        const { data: winsData, error: winsError } = await supabase
          .from("lab_wins")
          .select("*")
          .eq("project_id", pid)
          .order("created_at", { ascending: false });
        if (winsError) console.error("[Dashboard] lab_wins error:", winsError);
        if (!winsError && winsData) {
          setDashPosts((prev) => [
            ...prev.filter((p) => p.type !== "lab_win"),
            ...winsData.map((row) => ({
              id: row.id as string,
              authorId: row.author_id as string,
              content: row.content as string,
              createdAt: row.created_at as string,
              type: "lab_win" as const,
            })),
          ]);
        }

        // Fetch opportunities
        const { data: oppsData, error: oppsError } = await supabase
          .from("opportunities")
          .select("*")
          .eq("project_id", pid)
          .order("created_at", { ascending: false });
        if (oppsError) console.error("[Dashboard] opportunities error:", oppsError);
        if (!oppsError && oppsData) {
          setDashPosts((prev) => [
            ...prev.filter((p) => p.type !== "opportunity"),
            ...oppsData.map((row) => ({
              id: row.id as string,
              authorId: row.author_id as string,
              content: row.content as string,
              createdAt: row.created_at as string,
              type: "opportunity" as const,
            })),
          ]);
        }

        setLoading(false);
      });
      return;
    }

    // Demo mode fallback (no Supabase)
    const sp = getStoredProject();
    setProjectName(sp.name);
    const mockUser = getUser(CURRENT_USER_ID);
    if (mockUser?.name) setCurrentUserFirstName(mockUser.name.trim().split(/\s+/)[0]);
    if (!localStorage.getItem("canopy_project")) {
      setTasks(TASKS);
      setDashPosts(DASHBOARD_POSTS);
      // Seed demo events relative to today so they always appear in the widget
      const d0 = new Date(); d0.setHours(0, 0, 0, 0);
      const isoDate = (offset: number) => { const d = new Date(d0); d.setDate(d.getDate() + offset); return d.toISOString().split("T")[0]; };
      setDashEvents([
        { id: "ev-demo-1", title: "Lab Meeting", date: isoDate(0), time: "10:00", projectId: "demo" },
        { id: "ev-demo-2", title: "Participant Interview", date: isoDate(1), time: "14:00", projectId: "demo" },
        { id: "ev-demo-3", title: "IRB Submission Deadline", date: isoDate(3), projectId: "demo" },
        { id: "ev-demo-4", title: "Data Analysis Workshop", date: isoDate(6), time: "09:00", projectId: "demo" },
      ]);
    }
  }, []);

  // Reminders fetch: overdue + upcoming 7 days, re-runs on project switch
  useEffect(() => {
    if (!isSupabaseConfigured || !activeProjectId || !userId) return;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const uid = session?.user?.id;
      if (!uid) return;
      const remProjectFilter = `,and(scope.eq.lab,project_id.eq.${activeProjectId})`;
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      const { data: remData } = await supabase
        .from("reminders")
        .select("id, title, due_at, scope, assignee_id")
        .or(`user_id.eq.${uid},assignee_id.eq.${uid}${remProjectFilter}`)
        .eq("completed", false)
        .not("due_at", "is", null)
        .lt("due_at", nextWeek.toISOString());
      if (remData) {
        setOverdueReminders(remData.map((r) => ({
          id: r.id as string,
          title: r.title as string,
          dueAt: r.due_at as string,
          scope: (r.scope as "personal" | "lab") ?? "personal",
          assigneeId: (r.assignee_id as string) ?? undefined,
        })));
      }
    });
  }, [activeProjectId, userId]);

  const todayStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const timeOfDay = (() => { const h = new Date().getHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; })();

  const isLabHome = activeScope === "lab";
  const isPersonal = activeScope === "personal";
  const activeSubProject = !isLabHome && activeScope === "project"
    ? (subProjects.find((sp) => sp.id === subProjectId) ?? null)
    : null;
  const displayTitle = activeSubProject?.name ?? projectName;

  const moveTask = useCallback((taskId: string, status: TaskStatus) => {
    // Capture the task before the optimistic update so we have the original status
    // for the activity log and for rollback if the DB write fails.
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId);
      if (!task || task.status === status) return prev;

      const prevStatus = task.status;
      const taskTitle = task.title;
      const taskSubProjectId = task.subProjectId ?? null;

      // Write to DB first; only log activity after the update is confirmed.
      supabase.from("tasks").update({ status }).eq("id", taskId).then(({ error }) => {
        if (error) {
          console.error("[Dashboard] moveTask error:", error);
          // Roll back the optimistic update
          setTasks((p) => p.map((t) => t.id === taskId ? { ...t, status: prevStatus } : t));
          return;
        }
        if (projectId && userId) {
          supabase.from("activity_feed").insert({
            project_id: projectId,
            user_id: userId,
            action_type: "moved",
            item_name: taskTitle,
            item_type: "task",
            from_status: prevStatus,
            to_status: status,
            sub_project_id: taskSubProjectId,
          }).then(({ error: e }) => { if (e) console.error("[Dashboard] activity insert error:", e); });
        }
      });

      return prev.map((t) => (t.id === taskId ? { ...t, status } : t));
    });
    setSelectedTask((prev) => (prev?.id === taskId ? { ...prev, status } : prev));
  }, [projectId, userId]);

  const addTask = useCallback((task: Task) => {
    setTasks((prev) => [task, ...prev]);
    setModalStatus(null);
  }, []);

  const textMuted = "var(--color-secondary)";

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, minHeight: "100%" }}>
      {/* Greeting + action row */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 22, margin: 0, lineHeight: 1.2, color: "var(--color-navy)" }}>
              {isLabHome || isPersonal ? (
                <>
                  Good {timeOfDay},{" "}
                  {currentUserFirstName
                    ? <span style={{ color: "var(--color-navy)" }}>{currentUserFirstName}</span>
                    : null
                  }
                </>
              ) : displayTitle}
            </h1>
            <p style={{ fontSize: 13, color: textMuted, marginTop: 4, marginBottom: 0 }}>
              {todayStr}
            </p>
          </div>
          <div style={{ position: "relative", flexShrink: 0, marginTop: 2 }}>
            <button
              onClick={() => setNewMenuOpen((o) => !o)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                height: 36, padding: "0 14px",
                backgroundColor: "var(--color-btn-primary)", color: "#fff",
                border: "none", borderRadius: 8,
                fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13,
                cursor: "pointer",
                transition: "opacity 0.15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
            >
              <Plus size={14} />
              New
            </button>
            {newMenuOpen && (
              <>
                <div
                  style={{ position: "fixed", inset: 0, zIndex: 999 }}
                  onClick={() => setNewMenuOpen(false)}
                />
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0,
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 10, padding: "4px 0",
                  zIndex: 1000, minWidth: 150,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
                }}>
                  {[
                    { label: "Task", action: () => { setNewMenuOpen(false); setModalStatus("todo"); } },
                    { label: "Reminder", action: () => { setNewMenuOpen(false); setReminderModalOpen(true); } },
                  ].map(({ label, action }) => (
                    <button
                      key={label}
                      onClick={action}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        padding: "9px 14px", fontSize: 13,
                        color: "var(--color-body)", background: "none", border: "none",
                        cursor: "pointer", fontFamily: "var(--font-roboto)",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-navy-dim)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Row 1: Agenda (Overdue / Today / Upcoming) */}
        <TodayWidget
          tasks={tasks}
          reminders={overdueReminders}
          events={dashEvents}
          teamMembers={teamMembers}
          userId={userId}
          loading={loading}
        />

        {/* Row 2: Opportunities + Wins */}
        <LabPulseWidget
          posts={dashPosts}
          projectId={projectId}
          projectName={projectName}
          userId={userId}
          teamMembers={teamMembers}
          loading={loading}
        />
      </div>

      {/* Task detail panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdateStatus={(status) => moveTask(selectedTask.id, status)}
          teamMembers={teamMembers}
        />
      )}

      {/* Task add modal (from column + buttons) - scoped to the active project when one is selected */}
      {modalStatus && (
        <TaskModal
          mode="add"
          initialStatus={modalStatus}
          onSave={addTask}
          onClose={() => setModalStatus(null)}
          teamMembers={teamMembers}
          currentUserId={userId}
          projectId={projectId}
          scope={activeSubProject ? "project" : "lab"}
          subProjectId={activeSubProject?.id ?? null}
          subProjects={subProjects}
        />
      )}

      {reminderModalOpen && (
        <AddReminderModal
          onClose={() => setReminderModalOpen(false)}
          projectId={projectId}
          userId={userId}
          teamMembers={teamMembers}
        />
      )}

      <Toast />
    </div>
  );
}
