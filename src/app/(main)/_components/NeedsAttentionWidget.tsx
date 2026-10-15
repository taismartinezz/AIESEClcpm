"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle, Clock, Check, MoreHorizontal } from "lucide-react";
import type { Task, User } from "@/types";
import Avatar from "@/components/ui/Avatar";
import { Card, CardHeader } from "./DashboardCard";
import { SkeletonLine } from "./TeamActivityWidget";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OverdueReminder {
  id: string;
  title: string;
  dueAt: string;
  scope: "personal" | "lab";
  assigneeId?: string;
}

interface OpenItem {
  id: string;
  title: string;
  dueIso: string;
  kind: "task" | "reminder";
  href: string;
  assigneeIds: string[];
}

// ── StillOpenWidget ───────────────────────────────────────────────────────────

export function NeedsAttentionWidget({
  tasks,
  reminders,
  teamMembers,
  userId,
  loading,
  onComplete,
  onSnooze,
}: {
  tasks: Task[];
  reminders: OverdueReminder[];
  teamMembers: User[];
  userId: string;
  loading?: boolean;
  onComplete?: (id: string, kind: "task" | "reminder") => void;
  onSnooze?: (id: string, kind: "task" | "reminder") => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const overdueTasks: OpenItem[] = tasks
    .filter((t) =>
      t.dueDate &&
      new Date(t.dueDate) < today &&
      t.status !== "done" &&
      t.assigneeIds.includes(userId)
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueIso: t.dueDate!,
      kind: "task" as const,
      href: "/tasks",
      assigneeIds: t.assigneeIds,
    }));

  const overdueRems: OpenItem[] = reminders.map((r) => ({
    id: r.id,
    title: r.title,
    dueIso: r.dueAt,
    kind: "reminder" as const,
    href: "/reminders",
    assigneeIds: r.assigneeId ? [r.assigneeId] : [],
  }));

  const all = [...overdueTasks, ...overdueRems]
    .filter((item) => !dismissed.has(item.id))
    .sort((a, b) => new Date(b.dueIso).getTime() - new Date(a.dueIso).getTime());

  const thisWeek = all.filter((item) => new Date(item.dueIso) >= weekAgo);
  const older    = all.filter((item) => new Date(item.dueIso) < weekAgo);

  function formatDue(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  async function handleComplete(item: OpenItem, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDismissed((prev) => new Set(prev).add(item.id));
    onComplete?.(item.id, item.kind);
    if (isSupabaseConfigured) {
      if (item.kind === "reminder") {
        await supabase.from("reminders").update({ completed: true }).eq("id", item.id);
      } else {
        await supabase.from("tasks").update({ status: "done" }).eq("id", item.id);
      }
    }
  }

  async function handleSnooze(item: OpenItem, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDismissed((prev) => new Set(prev).add(item.id));
    onSnooze?.(item.id, item.kind);
    // Snooze: push due date 3 days forward
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + 3);
    if (isSupabaseConfigured) {
      if (item.kind === "reminder") {
        await supabase.from("reminders").update({ due_at: newDate.toISOString() }).eq("id", item.id);
      } else {
        await supabase.from("tasks").update({ due_date: newDate.toISOString().split("T")[0] }).eq("id", item.id);
      }
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader title="Still open" />
        <div className="px-5 py-3 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <SkeletonLine width={36} height={11} />
              <SkeletonLine width="60%" />
              <SkeletonLine width="25%" height={11} />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  function ItemRow({ item }: { item: OpenItem }) {
    const assignees = item.assigneeIds
      .map((id) => teamMembers.find((u) => u.id === id))
      .filter(Boolean) as User[];

    return (
      <div className="group" style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--color-border)" }}>
        {/* Soft amber dot */}
        <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "#8E8E93", flexShrink: 0, marginTop: 1 }} />

        <Link
          href={item.href}
          style={{ flex: 1, minWidth: 0, textDecoration: "none" }}
        >
          <p style={{ fontSize: 13, color: "var(--color-body)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.title}
          </p>
        </Link>

        <span style={{ fontSize: 11, color: "var(--color-secondary)", flexShrink: 0 }}>
          {formatDue(item.dueIso)}
        </span>

        <span style={{
          fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
          backgroundColor: "var(--color-canvas)",
          color: "var(--color-secondary)", border: "1px solid var(--color-border)",
          textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0,
        }}>
          {item.kind === "task" ? "Task" : "Reminder"}
        </span>

        {assignees.length > 0 && (
          <div className="flex items-center" style={{ flexShrink: 0 }}>
            {assignees.slice(0, 2).map((u, i) => (
              <div key={u.id} style={{ marginLeft: i > 0 ? -4 : 0 }}>
                <Avatar user={u} size={18} />
              </div>
            ))}
          </div>
        )}

        {/* Inline actions - visible on hover */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1" style={{ flexShrink: 0 }}>
          <button
            onClick={(e) => handleComplete(item, e)}
            title="Mark done"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 5, border: "1px solid var(--color-border)", background: "var(--color-canvas)", cursor: "pointer", color: "var(--color-secondary)" }}
          >
            <Check size={12} />
          </button>
          <button
            onClick={(e) => handleSnooze(item, e)}
            title="Snooze 3 days"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 5, border: "1px solid var(--color-border)", background: "var(--color-canvas)", cursor: "pointer", color: "var(--color-secondary)" }}
          >
            <Clock size={12} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader title="Still open" />
      <div className="px-5 py-3">
        {all.length === 0 ? (
          <div className="flex items-center gap-2 py-2">
            <CheckCircle size={15} color="var(--color-success, #2d7a3a)" />
            <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>
              Nothing waiting on you right now.
            </p>
          </div>
        ) : (
          <div>
            {thisWeek.length > 0 && (
              <>
                {older.length > 0 && (
                  <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                    From this week
                  </p>
                )}
                {thisWeek.map((item) => <ItemRow key={item.id} item={item} />)}
              </>
            )}
            {older.length > 0 && (
              <>
                <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: thisWeek.length > 0 ? 10 : 0, marginBottom: 4 }}>
                  Older
                </p>
                {older.map((item) => <ItemRow key={item.id} item={item} />)}
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
