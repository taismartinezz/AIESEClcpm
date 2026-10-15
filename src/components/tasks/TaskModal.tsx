"use client";

import { useState, useRef } from "react";
import { X, CalendarDays } from "lucide-react";
import type { Task, TaskStatus, TaskPriority, User, SubProject } from "@/types";
import Avatar from "@/components/ui/Avatar";
import { STATUS_CONFIG, STATUS_ORDER } from "@/components/tasks/TaskDetailPanel";
import { CalendarPicker, formatDateLabel } from "@/components/ui/DateTimePicker";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { showToast } from "@/components/ui/Toast";
import { CURRENT_USER_ID } from "@/lib/mock-data";

// ── Shared input style ────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  border: "1px solid var(--color-border)",
  borderRadius: 7,
  padding: "0 10px",
  fontSize: 13,
  fontFamily: "var(--font-roboto)",
  backgroundColor: "var(--color-canvas)",
  color: "var(--color-body)",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--color-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 6,
  display: "block",
};

// ── TaskModal ─────────────────────────────────────────────────────────────────

export interface TaskModalProps {
  mode: "add" | "edit";
  initialStatus?: TaskStatus;
  task?: Task;
  onSave: (task: Task) => void;
  onClose: () => void;
  teamMembers?: User[];
  currentUserId?: string;
  projectId?: string;
  scope?: string;
  subProjectId?: string | null;
  subProjects?: SubProject[];
}

export default function TaskModal({
  mode,
  initialStatus = "todo",
  task,
  onSave,
  onClose,
  teamMembers = [],
  currentUserId = "",
  projectId = "",
  scope = "lab",
  subProjectId = null,
  subProjects = [],
}: TaskModalProps) {
  const [title, setTitle]             = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority]       = useState<TaskPriority>(task?.priority ?? "medium");
  const [dueDate, setDueDate]         = useState(task?.dueDate ?? "");
  const [status, setStatus]           = useState<TaskStatus>(task?.status ?? initialStatus);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assigneeIds ?? (currentUserId ? [currentUserId] : [])
  );
  // Project selector: encoded as "lab" | "personal" | "<subProjectId>"
  const defaultScopeKey = scope === "project" && subProjectId ? subProjectId : scope;
  const [scopeKey, setScopeKey] = useState<string>(defaultScopeKey);
  const [error, setError]   = useState("");
  const [saving, setSaving] = useState(false);
  const [showCal, setShowCal] = useState(false);
  const [calPos, setCalPos]   = useState<{ top: number; left: number } | null>(null);
  const dueDateBtnRef = useRef<HTMLButtonElement>(null);

  function toggleAssignee(id: string) {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    if (!title.trim()) { setError("Title is required."); return; }
    setError("");
    setSaving(true);

    const now = new Date().toISOString();

    // Demo mode - skip Supabase entirely and create a local task
    if (!isSupabaseConfigured) {
      const localId = crypto.randomUUID();
      const saved: Task = {
        id: localId,
        projectId: projectId || "p1",
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        assigneeIds,
        dueDate: dueDate || undefined,
        createdAt: now,
        updatedAt: now,
        comments: [],
        files: [],
        links: [],
      };
      onSave(saved);
      setSaving(false);
      return;
    }

    // Always resolve userId from session - prop may be empty if parent hasn't loaded yet
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? currentUserId ?? CURRENT_USER_ID;

    if (mode === "add") {
      const resolvedScope = scopeKey === "lab" || scopeKey === "personal" ? scopeKey : "project";
      const resolvedSubProjectId = resolvedScope === "project" ? scopeKey : null;
      const payload = {
        project_id: projectId,
        created_by: userId,
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        due_date: dueDate || null,
        archived: false,
        scope: resolvedScope,
        sub_project_id: resolvedSubProjectId,
      };
      const { data, error: insertError } = await supabase
        .from("tasks")
        .insert(payload)
        .select()
        .single();

      if (insertError) {
        console.error("[TaskModal] insert error:", insertError);
        setError("Failed to save task. Please try again.");
        showToast("Failed to save task. Please try again.", "error");
        setSaving(false);
        return;
      }

      // Insert assignees into task_assignees
      if (assigneeIds.length > 0) {
        const { error: assignError } = await supabase
          .from("task_assignees")
          .insert(assigneeIds.map((aid) => ({ task_id: data.id, user_id: aid })));
        if (assignError) console.error("[TaskModal] task_assignees insert error:", assignError);
      }

      const saved: Task = {
        id: data.id as string,
        projectId: data.project_id as string,
        title: data.title as string,
        description: (data.description as string) ?? undefined,
        status: data.status as TaskStatus,
        priority: data.priority as TaskPriority,
        assigneeIds,
        dueDate: (data.due_date as string) ?? undefined,
        createdAt: data.created_at as string,
        updatedAt: data.updated_at as string,
        comments: [],
        files: [],
        links: [],
        scope: resolvedScope as Task["scope"],
        subProjectId: resolvedSubProjectId ?? undefined,
      };

      // Notify assignees - use session userId so the filter is never undefined
      const toNotify = assigneeIds.filter((id) => id !== userId);
      if (toNotify.length > 0) {
        const notifs = toNotify.map((aid) => ({
          user_id: aid,
          type: "task_assigned",
          title: `You were assigned to "${title.trim()}"`,
          body: null,
          related_id: saved.id,
          read: false,
        }));
        const { error: notifError } = await supabase.from("notifications").insert(notifs);
        if (notifError) console.error("[TaskModal] notification insert error:", notifError);

        // Send task assignment emails (fire-and-forget)
        if (session?.access_token) {
          toNotify.forEach((aid) => {
            fetch("/api/email/send", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ type: "task_assigned", taskId: saved.id, recipientId: aid }),
            }).catch(() => {});
          });
        }
      }

      // Log activity - task created
      supabase.from("activity_feed").insert({
        project_id: projectId,
        user_id: userId,
        action_type: "created",
        item_name: saved.title,
        item_type: "task",
        sub_project_id: resolvedSubProjectId,
      }).then(({ error }) => { if (error) console.error("[TaskModal] activity insert error:", error); });

      onSave(saved);
    } else if (mode === "edit" && task) {
      const { data, error: updateError } = await supabase
        .from("tasks")
        .update({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          due_date: dueDate || null,
          status,
          updated_at: now,
        })
        .eq("id", task.id)
        .select()
        .single();

      if (updateError) {
        console.error("[TaskModal] update error:", updateError);
        setError("Failed to save changes. Please try again.");
        showToast("Failed to save changes. Please try again.", "error");
        setSaving(false);
        return;
      }

      // Replace assignees: delete existing, insert new
      await supabase.from("task_assignees").delete().eq("task_id", task.id);
      if (assigneeIds.length > 0) {
        const { error: assignError } = await supabase
          .from("task_assignees")
          .insert(assigneeIds.map((userId) => ({ task_id: task.id, user_id: userId })));
        if (assignError) console.error("[TaskModal] task_assignees update error:", assignError);
      }

      // Notify newly added assignees (use session userId, never undefined)
      const prevIds = task.assigneeIds ?? [];
      const newlyAdded = assigneeIds.filter((id) => !prevIds.includes(id) && id !== userId);
      if (newlyAdded.length > 0) {
        const notifs = newlyAdded.map((aid) => ({
          user_id: aid,
          type: "task_assigned",
          title: "You were assigned to a task",
          body: `You were assigned to "${title.trim()}"`,
          related_id: task.id,
          read: false,
        }));
        const { error: notifError } = await supabase.from("notifications").insert(notifs);
        if (notifError) console.error("[TaskModal] notification insert error:", notifError);

        // Send task assignment emails (fire-and-forget)
        if (session?.access_token) {
          newlyAdded.forEach((aid) => {
            fetch("/api/email/send", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ type: "task_assigned", taskId: task.id, recipientId: aid }),
            }).catch(() => {});
          });
        }
      }

      const saved: Task = {
        ...task,
        title: data.title as string,
        description: (data.description as string) ?? undefined,
        priority: data.priority as TaskPriority,
        dueDate: (data.due_date as string) ?? undefined,
        status: data.status as TaskStatus,
        assigneeIds,
        updatedAt: data.updated_at as string,
      };

      onSave(saved);
    }

    setSaving(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: "rgba(27,46,75,0.35)" }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "var(--color-surface)",
          maxWidth: 520,
          width: "100%",
          borderRadius: 10,
          padding: 28,
          boxShadow: "0 8px 40px rgba(27,46,75,0.18)",
          maxHeight: "90dvh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2
            style={{
              fontFamily: "var(--font-lora)",
              fontWeight: 600,
              fontSize: 16,
              color: "var(--color-navy)",
              margin: 0,
            }}
          >
            {mode === "add" ? "Add task" : "Edit task"}
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-lg hover:bg-[rgba(27,46,75,0.06)] transition-colors"
            style={{ width: 36, height: 36 }}
            aria-label="Close"
          >
            <X size={16} color="var(--color-secondary)" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label style={labelStyle}>Title *</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => { setTitle(e.target.value); setError(""); }}
              placeholder="Task title"
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            />
            {error && <p style={{ fontSize: 12, color: "var(--color-error)", marginTop: 4 }}>{error}</p>}
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              rows={3}
              style={{
                ...inputStyle,
                height: "auto",
                padding: "8px 10px",
                resize: "vertical",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            />
          </div>

          {/* Priority + Status row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Project - only shown in add mode when sub-projects exist */}
          {mode === "add" && subProjects.length > 0 && (
            <div>
              <label style={labelStyle}>Project</label>
              <select
                value={scopeKey}
                onChange={(e) => setScopeKey(e.target.value)}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                <option value="lab">Lab (all projects)</option>
                {subProjects.map((sp) => (
                  <option key={sp.id} value={sp.id}>{sp.name}</option>
                ))}
                <option value="personal">Personal</option>
              </select>
            </div>
          )}

          {/* Due date */}
          <div style={{ position: "relative" }}>
            <label style={labelStyle}>Due Date</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                ref={dueDateBtnRef}
                type="button"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setCalPos({ top: r.bottom + 6, left: r.left });
                  setShowCal((v) => !v);
                }}
                style={{ display: "flex", alignItems: "center", gap: 6, height: 38, padding: "0 12px", fontSize: 13, fontFamily: "var(--font-roboto)", border: "1px solid var(--color-border)", borderRadius: 7, backgroundColor: "var(--color-canvas)", color: dueDate ? "var(--color-body)" : "var(--color-secondary)", cursor: "pointer", flex: 1, justifyContent: "flex-start" }}
              >
                <CalendarDays size={13} color="var(--color-secondary)" />
                {dueDate ? formatDateLabel(dueDate) : "No due date"}
              </button>
              {dueDate && (
                <button
                  type="button"
                  onClick={() => { setDueDate(""); setShowCal(false); }}
                  style={{ fontSize: 14, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: "0 2px" }}
                  title="Clear due date"
                >×</button>
              )}
            </div>
            {showCal && calPos && (
              <CalendarPicker
                value={dueDate || undefined}
                accentColor="#1B2E4B"
                pos={calPos}
                onSelect={(d) => { setDueDate(d); setShowCal(false); }}
                onClear={() => { setDueDate(""); setShowCal(false); }}
                onClose={() => setShowCal(false)}
              />
            )}
          </div>

          {/* Assignees */}
          <div>
            <label style={labelStyle}>Assignees</label>
            <div className="flex flex-wrap gap-2">
              {teamMembers.map((user) => {
                const selected = assigneeIds.includes(user.id);
                return (
                  <button
                    key={user.id}
                    onClick={() => toggleAssignee(user.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-all"
                    style={{
                      border: `1px solid ${selected ? "var(--color-navy)" : "var(--color-border)"}`,
                      backgroundColor: selected ? "rgba(27,46,75,0.07)" : "transparent",
                      fontSize: 12,
                      color: selected ? "var(--color-navy)" : "var(--color-secondary)",
                      cursor: "pointer",
                      fontFamily: "var(--font-roboto)",
                      minHeight: 36,
                    }}
                  >
                    <Avatar user={user} size={18} />
                    {user.name.split(" ")[0]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--color-body)",
              border: "1px solid var(--color-border)",
              borderRadius: 7,
              padding: "8px 16px",
              backgroundColor: "transparent",
              cursor: "pointer",
              minHeight: 44,
              fontFamily: "var(--font-roboto)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
              backgroundColor: "var(--color-navy)",
              border: "none",
              borderRadius: 7,
              padding: "8px 20px",
              cursor: saving ? "default" : "pointer",
              minHeight: 44,
              fontFamily: "var(--font-roboto)",
              opacity: saving ? 0.7 : 1,
            }}
            onMouseEnter={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy)"; }}
          >
            {saving ? "Saving…" : mode === "add" ? "Add task" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
