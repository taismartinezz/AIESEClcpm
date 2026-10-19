"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import type { Task, CalendarEvent, User } from "@/types";
import Avatar from "@/components/ui/Avatar";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useUndoToast } from "@/context/UndoToastContext";
import { showToast } from "@/components/ui/Toast";
import type { OverdueReminder } from "./NeedsAttentionWidget";

// ── Types ─────────────────────────────────────────────────────────────────────

type AgendaItem = {
  id: string;
  title: string;
  kind: "task" | "reminder" | "event";
  dateIso: string;
  /** Shown next to the date: a reminder's or event's start time. */
  time?: string;
  href: string;
  assigneeIds: string[];
  canComplete: boolean;
};

// ── Kind chip config ───────────────────────────────────────────────────────────

const KIND_CFG = {
  task:     { label: "Task",     color: "var(--color-navy)",     bg: "rgba(2,99,196,0.09)" },
  reminder: { label: "Reminder", color: "var(--color-body)",     bg: "rgba(0,0,0,0.06)"   },
  event:    { label: "Event",    color: "var(--color-secondary)", bg: "rgba(0,0,0,0.05)"  },
};

// ── Section config ─────────────────────────────────────────────────────────────

const SECTION_CFG = {
  overdue:  { label: "Overdue",  headerColor: "var(--color-navy)" },
  today:    { label: "Today",    headerColor: "var(--color-navy)" },
  upcoming: { label: "Upcoming", headerColor: "var(--color-navy)" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "2026-10-15" is a calendar date: read it in the viewer's time zone, not as UTC midnight. */
export function parseDue(iso: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T00:00:00") : new Date(iso);
}

/** "15:00" → "3:00 PM". */
function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function overdueLabel(iso: string): string {
  return parseDue(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function upcomingLabel(iso: string): string {
  const d = parseDue(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const tomorrowEnd = new Date(tomorrow); tomorrowEnd.setDate(tomorrow.getDate() + 1);
  if (d >= tomorrow && d < tomorrowEnd) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// ── Categorizer ───────────────────────────────────────────────────────────────

export function categorize(
  tasks: Task[],
  reminders: OverdueReminder[],
  events: CalendarEvent[],
  userId: string,
): { overdue: AgendaItem[]; today: AgendaItem[]; upcoming: AgendaItem[] } {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const weekEnd    = new Date(todayEnd); weekEnd.setDate(weekEnd.getDate() + 7);

  const overdue: AgendaItem[] = [];
  const today:   AgendaItem[] = [];
  const upcoming: AgendaItem[] = [];

  for (const t of tasks) {
    // Yours: assigned to you, or unassigned and created by you.
    const mine = t.assigneeIds.includes(userId) || (t.assigneeIds.length === 0 && t.createdBy === userId);
    if (!t.dueDate || t.status === "done" || !mine) continue;
    const due = new Date(t.dueDate + "T23:59:59");
    const item: AgendaItem = { id: t.id, title: t.title, kind: "task", dateIso: t.dueDate, href: "/tasks", assigneeIds: t.assigneeIds, canComplete: true };
    if (due < todayStart)    overdue.push(item);
    else if (due <= todayEnd) today.push(item);
    else if (due <= weekEnd)  upcoming.push(item);
  }

  for (const r of reminders) {
    const due = new Date(r.dueAt);
    const hasTime = !/^\d{4}-\d{2}-\d{2}$/.test(r.dueAt);
    const time = hasTime ? `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}` : undefined;
    const item: AgendaItem = { id: r.id, title: r.title, kind: "reminder", dateIso: r.dueAt, time, href: "/reminders", assigneeIds: r.assigneeId ? [r.assigneeId] : [], canComplete: true };
    if (due < todayStart)    overdue.push(item);
    else if (due <= todayEnd) today.push(item);
    else if (due <= weekEnd)  upcoming.push(item);
  }

  for (const ev of events) {
    const evDate = new Date(ev.date + "T00:00:00");
    if (evDate < todayStart) continue;
    const time = ev.time?.slice(0, 5);
    const item: AgendaItem = { id: ev.id, title: ev.title, kind: "event", dateIso: time ? `${ev.date}T${time}:00` : ev.date, time, href: ev.href ?? "/attendance", assigneeIds: [], canComplete: false };
    if (evDate <= todayEnd) today.push(item);
    else if (evDate <= weekEnd) upcoming.push(item);
  }

  const byDate = (a: AgendaItem, b: AgendaItem) => parseDue(a.dateIso).getTime() - parseDue(b.dateIso).getTime();
  return { overdue: overdue.sort(byDate), today: today.sort(byDate), upcoming: upcoming.sort(byDate) };
}

// ── Single item row (mirrors TaskCard interior) ────────────────────────────────

function ItemRow({
  item, teamMembers, onDone, isFirst, sectionKey,
}: {
  item: AgendaItem;
  teamMembers: User[];
  onDone?: (item: AgendaItem) => void;
  isFirst: boolean;
  sectionKey: "overdue" | "today" | "upcoming";
}) {
  const kCfg = KIND_CFG[item.kind];
  const assignees = item.assigneeIds
    .map((id) => teamMembers.find((u) => u.id === id))
    .filter(Boolean) as User[];
  const dayLabel = sectionKey === "overdue" ? overdueLabel(item.dateIso)
    : sectionKey === "upcoming" ? upcomingLabel(item.dateIso)
    : "";
  const dateLabel = [dayLabel, item.time ? timeLabel(item.time) : ""].filter(Boolean).join(", ");

  return (
    <div style={{
      padding: "10px 12px",
      borderTop: isFirst ? undefined : "1px solid var(--color-border)",
    }}>
      <Link href={item.href} style={{ textDecoration: "none" }}>
        <p style={{
          fontSize: 13, fontWeight: 500, color: "var(--color-body)",
          lineHeight: 1.35, marginBottom: 8,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {item.title}
        </p>
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: kCfg.color, backgroundColor: kCfg.bg,
            borderRadius: 4, padding: "1px 5px", textTransform: "uppercase", letterSpacing: "0.04em",
            whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {kCfg.label}
          </span>
          {dateLabel && (
            <span style={{ fontSize: 11, color: "var(--color-secondary)", whiteSpace: "nowrap" }}>{dateLabel}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          {assignees.length > 0 && (
            <div style={{ display: "flex" }}>
              {assignees.slice(0, 2).map((u, i) => (
                <div key={u.id} style={{ marginLeft: i > 0 ? -5 : 0 }}>
                  <Avatar user={u} size={20} />
                </div>
              ))}
            </div>
          )}
          {item.canComplete && onDone && (
            <button
              onClick={(e) => { e.preventDefault(); onDone(item); }}
              aria-label={`Mark "${item.title}" as done`}
              style={{
                width: 22, height: 22, flexShrink: 0, display: "flex", alignItems: "center",
                justifyContent: "center", borderRadius: "50%",
                border: "1.5px solid var(--color-border)", background: "none",
                cursor: "pointer", color: "var(--color-secondary)",
                transition: "border-color 120ms, color 120ms, background-color 120ms",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = "#30D158"; el.style.color = "#30D158";
                el.style.backgroundColor = "rgba(48,209,88,0.08)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = "var(--color-border)"; el.style.color = "var(--color-secondary)";
                el.style.backgroundColor = "transparent";
              }}
            >
              <Check size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section card ───────────────────────────────────────────────────────────────

function AgendaCard({
  sectionKey, items, teamMembers, onDone,
}: {
  sectionKey: "overdue" | "today" | "upcoming";
  items: AgendaItem[];
  teamMembers: User[];
  onDone: (item: AgendaItem) => void;
}) {
  const cfg = SECTION_CFG[sectionKey];
  const isToday = sectionKey === "today";

  return (
    <section aria-label={cfg.label} className="agenda-card" style={{
      flex: 1, minWidth: 200,
      backgroundColor: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: 10,
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)",
    }}>
      {/* Header */}
      <div style={{ padding: "12px 14px 10px", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid var(--color-border)" }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: cfg.headerColor,
          textTransform: "uppercase", letterSpacing: "0.09em", flex: 1,
        }}>
          {cfg.label}
        </span>
        {items.length > 0 && (
          <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>
            {items.length}
          </span>
        )}
      </div>

      {/* Items or empty state */}
      {items.length === 0 ? (
        <div style={{ padding: "14px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
          <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0, lineHeight: 1.5 }}>
            {isToday ? "You're all clear today." : sectionKey === "overdue" ? "Nothing overdue." : "Nothing in the next 7 days."}
          </p>
        </div>
      ) : (
        <>
          {items.slice(0, 5).map((item, i) => (
            <ItemRow
              key={item.id}
              item={item}
              teamMembers={teamMembers}
              onDone={onDone}
              isFirst={i === 0}
              sectionKey={sectionKey}
            />
          ))}
          {items.length > 5 && (
            <div style={{ padding: "8px 12px", borderTop: "1px solid var(--color-border)" }}>
              <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>+{items.length - 5} more</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── TodayWidget ────────────────────────────────────────────────────────────────

export function TodayWidget({
  tasks,
  reminders,
  events,
  userId,
  teamMembers,
  loading,
}: {
  tasks: Task[];
  reminders: OverdueReminder[];
  events: CalendarEvent[];
  userId: string;
  teamMembers: User[];
  loading?: boolean;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { show: showUndo } = useUndoToast();

  const { overdue, today, upcoming } = categorize(tasks, reminders, events, userId);
  const overdueItems  = overdue.filter((i) => !dismissed.has(i.id));
  const todayItems    = today.filter((i) => !dismissed.has(i.id));
  const upcomingItems = upcoming.filter((i) => !dismissed.has(i.id));

  // Saved straight away (so leaving the page can't lose it); Undo writes the old value back.
  async function setDone(item: AgendaItem, done: boolean, prevStatus: string) {
    if (!isSupabaseConfigured) return;
    const { error } = item.kind === "reminder"
      ? await supabase.from("reminders").update({ completed: done }).eq("id", item.id)
      : await supabase.from("tasks").update({ status: done ? "done" : prevStatus }).eq("id", item.id);
    if (error) {
      setDismissed((prev) => { const s = new Set(prev); if (done) s.delete(item.id); else s.add(item.id); return s; });
      showToast(`Couldn't save: ${error.message}`, "error");
    }
  }

  function markDone(item: AgendaItem) {
    if (item.kind === "event") return;
    const prevStatus = tasks.find((t) => t.id === item.id)?.status ?? "todo";
    setDismissed((prev) => new Set(prev).add(item.id));
    void setDone(item, true, prevStatus);
    showUndo(
      `Marked "${item.title}" as done`,
      () => {
        setDismissed((prev) => { const s = new Set(prev); s.delete(item.id); return s; });
        void setDone(item, false, prevStatus);
      },
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ flex: 1, minWidth: 200, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ width: 60, height: 9, borderRadius: 4, backgroundColor: "var(--color-border)", opacity: 0.5 }} className="animate-pulse" />
            </div>
            {[1, 2].map((j) => (
              <div key={j} style={{ padding: "10px 12px", borderTop: "1px solid var(--color-border)" }}>
                <div style={{ width: "80%", height: 12, borderRadius: 4, backgroundColor: "var(--color-border)", opacity: 0.4, marginBottom: 8 }} className="animate-pulse" />
                <div style={{ width: "45%", height: 9, borderRadius: 4, backgroundColor: "var(--color-border)", opacity: 0.25 }} className="animate-pulse" />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <AgendaCard sectionKey="overdue"  items={overdueItems}  teamMembers={teamMembers} onDone={markDone} />
        <AgendaCard sectionKey="today"    items={todayItems}    teamMembers={teamMembers} onDone={markDone} />
        <AgendaCard sectionKey="upcoming" items={upcomingItems} teamMembers={teamMembers} onDone={markDone} />
      </div>
      <style>{`
        .agenda-card { transition: box-shadow 180ms ease, border-color 180ms ease; }
        .agenda-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.05) !important; border-color: rgba(0,0,0,0.12) !important; }
      `}</style>
    </>
  );
}
