"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreHorizontal, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { formatDate } from "@/lib/mock-data";
import type { Task, TaskStatus, User } from "@/types";
import {
  PriorityBadge, AssigneeStack, STATUS_CONFIG, STATUS_ORDER,
} from "@/components/tasks/TaskDetailPanel";

function isOverdue(dueDate?: string, status?: TaskStatus): boolean {
  if (!dueDate || status === "done") return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(dueDate + "T00:00:00") < today;
}

export function TaskCard({
  task,
  onClick,
  onMoveStatus,
  onEdit,
  onDelete,
  isDragging = false,
  rowMode = false,
  teamMembers = [],
  subtaskProgress,
  subtasks,
  onToggleSubtask,
  showLabBadge = false,
}: {
  task: Task;
  onClick: () => void;
  onMoveStatus: (status: TaskStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  isDragging?: boolean;
  rowMode?: boolean;
  teamMembers?: User[];
  subtaskProgress?: { total: number; done: number };
  subtasks?: Task[];
  onToggleSubtask?: (subtaskId: string, done: boolean) => void;
  showLabBadge?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [subtaskExpanded, setSubtaskExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        menuBtnRef.current && !menuBtnRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
        setDeleteConfirm(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [menuOpen]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const overdue = isOverdue(task.dueDate, task.status);
  const otherStatuses = STATUS_ORDER.filter((s) => s !== task.status);
  const hasSubtasks = subtaskProgress && subtaskProgress.total > 0;

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, overflow: "hidden", borderRadius: rowMode ? 0 : 8, cursor: isDragging ? "grabbing" : "grab" }}
      {...attributes}
      {...listeners}
      className="group relative"
      onClick={onClick}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={rowMode ? {
          backgroundColor: hovered && !isDragging ? "rgba(27,46,75,0.025)" : "transparent",
          borderBottom: "1px solid var(--color-border)",
          padding: "10px 14px",
          transition: "background-color 0.12s",
        } : {
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          padding: "10px 12px",
          overflow: "hidden",
          transition: "border-color 0.15s, box-shadow 0.15s",
          boxShadow: hovered && !isDragging
            ? "0 4px 12px rgba(27,46,75,0.10), 0 1px 4px rgba(27,46,75,0.06)"
            : "0 1px 2px rgba(27,46,75,0.04)",
          borderColor: hovered && !isDragging ? "rgba(27,46,75,0.20)" : undefined,
        }}
      >
        {/* Title */}
        <p style={{
          fontSize: 13, fontWeight: 500, color: "var(--color-body)",
          lineHeight: 1.35, marginBottom: 8,
          textDecoration: task.status === "done" ? "line-through" : undefined,
          opacity: task.status === "done" ? 0.65 : 1,
        }}>
          {task.title}
        </p>

        {/* Bottom row: date + badges/avatars */}
        <div className="flex items-center justify-between gap-2">
          <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flexShrink: 0 }}>
            {overdue && <Clock size={11} color="var(--color-secondary)" aria-label="Overdue" />}
            <span style={{
              fontSize: 12,
              color: "var(--color-secondary)",
              fontWeight: overdue ? 600 : 400,
              flexShrink: 0,
            }}>
              {task.dueDate ? formatDate(task.dueDate) : "-"}
            </span>
          </div>
          <div className="flex items-center gap-1.5" style={{ overflow: "hidden" }}>
            {showLabBadge && task.scope === "lab" && (
              <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: "rgba(27,46,75,0.08)", color: "var(--color-navy)", padding: "1px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
                Lab
              </span>
            )}
            <PriorityBadge priority={task.priority} />
            <AssigneeStack ids={task.assigneeIds} size={20} users={teamMembers} />
          </div>
        </div>

        {/* Subtask section */}
        {hasSubtasks && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(27,46,75,0.07)" }}>
            {/* Header row: chevron + label + count */}
            <button
              onClick={(e) => { e.stopPropagation(); setSubtaskExpanded((x) => !x); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 4,
                marginBottom: 4, background: "none", border: "none",
                cursor: "pointer", padding: 0,
              }}
            >
              {subtaskExpanded
                ? <ChevronDown size={11} color="var(--color-secondary)" />
                : <ChevronRight size={11} color="var(--color-secondary)" />}
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--color-secondary)", letterSpacing: "0.04em", textTransform: "uppercase", flex: 1, textAlign: "left" }}>
                Subtasks
              </span>
              <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>
                {subtaskProgress!.done}/{subtaskProgress!.total}
              </span>
            </button>

            {/* Progress bar */}
            <div style={{ height: 3, backgroundColor: "rgba(27,46,75,0.08)", borderRadius: 2 }}>
              <div style={{
                height: "100%",
                width: `${(subtaskProgress!.done / subtaskProgress!.total) * 100}%`,
                backgroundColor: subtaskProgress!.done === subtaskProgress!.total
                  ? "var(--status-done-dot)"
                  : "var(--color-navy)",
                borderRadius: 2, transition: "width 0.3s ease",
              }} />
            </div>

            {/* Inline checklist */}
            {subtaskExpanded && subtasks && subtasks.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 1 }}>
                {subtasks.map((sub) => (
                  <div
                    key={sub.id}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={sub.status === "done"}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleSubtask?.(sub.id, e.target.checked);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ accentColor: "var(--color-navy)", cursor: "pointer", flexShrink: 0, width: 13, height: 13 }}
                    />
                    <span style={{
                      fontSize: 12,
                      color: sub.status === "done" ? "var(--color-secondary)" : "var(--color-body)",
                      textDecoration: sub.status === "done" ? "line-through" : "none",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      flex: 1,
                    }}>
                      {sub.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ⋯ menu button */}
      <button
        ref={menuBtnRef}
        onClick={(e) => {
          e.stopPropagation();
          const rect = menuBtnRef.current?.getBoundingClientRect() ?? null;
          setMenuAnchor(rect);
          setMenuOpen((o) => !o);
          setDeleteConfirm(false);
        }}
        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 flex items-center justify-center rounded"
        style={{ backgroundColor: "rgba(255,255,255,0.9)", cursor: "pointer" }}
        aria-label="Task options"
      >
        <MoreHorizontal size={14} color="var(--color-secondary)" />
      </button>

      {menuOpen && menuAnchor && createPortal(
        <div
          ref={menuRef}
          className="animate-fade-in"
          style={{
            position: "fixed",
            top: menuAnchor.bottom + 4,
            right: Math.max(8, window.innerWidth - menuAnchor.right),
            zIndex: 9999,
            width: deleteConfirm ? 200 : 180,
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(27,46,75,0.12)",
            ...(deleteConfirm ? { padding: "12px 12px 10px" } : {}),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {!deleteConfirm ? (
            <>
              <div style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: 4, paddingTop: 4 }}>
                {otherStatuses.map((s) => (
                  <button
                    key={s}
                    onClick={() => { onMoveStatus(s); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-2 hover:bg-[rgba(27,46,75,0.06)] transition-colors"
                    style={{ fontSize: 12, color: "var(--color-body)", minHeight: 36, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: STATUS_CONFIG[s].dot, flexShrink: 0 }} />
                    Move to {STATUS_CONFIG[s].label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setMenuOpen(false); onEdit(); }}
                className="w-full text-left px-3 py-2 hover:bg-[rgba(27,46,75,0.06)] transition-colors"
                style={{ fontSize: 12, color: "var(--color-body)", minHeight: 36, border: "none", background: "none", cursor: "pointer", display: "block", width: "100%", textAlign: "left" }}
              >
                Edit task
              </button>
              <button
                onClick={() => setDeleteConfirm(true)}
                className="w-full text-left px-3 py-2 hover:bg-[rgba(27,46,75,0.06)] transition-colors"
                style={{ fontSize: 12, color: "var(--color-error)", minHeight: 36, border: "none", background: "none", cursor: "pointer", display: "block", width: "100%", textAlign: "left" }}
              >
                Delete task
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12, color: "var(--color-body)", marginBottom: 10 }}>Delete this task?</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => { setDeleteConfirm(false); setMenuOpen(false); }}
                  style={{ flex: 1, fontSize: 12, padding: "5px 0", border: "1px solid var(--color-border)", borderRadius: 5, backgroundColor: "transparent", cursor: "pointer", color: "var(--color-body)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { onDelete(); setDeleteConfirm(false); setMenuOpen(false); }}
                  style={{ flex: 1, fontSize: 12, padding: "5px 0", border: "none", borderRadius: 5, backgroundColor: "var(--color-error)", color: "#fff", cursor: "pointer", fontWeight: 700 }}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
