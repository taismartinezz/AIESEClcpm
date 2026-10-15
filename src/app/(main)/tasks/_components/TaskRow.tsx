"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Clock, MoreHorizontal } from "lucide-react";
import { formatDate } from "@/lib/mock-data";
import type { Task, TaskStatus, User } from "@/types";
import {
  STATUS_CONFIG, STATUS_ORDER, PriorityBadge, AssigneeStack,
} from "@/components/tasks/TaskDetailPanel";
import Avatar from "@/components/ui/Avatar";
import { CalendarPicker } from "@/components/ui/DateTimePicker";

export function avatarColorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360}, 55%, 80%)`;
}

export function FilterSelect({
  value, onChange, children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex items-center shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none pr-6"
        style={{
          height: 36, paddingLeft: 10, paddingRight: 24,
          border: "1px solid var(--color-border)", borderRadius: 7,
          fontSize: 12, fontFamily: "var(--font-roboto)",
          backgroundColor: value !== "all" ? "rgba(27,46,75,0.06)" : "var(--color-canvas)",
          color: value !== "all" ? "var(--color-navy)" : "var(--color-secondary)",
          fontWeight: value !== "all" ? 600 : 400,
          outline: "none", cursor: "pointer",
        }}
      >
        {children}
      </select>
      <ChevronDown size={12} className="absolute right-2 pointer-events-none" color="var(--color-secondary)" />
    </div>
  );
}

function isOverdue(dueDate?: string, status?: TaskStatus): boolean {
  if (!dueDate || status === "done") return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(dueDate + "T00:00:00") < today;
}

export function TaskRow({
  task,
  onClick,
  onToggleDone,
  onMoveStatus,
  onUpdateAssignees,
  onUpdateDueDate,
  teamMembers = [],
  subtaskProgress,
  subtasks,
  onToggleSubtask,
  showLabBadge = false,
}: {
  task: Task;
  onClick: () => void;
  onToggleDone: () => void;
  onMoveStatus: (status: TaskStatus) => void;
  onUpdateAssignees: (ids: string[]) => void;
  onUpdateDueDate: (date: string | undefined) => void;
  teamMembers?: User[];
  subtaskProgress?: { total: number; done: number };
  subtasks?: Task[];
  onToggleSubtask?: (subtaskId: string, done: boolean) => void;
  showLabBadge?: boolean;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [calPos, setCalPos] = useState({ top: 0, left: 0 });
  const [subtaskExpanded, setSubtaskExpanded] = useState(false);
  const statusBtnRef = useRef<HTMLButtonElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const assigneeBtnRef = useRef<HTMLButtonElement>(null);
  const assigneeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!statusOpen && !assigneeOpen) return;
    function onDown(e: MouseEvent) {
      const inStatus = statusBtnRef.current?.contains(e.target as Node) || statusMenuRef.current?.contains(e.target as Node);
      const inAssignee = assigneeBtnRef.current?.contains(e.target as Node) || assigneeMenuRef.current?.contains(e.target as Node);
      if (!inStatus) setStatusOpen(false);
      if (!inAssignee) setAssigneeOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [statusOpen, assigneeOpen]);

  const cfg = STATUS_CONFIG[task.status];
  const overdue = isOverdue(task.dueDate, task.status);
  const hasSubtasks = subtaskProgress && subtaskProgress.total > 0;

  function openCal(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCalPos({ top: rect.bottom + 4, left: rect.left });
    setCalOpen(true);
  }

  return (
    <React.Fragment>
      <tr
        onClick={onClick}
        className="cursor-pointer transition-colors hover:bg-[rgba(27,46,75,0.03)]"
        style={{ opacity: task.status === "done" ? 0.7 : 1, height: "var(--density-row)" }}
      >
        {/* Checkbox */}
        <td className="pl-5 pr-2" style={{ width: 36 }}>
          <input
            type="checkbox"
            checked={task.status === "done"}
            onChange={(e) => { e.stopPropagation(); onToggleDone(); }}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 cursor-pointer"
            style={{ accentColor: "var(--color-navy)" }}
          />
        </td>

        {/* Title */}
        <td className="pr-3" style={{ maxWidth: 280 }}>
          <div className="flex items-center gap-1.5" style={{ minWidth: 0 }}>
            <span style={{
              fontSize: 13, fontWeight: 500, color: "var(--color-body)",
              textDecoration: task.status === "done" ? "line-through" : undefined,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              flex: "1 1 0", minWidth: 0,
            }}>
              {task.title}
            </span>
            {showLabBadge && task.scope === "lab" && (
              <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, backgroundColor: "rgba(27,46,75,0.08)", color: "var(--color-navy)", padding: "1px 6px", borderRadius: 4 }}>
                Lab
              </span>
            )}
          </div>
        </td>

        {/* Status */}
        <td className="pr-3" style={{ position: "relative" }}>
          <button
            ref={statusBtnRef}
            onClick={(e) => { e.stopPropagation(); setStatusOpen((o) => !o); setAssigneeOpen(false); setCalOpen(false); }}
            className="inline-flex items-center gap-1.5 px-2 py-0.5 hover:opacity-80 transition-opacity"
            style={{
              backgroundColor: `${cfg.dot}18`, color: cfg.dot,
              borderRadius: 5, fontSize: 12, fontWeight: 600,
              border: "none", cursor: "pointer", whiteSpace: "nowrap",
            }}
            aria-label={`Status: ${cfg.label}`}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cfg.dot }} />
            {cfg.label}
          </button>
          {statusOpen && createPortal(
            <div
              ref={statusMenuRef}
              className="animate-fade-in"
              style={{
                position: "fixed",
                top: (statusBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                left: statusBtnRef.current?.getBoundingClientRect().left ?? 0,
                zIndex: 9999,
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 8, boxShadow: "0 4px 16px rgba(27,46,75,0.12)",
                padding: "4px 0", minWidth: 148,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {STATUS_ORDER.map((s) => {
                const sc = STATUS_CONFIG[s];
                return (
                  <button
                    key={s}
                    onClick={() => { onMoveStatus(s); setStatusOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[rgba(27,46,75,0.06)] transition-colors"
                    style={{ fontSize: 12, color: "var(--color-body)", border: "none", background: "none", cursor: "pointer" }}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sc.dot }} />
                    {sc.label}
                    {s === task.status && <span style={{ marginLeft: "auto", color: "var(--color-navy)", fontSize: 10 }}>✓</span>}
                  </button>
                );
              })}
            </div>,
            document.body
          )}
        </td>

        {/* Priority */}
        <td className="pr-3"><PriorityBadge priority={task.priority} /></td>

        {/* Assignees */}
        <td className="pr-3" style={{ position: "relative" }}>
          <button
            ref={assigneeBtnRef}
            onClick={(e) => { e.stopPropagation(); setAssigneeOpen((o) => !o); setStatusOpen(false); setCalOpen(false); }}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
            aria-label="Edit assignees"
          >
            {task.assigneeIds.length === 0
              ? <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>-</span>
              : <AssigneeStack ids={task.assigneeIds} size={22} users={teamMembers} />}
          </button>
          {assigneeOpen && createPortal(
            <div
              ref={assigneeMenuRef}
              className="animate-fade-in"
              style={{
                position: "fixed",
                top: (assigneeBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                left: assigneeBtnRef.current?.getBoundingClientRect().left ?? 0,
                zIndex: 9999,
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 8, boxShadow: "0 4px 16px rgba(27,46,75,0.12)",
                padding: "4px 0", minWidth: 180, maxHeight: 240, overflowY: "auto",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {teamMembers.map((u) => {
                const checked = task.assigneeIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => {
                      const newIds = checked
                        ? task.assigneeIds.filter((id) => id !== u.id)
                        : [...task.assigneeIds, u.id];
                      onUpdateAssignees(newIds);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[rgba(27,46,75,0.06)] transition-colors"
                    style={{ fontSize: 12, color: "var(--color-body)", border: "none", background: "none", cursor: "pointer" }}
                  >
                    <Avatar user={u} size={18} />
                    <span style={{ flex: 1, textAlign: "left" }}>{u.name.split(" ")[0]}</span>
                    {checked && <span style={{ color: "var(--color-navy)", fontSize: 11 }}>✓</span>}
                  </button>
                );
              })}
              {teamMembers.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--color-secondary)", padding: "8px 12px" }}>No team members</p>
              )}
            </div>,
            document.body
          )}
        </td>

        {/* Due date */}
        <td className="pr-3">
          <button
            onClick={openCal}
            className="hover:bg-[rgba(27,46,75,0.06)] transition-colors"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 12,
              color: task.dueDate ? "var(--color-body)" : "var(--color-secondary)",
              fontWeight: overdue ? 600 : 400,
              background: "none", border: "none", cursor: "pointer",
              padding: "2px 4px", borderRadius: 4, whiteSpace: "nowrap",
            }}
            aria-label="Edit due date"
          >
            {overdue && <Clock size={11} color="var(--color-secondary)" />}
            {task.dueDate ? formatDate(task.dueDate) : "-"}
          </button>
          {calOpen && createPortal(
            <div onClick={(e) => e.stopPropagation()}>
              <CalendarPicker
                value={task.dueDate}
                accentColor="var(--color-navy)"
                pos={calPos}
                onSelect={(d) => { onUpdateDueDate(d); setCalOpen(false); }}
                onClear={() => { onUpdateDueDate(undefined); setCalOpen(false); }}
                onClose={() => setCalOpen(false)}
              />
            </div>,
            document.body
          )}
        </td>

        {/* Subtasks column */}
        <td className="pr-3">
          {hasSubtasks ? (
            <button
              onClick={(e) => { e.stopPropagation(); setSubtaskExpanded((x) => !x); }}
              style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}
              title={subtaskExpanded ? "Collapse subtasks" : "Expand subtasks"}
            >
              {subtaskExpanded
                ? <ChevronDown size={11} color="var(--color-secondary)" />
                : <ChevronRight size={11} color="var(--color-secondary)" />}
              <div style={{ width: 36, height: 3, backgroundColor: "var(--status-todo-bg)", borderRadius: 2, flexShrink: 0 }}>
                <div style={{
                  height: "100%",
                  width: `${(subtaskProgress!.done / subtaskProgress!.total) * 100}%`,
                  backgroundColor: subtaskProgress!.done === subtaskProgress!.total ? "var(--status-done-dot)" : "var(--color-navy)",
                  borderRadius: 2,
                }} />
              </div>
              <span style={{ fontSize: 11, color: "var(--color-secondary)", whiteSpace: "nowrap" }}>
                {subtaskProgress!.done}/{subtaskProgress!.total}
              </span>
            </button>
          ) : null}
        </td>

        {/* Options */}
        <td className="pr-3">
          <button
            onClick={(e) => e.stopPropagation()}
            className="w-9 h-9 flex items-center justify-center rounded hover:bg-[rgba(27,46,75,0.06)]"
            aria-label="Task options"
          >
            <MoreHorizontal size={14} color="var(--color-secondary)" />
          </button>
        </td>
      </tr>

      {/* Inline subtask checklist row */}
      {subtaskExpanded && hasSubtasks && subtasks && subtasks.length > 0 && (
        <tr
          style={{ backgroundColor: "rgba(27,46,75,0.015)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <td colSpan={8} style={{ paddingLeft: 52, paddingRight: 20, paddingTop: 4, paddingBottom: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {subtasks.map((sub) => (
                <div
                  key={sub.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}
                >
                  <input
                    type="checkbox"
                    checked={sub.status === "done"}
                    onChange={(e) => onToggleSubtask?.(sub.id, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ accentColor: "var(--color-navy)", cursor: "pointer", flexShrink: 0, width: 13, height: 13 }}
                  />
                  <span style={{
                    fontSize: 13,
                    color: sub.status === "done" ? "var(--color-secondary)" : "var(--color-body)",
                    textDecoration: sub.status === "done" ? "line-through" : "none",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    flex: 1,
                  }}>
                    {sub.title}
                  </span>
                  {sub.assigneeIds.length > 0 && (
                    <AssigneeStack ids={sub.assigneeIds} size={18} users={teamMembers} />
                  )}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}
