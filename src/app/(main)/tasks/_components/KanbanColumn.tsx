"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useState } from "react";
import { Plus } from "lucide-react";
import type { Task, TaskStatus, User } from "@/types";
import { STATUS_CONFIG } from "@/components/tasks/TaskDetailPanel";
import EmptyState from "@/components/ui/EmptyState";
import { TaskCard } from "./TaskCard";

export function KanbanColumn({
  status,
  tasks,
  onTaskClick,
  onMoveTask,
  onEditTask,
  onDeleteTask,
  onAddTask,
  onQuickAdd,
  onArchiveDone,
  teamMembers = [],
  subtaskCounts = {},
  subtaskData = {},
  onToggleSubtask,
  showLabBadge = false,
}: {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onMoveTask: (taskId: string, status: TaskStatus) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string, confirmed?: boolean) => void;
  onAddTask: (status: TaskStatus) => void;
  /** Save a task from just its title; resolves false if it didn't save (the text stays). */
  onQuickAdd?: (title: string, status: TaskStatus) => Promise<boolean>;
  onArchiveDone?: () => void;
  teamMembers?: User[];
  subtaskCounts?: Record<string, { total: number; done: number }>;
  subtaskData?: Record<string, Task[]>;
  onToggleSubtask?: (taskId: string, subtaskId: string, done: boolean) => void;
  showLabBadge?: boolean;
}) {
  const cfg = STATUS_CONFIG[status];
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex flex-col" style={{
      minWidth: 0, flex: 1,
      backgroundColor: "var(--color-surface)",
      border: isOver ? "2px dashed var(--color-navy)" : "1px solid var(--color-border)",
      borderRadius: 10,
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)",
      transition: "border-color 0.15s",
    }}>
      {/* Column header */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "11px 14px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--color-secondary)", flex: 1 }}>
          {cfg.label}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-secondary)" }}>
          {tasks.length}
        </span>
        {status === "done" && tasks.length >= 3 && onArchiveDone && (
          <button
            onClick={onArchiveDone}
            title="Archive all done tasks"
            style={{ fontSize: 10, fontWeight: 600, color: "var(--color-secondary)", background: "none", border: "1px solid var(--color-border)", borderRadius: 4, padding: "2px 6px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Archive all
          </button>
        )}
      </div>

      {/* Droppable task area */}
      <div ref={setDropRef} style={{ flex: 1, minHeight: 60 }}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col">
            {tasks.length === 0 && (
              <div style={{ padding: "10px 14px 6px" }}>
                <EmptyState
                  variant={status === "done" ? "done" : "column"}
                  title={status === "done" ? "No completed tasks" : "No tasks yet"}
                  compact
                />
              </div>
            )}
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => onTaskClick(task)}
                onMoveStatus={(s) => onMoveTask(task.id, s)}
                onEdit={() => onEditTask(task)}
                onDelete={() => onDeleteTask(task.id, true)}
                rowMode
                teamMembers={teamMembers}
                subtaskProgress={subtaskCounts[task.id]}
                subtasks={subtaskData[task.id]}
                onToggleSubtask={onToggleSubtask ? (subId, done) => onToggleSubtask(task.id, subId, done) : undefined}
                showLabBadge={showLabBadge}
              />
            ))}
          </div>
        </SortableContext>
      </div>

      {/* Add task footer: type a title and press Enter; the full form is one click away */}
      {onQuickAdd ? <QuickAdd status={status} onQuickAdd={onQuickAdd} onMore={() => onAddTask(status)} /> : (
      <button
        onClick={() => onAddTask(status)}
        className="flex items-center gap-1.5 w-full transition-colors"
        style={{
          fontSize: 12, color: "var(--color-secondary)", padding: "8px 14px",
          borderLeft: "none", borderRight: "none", borderBottom: "none",
          borderTop: "1px solid var(--color-border)", background: "none",
          cursor: "pointer", fontFamily: "var(--font-roboto)", textAlign: "left",
        }}
      >
        <Plus size={13} /> Add task
      </button>
      )}
    </div>
  );
}

function QuickAdd({ status, onQuickAdd, onMore }: {
  status: TaskStatus; onQuickAdd: (title: string, status: TaskStatus) => Promise<boolean>; onMore: () => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    if (await onQuickAdd(t, status)) setTitle("");
    setBusy(false);
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderTop: "1px solid var(--color-border)" }}>
      <Plus size={13} color="var(--color-secondary)" aria-hidden="true" style={{ flexShrink: 0 }} />
      <input
        value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } if (e.key === "Escape") setTitle(""); }}
        placeholder="Add a task…" aria-label={`Add a task to ${STATUS_CONFIG[status].label}`} maxLength={300}
        style={{ flex: 1, minWidth: 0, height: 28, border: "none", outline: "none", background: "transparent", fontSize: 12, color: "var(--color-body)", fontFamily: "var(--font-roboto)" }}
      />
      <button type="button" onClick={onMore} title="Add with details (assignees, due date, priority…)"
        style={{ fontSize: 11, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", padding: "2px 4px" }}>
        Details
      </button>
    </div>
  );
}
