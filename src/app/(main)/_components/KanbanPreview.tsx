"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Task, User } from "@/types";
import Avatar from "@/components/ui/Avatar";
import { Card, CardHeader } from "./DashboardCard";
import { SkeletonLine } from "./TeamActivityWidget";
const PRIORITY_COLORS = { high: "#C0392B", medium: "#A0622A", low: "#2E7D52" };
const PRIORITY_BG    = { high: "#FDDCDC", medium: "#FDEFD4", low: "#D4EDE0" };

function TaskRow({ task, teamMembers }: { task: Task; teamMembers: User[] }) {
  const assignees = task.assigneeIds
    .map((id) => teamMembers.find((u) => u.id === id))
    .filter(Boolean) as User[];

  const dueDateDisplay = (() => {
    if (!task.dueDate) return null;
    const d = new Date(task.dueDate + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  })();

  return (
    <div
      className="flex items-center gap-3 px-5"
      style={{ padding: "8px 20px", borderBottom: "1px solid var(--color-border)", minHeight: 44 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-body)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {task.title}
        </p>
      </div>
      {dueDateDisplay && (
        <span style={{
          fontSize: 11, flexShrink: 0,
          color: "var(--color-secondary)",
          fontWeight: 400,
        }}>
          {dueDateDisplay}
        </span>
      )}
      <span style={{
        fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4, flexShrink: 0,
        backgroundColor: PRIORITY_BG[task.priority] ?? "var(--color-canvas)",
        color: PRIORITY_COLORS[task.priority] ?? "var(--color-secondary)",
      }}>
        {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
      </span>
      {assignees.length > 0 && (
        <div className="flex items-center" style={{ flexShrink: 0 }}>
          {assignees.slice(0, 2).map((u, i) => (
            <div key={u.id} style={{ marginLeft: i > 0 ? -4 : 0 }}>
              <Avatar user={u} size={20} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function KanbanPreview({
  tasks,
  teamMembers,
  userId,
  loading,
}: {
  tasks: Task[];
  teamMembers: User[];
  userId: string;
  loading?: boolean;
  // Legacy props kept for compatibility - no longer used
  onTaskClick?: (task: Task) => void;
  onMoveTask?: (taskId: string, status: string) => void;
  onAddTask?: (status: string) => void;
}) {
  // My tasks: assigned to me, not done, sorted by due date ascending (nulls last)
  const myTasks = tasks
    .filter((t) => t.status !== "done" && t.assigneeIds.includes(userId))
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    })
    .slice(0, 6);

  if (loading) {
    return (
      <Card>
        <CardHeader
          title="My tasks"
          action={
            <Link href="/tasks" className="flex items-center gap-1 transition-opacity hover:opacity-70" style={{ fontSize: 12, color: "var(--color-navy)", fontWeight: 600, textDecoration: "none" }}>
              See all <ChevronRight size={13} />
            </Link>
          }
        />
        <div className="py-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3" style={{ padding: "10px 20px", borderBottom: "1px solid var(--color-border)" }}>
              <SkeletonLine width="50%" />
              <SkeletonLine width={60} height={11} />
              <SkeletonLine width={50} height={20} />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="My tasks"
        action={
          <Link href="/tasks" className="flex items-center gap-1 transition-opacity hover:opacity-70" style={{ fontSize: 12, color: "var(--color-navy)", fontWeight: 600, textDecoration: "none" }}>
            See all <ChevronRight size={13} />
          </Link>
        }
      />
      {myTasks.length === 0 ? (
        <div className="px-5 py-4">
          <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>No open tasks assigned to you.</p>
        </div>
      ) : (
        <div>
          {myTasks.map((task) => (
            <TaskRow key={task.id} task={task} teamMembers={teamMembers} />
          ))}
        </div>
      )}
    </Card>
  );
}
