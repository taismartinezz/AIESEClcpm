"use client";

import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { Plus, Check, List, Trash2, GripVertical, Users, User as UserIcon, Pencil } from "lucide-react";
import ScopeSidebar, { type ScopeSection } from "@/components/ui/ScopeSidebar";
import PageHeader from "@/components/ui/PageHeader";
import { DateTimeFields, isoToLocalDate } from "@/components/ui/DateTimePicker";
import { DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import Avatar from "@/components/ui/Avatar";
import ClientOnly from "@/components/ui/ClientOnly";
import type { Reminder, ReminderScope, ReminderPriority, User, SubProject } from "@/types";
import { useUndoToast } from "@/context/UndoToastContext";

// ── Constants ─────────────────────────────────────────────────────────────────

type ListType = "today" | "scheduled" | "priority" | "all" | "personal" | "lab" | "project";

const PRIORITY_MARKS: Record<ReminderPriority, string> = { high: "!!!", medium: "!!", low: "!" };

const LIST_COLORS: Record<ListType, string> = {
  today:     "#1B2E4B",
  scheduled: "#1E40AF",
  priority:  "#2563EB",
  all:       "#475569",
  personal:  "#0EA5E9",
  lab:       "#0F2544",
  project:   "#34A853",
};
const LIST_LABELS: Record<ListType, string> = {
  today: "Today", scheduled: "Scheduled", priority: "Priority",
  all: "All", personal: "Personal", lab: "Lab", project: "Projects",
};
// No drag-reorder - all views use date-sorted grouped layout
const DRAGGABLE_LISTS: ListType[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStart(): Date { const d = new Date(); d.setHours(0,0,0,0); return d; }
function tomorrowStart(): Date { const d = todayStart(); d.setDate(d.getDate()+1); return d; }
function makeTodayDueAt(): string { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); }

// Midnight = "no specific time" sentinel; 9AM default removed (use midnight instead)
function makeDueAt(date: string, time: string): string {
  return new Date(time ? `${date}T${time}` : `${date}T00:00`).toISOString();
}

function isoToLocalTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function hasExplicitTime(iso: string): boolean {
  const d = new Date(iso); return d.getHours() !== 0 || d.getMinutes() !== 0;
}
function formatDueDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const tmrw = new Date(now); tmrw.setDate(tmrw.getDate()+1);
  const withTime = hasExplicitTime(iso);
  const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString())  return withTime ? `Today, ${timeStr}` : "Today";
  if (d.toDateString() === tmrw.toDateString()) return withTime ? `Tomorrow, ${timeStr}` : "Tomorrow";
  const days = Math.round((d.getTime()-now.getTime())/86400000);
  if (days < 0) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + (withTime ? `, ${timeStr}` : "");
  if (days < 7)  return d.toLocaleDateString("en-US", { weekday: "short" }) + (withTime ? `, ${timeStr}` : "");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function getDefaultScope(list: ListType): ReminderScope { return list === "lab" ? "lab" : list === "project" ? "project" : "personal"; }

function sortByPosition(list: Reminder[]): Reminder[] {
  return [...list].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
function sortByDate(list: Reminder[]): Reminder[] {
  return [...list].sort((a, b) => {
    const aMs = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const bMs = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    if (aMs !== bMs) return aMs - bMs;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

function filterReminders(list: ListType, all: Reminder[], subProjectId?: string | null): Reminder[] {
  const tomorrow = tomorrowStart();
  switch (list) {
    case "today":     return all.filter(r => r.dueAt && new Date(r.dueAt) < tomorrow);
    case "scheduled": return all.filter(r => !!r.dueAt);
    case "priority":  return all.filter(r => !!r.priority);
    case "personal":  return all.filter(r => r.scope === "personal");
    case "lab":       return all.filter(r => r.scope === "lab");
    case "project":   return all.filter(r => r.scope === "project" && (!subProjectId || r.subProjectId === subProjectId));
    default:          return all;
  }
}

// ── Date grouping ─────────────────────────────────────────────────────────────

interface DateGroup { label: string; sortKey: number; items: Reminder[]; }
interface ReminderGroups {
  pastDue: DateGroup[];
  today: Reminder[];
  tomorrow: Reminder[];
  future: DateGroup[];
  noDate: Reminder[];
}

function groupByDate(reminders: Reminder[]): ReminderGroups {
  const todayMs = todayStart().getTime();
  const tomorrowMs = tomorrowStart().getTime();
  const pastMap  = new Map<number, DateGroup>();
  const futureMap = new Map<number, DateGroup>();
  const todayItems: Reminder[] = [];
  const tomorrowItems: Reminder[] = [];

  for (const r of sortByDate(reminders.filter(r => !!r.dueAt))) {
    const dMid = new Date(r.dueAt!); dMid.setHours(0, 0, 0, 0);
    const key = dMid.getTime();
    const wd = dMid.toLocaleDateString("en-US", { weekday: "short" });
    const md = dMid.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const lbl = `${wd} ${md}`;
    if (key < todayMs) {
      if (!pastMap.has(key)) pastMap.set(key, { label: lbl, sortKey: key, items: [] });
      pastMap.get(key)!.items.push(r);
    } else if (key === todayMs) {
      todayItems.push(r);
    } else if (key === tomorrowMs) {
      tomorrowItems.push(r);
    } else {
      if (!futureMap.has(key)) futureMap.set(key, { label: lbl, sortKey: key, items: [] });
      futureMap.get(key)!.items.push(r);
    }
  }

  const noDate = [...reminders.filter(r => !r.dueAt)].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return {
    pastDue: Array.from(pastMap.values()).sort((a, b) => a.sortKey - b.sortKey),
    today: todayItems,
    tomorrow: tomorrowItems,
    future: Array.from(futureMap.values()).sort((a, b) => a.sortKey - b.sortKey),
    noDate,
  };
}

// ── AssigneePicker ────────────────────────────────────────────────────────────

function AssigneePicker({ value, teamMembers, accentColor, onChange }: {
  value?: string; teamMembers: User[]; accentColor: string; onChange: (id?: string) => void;
}) {
  if (teamMembers.length === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Users size={12} color="var(--color-secondary)" />
      <span style={{ fontSize: 11, color: "var(--color-secondary)", fontFamily: "var(--font-roboto)", marginRight: 2 }}>Remind:</span>
      {teamMembers.map(m => (
        <button key={m.id} onClick={() => onChange(value === m.id ? undefined : m.id)} title={m.name}
          style={{ width: 26, height: 26, borderRadius: "50%", border: `2px solid ${value === m.id ? accentColor : "var(--color-border)"}`, backgroundColor: "transparent", cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "border-color 0.1s" }}>
          <Avatar user={m} size={22} />
        </button>
      ))}
    </div>
  );
}

// ── CompletionCircle ──────────────────────────────────────────────────────────

function CompletionCircle({ completing, color, onClick }: { completing: boolean; color: string; onClick: () => void }) {
  return (
    <button onClick={e => { e.stopPropagation(); onClick(); }} aria-label="Mark complete"
      style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, border: `2px solid ${completing ? color : "var(--color-border)"}`, backgroundColor: completing ? color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background-color 0.12s, border-color 0.12s" }}
      onMouseEnter={e => { if (!completing) (e.currentTarget as HTMLButtonElement).style.backgroundColor = `${color}22`; }}
      onMouseLeave={e => { if (!completing) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}>
      {completing && <Check size={11} color="#fff" strokeWidth={3} />}
    </button>
  );
}

// ── ReminderRow ───────────────────────────────────────────────────────────────

interface ReminderRowProps {
  reminder: Reminder; currentUserId: string; teamMembers: User[]; isDraggable: boolean;
  showScopeHint?: boolean;
  isPastDue?: boolean;
  onComplete: (id: string) => void; onDelete: (id: string) => void; onEdit: () => void;
  onDragStart?: () => void; onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void; onDrop?: (e: React.DragEvent) => void;
  isDragging?: boolean;
}

function ReminderRow({ reminder, currentUserId, teamMembers, isDraggable, showScopeHint, isPastDue, onComplete, onDelete, onEdit, onDragStart, onDragEnd, onDragOver, onDrop, isDragging }: ReminderRowProps) {
  const [completing, setCompleting] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const isCreator = reminder.userId === currentUserId;
  const canCheck = reminder.scope === "lab" ? true : isCreator;
  const circleColor = reminder.scope === "lab" ? LIST_COLORS.lab : LIST_COLORS.personal;
  const creator = reminder.scope === "lab" ? teamMembers.find(m => m.id === reminder.userId) : undefined;
  const assignee = reminder.assigneeId ? teamMembers.find(m => m.id === reminder.assigneeId) : undefined;

  function handleCheck() {
    if (!canCheck || completing) return;
    setCompleting(true);
    timerRef.current = setTimeout(() => onComplete(reminder.id), 340);
  }

  return (
    <div
      draggable={isDraggable}
      onDragStart={isDraggable ? e => { e.dataTransfer.setData("id", reminder.id); e.dataTransfer.effectAllowed = "move"; onDragStart?.(); } : undefined}
      onDragEnd={onDragEnd}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver?.(e); }}
      onDrop={onDrop}
      style={{ maxHeight: completing ? 0 : 120, opacity: completing ? 0 : isDragging ? 0.4 : 1, overflow: "hidden", transform: completing ? "translateY(-2px)" : "none", transition: completing ? "opacity 0.2s, max-height 0.35s ease 0.06s, transform 0.2s" : "none", pointerEvents: completing ? "none" : undefined }}
    >
      <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 16px 7px 12px", borderBottom: "1px solid var(--color-border)", backgroundColor: hovered ? "rgba(0,0,0,0.02)" : "transparent", transition: "background-color 0.1s", cursor: "default" }}>
        {/* Drag handle - only shows when draggable and hovered */}
        <div style={{ width: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 2, opacity: isDraggable && hovered ? 0.4 : 0, cursor: "grab", transition: "opacity 0.12s" }}>
          <GripVertical size={14} color="var(--color-secondary)" />
        </div>
        <CompletionCircle completing={completing} color={circleColor} onClick={handleCheck} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            {showScopeHint && (
              <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, backgroundColor: reminder.scope === "lab" ? LIST_COLORS.lab : LIST_COLORS.personal, opacity: 0.65, display: "inline-block" }} />
            )}
            {reminder.priority && (
              <span style={{ fontSize: 11, fontWeight: 800, color: reminder.scope === "lab" ? LIST_COLORS.lab : LIST_COLORS.personal, letterSpacing: "-0.5px", flexShrink: 0, userSelect: "none" }}>
                {PRIORITY_MARKS[reminder.priority]}
              </span>
            )}
            <span style={{ fontSize: 15, color: "var(--color-body)", fontWeight: 400, fontFamily: "var(--font-roboto)", lineHeight: 1.3 }}>{reminder.title}</span>
          </div>
          {reminder.dueAt && (
            <div style={{ fontSize: 12, marginTop: 2, color: "var(--color-secondary)", fontWeight: 400 }}>
              {formatDueDate(reminder.dueAt)}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginTop: 2 }}>
          {creator && <Avatar user={creator} size={18} />}
          {assignee && assignee.id !== reminder.userId && <Avatar user={assignee} size={18} />}
          {isCreator && hovered && (
            <>
              <button onClick={e => { e.stopPropagation(); onEdit(); }} aria-label="Edit reminder"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", opacity: 0.45 }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.45"; }}>
                <Pencil size={13} color="var(--color-secondary)" />
              </button>
              <button onClick={e => { e.stopPropagation(); onDelete(reminder.id); }} aria-label="Delete"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", opacity: 0.45 }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.45"; }}>
                <Trash2 size={13} color="var(--color-secondary)" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CompletedReminderRow ──────────────────────────────────────────────────────

function CompletedReminderRow({ reminder, currentUserId, onUncomplete }: {
  reminder: Reminder; currentUserId: string; onUncomplete: (id: string) => void;
}) {
  const canRestore = reminder.scope === "lab" ? true : reminder.userId === currentUserId;
  const circleColor = reminder.scope === "lab" ? LIST_COLORS.lab : LIST_COLORS.personal;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 16px", borderBottom: "1px solid var(--color-border)", opacity: 0.5 }}>
      <button onClick={() => canRestore && onUncomplete(reminder.id)} disabled={!canRestore} aria-label="Restore reminder"
        style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, border: `2px solid ${circleColor}`, backgroundColor: circleColor, display: "flex", alignItems: "center", justifyContent: "center", cursor: canRestore ? "pointer" : "default" }}>
        <Check size={11} color="#fff" strokeWidth={3} />
      </button>
      <span style={{ fontSize: 14, color: "var(--color-secondary)", fontFamily: "var(--font-roboto)", textDecoration: "line-through", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reminder.title}</span>
    </div>
  );
}

// ── DraggableList - wraps reminder rows with drag-and-drop ────────────────────

interface DragListProps {
  items: Reminder[]; isDraggable: boolean; accentColor: string;
  currentUserId: string; teamMembers: User[]; editingId: string | null;
  showScopeHint?: boolean;
  onComplete: (id: string) => void; onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onSave: (id: string, u: UpdatePayload) => void;
  onCancelEdit: () => void;
  onReorder: (fromId: string, beforeId: string | "end", items: Reminder[]) => void;
  projectId?: string;
}

function DraggableList({ items, isDraggable, accentColor, currentUserId, teamMembers, editingId, showScopeHint, onComplete, onDelete, onEdit, onSave, onCancelEdit, onReorder, projectId }: DragListProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropBeforeId, setDropBeforeId] = useState<string | "end" | null>(null);

  function handleDrop(fromId: string, beforeId: string | "end") {
    if (fromId !== beforeId) onReorder(fromId, beforeId, items);
    setDraggingId(null); setDropBeforeId(null);
  }

  const DropLine = () => (
    <div style={{ height: 2, margin: "0 16px", borderRadius: 1, backgroundColor: accentColor, transition: "opacity 0.1s" }} />
  );

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDropBeforeId("end"); }}
      onDrop={e => { e.preventDefault(); if (draggingId) handleDrop(draggingId, "end"); }}
      onDragLeave={e => { if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) setDropBeforeId(null); }}
    >
      {items.map(r => (
        <Fragment key={r.id}>
          {dropBeforeId === r.id && draggingId && draggingId !== r.id && <DropLine />}
          {editingId === r.id ? (
            <ReminderEditRow reminder={r} teamMembers={teamMembers} currentUserId={currentUserId} projectId={projectId} onSave={onSave} onCancel={onCancelEdit} />
          ) : (
            <ReminderRow
              reminder={r} currentUserId={currentUserId} teamMembers={teamMembers}
              isDraggable={isDraggable} isDragging={draggingId === r.id}
              showScopeHint={showScopeHint}
              onComplete={onComplete} onDelete={onDelete} onEdit={() => onEdit(r.id)}
              onDragStart={() => setDraggingId(r.id)}
              onDragEnd={() => { setDraggingId(null); setDropBeforeId(null); }}
              onDragOver={() => setDropBeforeId(r.id)}
              onDrop={e => { e.preventDefault(); if (draggingId) handleDrop(draggingId, r.id); }}
            />
          )}
        </Fragment>
      ))}
      {dropBeforeId === "end" && draggingId && <DropLine />}
    </div>
  );
}

// ── Update payload type ───────────────────────────────────────────────────────

interface UpdatePayload {
  title: string;
  priority?: ReminderPriority;
  dueAt?: string;
  scope?: ReminderScope;
  assigneeId?: string;
}

// ── ReminderEditRow ───────────────────────────────────────────────────────────

function ReminderEditRow({ reminder, teamMembers, currentUserId, projectId, onSave, onCancel }: {
  reminder: Reminder; teamMembers: User[]; currentUserId: string; projectId?: string;
  onSave: (id: string, u: UpdatePayload) => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(reminder.title);
  const [priority, setPriority] = useState<ReminderPriority | undefined>(reminder.priority);
  const [scope, setScope] = useState<ReminderScope>(reminder.scope ?? "personal");
  const [assigneeId, setAssigneeId] = useState<string | undefined>(reminder.assigneeId);
  const [selDate, setSelDate] = useState<string | undefined>(reminder.dueAt ? isoToLocalDate(reminder.dueAt) : undefined);
  const [selTime, setSelTime] = useState(reminder.dueAt && hasExplicitTime(reminder.dueAt) ? isoToLocalTime(reminder.dueAt) : "");
  const [showTime, setShowTime] = useState(!!reminder.dueAt && hasExplicitTime(reminder.dueAt));
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const accentColor = scope === "lab" ? LIST_COLORS.lab : LIST_COLORS.personal;
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function save() {
    if (!title.trim()) { onCancel(); return; }
    onSave(reminder.id, { title: title.trim(), priority, dueAt: selDate ? makeDueAt(selDate, selTime) : undefined, scope, assigneeId });
  }
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  }
  function handleContainerBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (rowRef.current?.contains(e.relatedTarget as Node)) return;
    save();
  }

  const pillBase = (active: boolean, color: string): React.CSSProperties => ({ height: 26, paddingInline: 10, borderRadius: 20, border: "1.5px solid", borderColor: active ? color : "var(--color-border)", backgroundColor: active ? `${color}18` : "transparent", color: active ? color : "var(--color-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-roboto)" });

  return (
    <div ref={rowRef} onBlur={handleContainerBlur} style={{ borderBottom: "1px solid var(--color-border)", backgroundColor: `${accentColor}07` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px 6px" }}>
        <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, border: `2px solid ${accentColor}`, opacity: 0.4 }} />
        <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)} onKeyDown={handleKeyDown}
          style={{ flex: 1, border: "none", outline: "none", fontSize: 15, fontFamily: "var(--font-roboto)", backgroundColor: "transparent", color: "var(--color-body)" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px 6px 50px", flexWrap: "wrap" }}>
        {/* Scope toggle */}
        {(["personal","lab"] as const).map(s => (
          <button key={s} onClick={() => setScope(s)} style={{ ...pillBase(scope === s, LIST_COLORS[s]), fontWeight: scope === s ? 700 : 400 }}>
            {s === "personal" ? "Personal" : "Lab"}
          </button>
        ))}
        <div style={{ width: 1, height: 16, backgroundColor: "var(--color-border)" }} />
        {/* Priority */}
        {(["low","medium","high"] as ReminderPriority[]).map(p => (
          <button key={p} onClick={() => setPriority(priority === p ? undefined : p)} style={{ ...pillBase(priority === p, accentColor), fontWeight: 800, letterSpacing: "-0.5px" }}>
            {PRIORITY_MARKS[p]}
          </button>
        ))}
        <div style={{ width: 1, height: 16, backgroundColor: "var(--color-border)" }} />
        {/* Date/time */}
        <DateTimeFields selDate={selDate} selTime={selTime} showTime={showTime} accentColor={accentColor}
          onDateChange={setSelDate} onTimeChange={setSelTime} onToggleTime={() => setShowTime(v => !v)}
          onRefocus={() => inputRef.current?.focus()} />
      </div>
      {/* Assignee row */}
      {teamMembers.length > 0 && (
        <div style={{ padding: "0 16px 11px 50px" }}>
          <AssigneePicker value={assigneeId} teamMembers={teamMembers} accentColor={accentColor} onChange={setAssigneeId} />
        </div>
      )}
      {!teamMembers.length && <div style={{ height: 5 }} />}
      <div style={{ padding: "2px 16px 8px 50px" }}>
        <span style={{ fontSize: 11, color: "var(--color-secondary)", fontFamily: "var(--font-roboto)", opacity: 0.6 }}>Enter to save · Esc to cancel</span>
      </div>
    </div>
  );
}

// ── InlineAddRow ──────────────────────────────────────────────────────────────

function InlineAddRow({ defaultScope, accentColor, teamMembers, onAdd, onClose }: {
  defaultScope: ReminderScope; accentColor: string; teamMembers: User[];
  onAdd: (title: string, scope: ReminderScope, priority?: ReminderPriority, dueAt?: string, assigneeId?: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState<ReminderScope>(defaultScope);
  const [priority, setPriority] = useState<ReminderPriority | undefined>();
  const [assigneeId, setAssigneeId] = useState<string | undefined>();
  const [selDate, setSelDate] = useState<string | undefined>();
  const [selTime, setSelTime] = useState("");
  const [showTime, setShowTime] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const circleColor = scope === "lab" ? LIST_COLORS.lab : LIST_COLORS.personal;
  useEffect(() => { inputRef.current?.focus(); }, []);

  function resolveDueAt() { return selDate ? makeDueAt(selDate, selTime) : makeTodayDueAt(); }

  function commit() {
    if (!title.trim()) return;
    onAdd(title.trim(), scope, priority, resolveDueAt(), assigneeId);
    setTitle(""); setPriority(undefined); setAssigneeId(undefined); setSelDate(undefined); setSelTime(""); setShowTime(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { if (title) setTitle(""); else onClose(); }
  }
  function handleContainerBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (rowRef.current?.contains(e.relatedTarget as Node)) return;
    if (title.trim()) onAdd(title.trim(), scope, priority, resolveDueAt(), assigneeId);
    onClose();
  }

  const pillBase = (active: boolean, color: string): React.CSSProperties => ({ height: 26, paddingInline: 10, borderRadius: 20, border: "1.5px solid", borderColor: active ? color : "var(--color-border)", backgroundColor: active ? `${color}18` : "transparent", color: active ? color : "var(--color-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-roboto)" });

  return (
    <div ref={rowRef} onBlur={handleContainerBlur} style={{ borderTop: "1px solid var(--color-border)", backgroundColor: `${accentColor}07` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px 6px" }}>
        <div style={{ width: 16, flexShrink: 0 }} />
        <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, border: `2px solid ${circleColor}`, opacity: 0.4 }} />
        <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="New Reminder"
          style={{ flex: 1, border: "none", outline: "none", fontSize: 15, fontFamily: "var(--font-roboto)", backgroundColor: "transparent", color: "var(--color-body)" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px 6px 60px", flexWrap: "wrap" }}>
        {(["personal","lab"] as const).map(s => (
          <button key={s} onClick={() => setScope(s)} style={{ ...pillBase(scope === s, LIST_COLORS[s]), fontWeight: scope === s ? 700 : 400 }}>
            {s === "personal" ? "Personal" : "Lab"}
          </button>
        ))}
        <div style={{ width: 1, height: 16, backgroundColor: "var(--color-border)" }} />
        {(["low","medium","high"] as ReminderPriority[]).map(p => (
          <button key={p} onClick={() => setPriority(priority === p ? undefined : p)} style={{ ...pillBase(priority === p, accentColor), fontWeight: 800, letterSpacing: "-0.5px" }}>
            {PRIORITY_MARKS[p]}
          </button>
        ))}
        <div style={{ width: 1, height: 16, backgroundColor: "var(--color-border)" }} />
        <DateTimeFields selDate={selDate} selTime={selTime} showTime={showTime} accentColor={accentColor}
          onDateChange={setSelDate} onTimeChange={setSelTime} onToggleTime={() => setShowTime(v => !v)}
          onRefocus={() => inputRef.current?.focus()} />
      </div>
      {teamMembers.length > 0 && (
        <div style={{ padding: "0 16px 10px 60px" }}>
          <AssigneePicker value={assigneeId} teamMembers={teamMembers} accentColor={accentColor} onChange={setAssigneeId} />
        </div>
      )}
      {!teamMembers.length && <div style={{ height: 5 }} />}
    </div>
  );
}

// ── Compact nav row (replaces tall SmartListCard tiles) ──────────────────────


// ── Card wrapper ──────────────────────────────────────────────────────────────

interface CardProps {
  items: Reminder[]; completedItems: Reminder[]; showCompleted: boolean;
  isDraggable: boolean; accentColor: string;
  currentUserId: string; teamMembers: User[]; editingId: string | null;
  isAdding: boolean; selectedList: ListType; projectId?: string;
  onComplete: (id: string) => void; onDelete: (id: string) => void; onEdit: (id: string) => void;
  onSave: (id: string, u: UpdatePayload) => void; onCancelEdit: () => void;
  onAdd: (title: string, scope: ReminderScope, priority?: ReminderPriority, dueAt?: string, assigneeId?: string) => void;
  onToggleAdd: () => void; onToggleCompleted: () => void; onUncomplete: (id: string) => void;
  onReorder: (fromId: string, beforeId: string | "end", items: Reminder[]) => void;
  onReschedule?: (id: string, newDueAt: string | null) => void;
  hideAddRow?: boolean;
  showScopeHint?: boolean;
}

function ReminderCard(props: CardProps) {
  const { items, completedItems, showCompleted, isDraggable, accentColor, currentUserId, teamMembers, editingId, isAdding, selectedList, projectId, showScopeHint, onComplete, onDelete, onEdit, onSave, onCancelEdit, onAdd, onToggleAdd, onToggleCompleted, onUncomplete, onReorder, hideAddRow } = props;
  return (
    <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
      <DraggableList items={items} isDraggable={isDraggable} accentColor={accentColor} currentUserId={currentUserId} teamMembers={teamMembers} editingId={editingId} showScopeHint={showScopeHint} onComplete={onComplete} onDelete={onDelete} onEdit={onEdit} onSave={onSave} onCancelEdit={onCancelEdit} onReorder={onReorder} projectId={projectId} />

      {!hideAddRow && (
        isAdding ? (
          <InlineAddRow defaultScope={getDefaultScope(selectedList)} accentColor={accentColor} teamMembers={teamMembers} onAdd={onAdd} onClose={onToggleAdd} />
        ) : (
          <button onClick={onToggleAdd}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontSize: 14, fontFamily: "var(--font-roboto)", borderTop: items.length > 0 ? "1px solid var(--color-border)" : "none" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(0,0,0,0.02)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}>
            <Plus size={15} color={accentColor} />
            <span style={{ color: accentColor, fontWeight: 500 }}>New Reminder</span>
          </button>
        )
      )}

      {completedItems.length > 0 && (
        <div style={{ borderTop: "1px solid var(--color-border)" }}>
          <button onClick={onToggleCompleted} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 16px", background: "none", border: "none", cursor: "pointer" }}>
            <span style={{ fontSize: 13, color: "var(--color-secondary)", fontFamily: "var(--font-roboto)" }}>{completedItems.length} Completed</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: accentColor, fontFamily: "var(--font-roboto)" }}>{showCompleted ? "Hide" : "Show"}</span>
          </button>
          {showCompleted && completedItems.map(r => (
            <CompletedReminderRow key={r.id} reminder={r} currentUserId={currentUserId} onUncomplete={onUncomplete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drag-to-reschedule components ────────────────────────────────────────────

interface SecItem {
  key: string; label: string; sortKey?: number;
  items: Reminder[]; isSub?: boolean;
  isPastDueHeader?: boolean; dateMs?: number; isNoDate?: boolean;
}

function DroppableZone({ id, isOver, accentColor, children }: { id: string; isOver: boolean; accentColor: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} style={{
      backgroundColor: isOver ? `${accentColor}14` : "transparent",
      borderRadius: 4, transition: "background-color 0.15s",
    }}>
      {children}
    </div>
  );
}

function DndReminderRow({ reminder, ...rowProps }: { reminder: Reminder } & Omit<ReminderRowProps, "onDragStart" | "onDragEnd" | "onDragOver" | "onDrop" | "isDragging" | "isDraggable">) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: reminder.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={{ opacity: isDragging ? 0.25 : 1, touchAction: "none" }}>
      <ReminderRow {...rowProps} reminder={reminder} isDraggable={false} isDragging={isDragging} />
    </div>
  );
}

// ── GroupedView - Apple-density date-grouped layout with reschedule drag ──────

function GroupedView({ includeNoDate, ...props }: CardProps & { includeNoDate: boolean }) {
  const groups = useMemo(() => groupByDate(props.items), [props.items]);
  const sections = useMemo<SecItem[]>(() => {
    const r: SecItem[] = [];
    if (groups.pastDue.length > 0) {
      r.push({ key: "past-due-hdr", label: "Past Due", items: [], isPastDueHeader: true });
      groups.pastDue.forEach(dg => r.push({ key: `pd-${dg.sortKey}`, label: dg.label, sortKey: dg.sortKey, items: dg.items, isSub: true, dateMs: dg.sortKey }));
    }
    if (groups.today.length > 0) r.push({ key: "today", label: "Today", items: groups.today, dateMs: todayStart().getTime() });
    if (groups.tomorrow.length > 0) r.push({ key: "tomorrow", label: "Tomorrow", items: groups.tomorrow, dateMs: tomorrowStart().getTime() });
    groups.future.forEach(dg => r.push({ key: `fut-${dg.sortKey}`, label: dg.label, sortKey: dg.sortKey, items: dg.items, dateMs: dg.sortKey }));
    if (includeNoDate && groups.noDate.length > 0) r.push({ key: "no-date", label: "No Date", items: groups.noDate, isNoDate: true });
    return r;
  }, [groups, includeNoDate]);

  const { accentColor, isAdding, onToggleAdd, completedItems, showCompleted, onToggleCompleted, onUncomplete, currentUserId } = props;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const activeReminder = useMemo(
    () => activeId ? [...props.items, ...props.completedItems].find(r => r.id === activeId) ?? null : null,
    [activeId, props.items, props.completedItems]
  );

  const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null); setOverId(null);
    const { active, over } = event;
    if (!over || !props.onReschedule) return;
    const reminderId = String(active.id);
    const target = sections.find(s => s.key === String(over.id) && !s.isPastDueHeader);
    if (!target) return;
    const reminder = [...props.items, ...props.completedItems].find(r => r.id === reminderId);
    if (!reminder) return;

    let newDueAt: string | null;
    if (target.isNoDate) {
      newDueAt = null;
    } else {
      const d = new Date(target.dateMs!);
      let h = 9, m = 0;
      if (reminder.dueAt && hasExplicitTime(reminder.dueAt)) {
        const ex = new Date(reminder.dueAt); h = ex.getHours(); m = ex.getMinutes();
      }
      const yy = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(h).padStart(2, "0");
      const mi = String(m).padStart(2, "0");
      newDueAt = new Date(`${yy}-${mo}-${dd}T${hh}:${mi}`).toISOString();
    }
    props.onReschedule(reminderId, newDueAt);
  }

  const hdrStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: "var(--color-secondary)",
    letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: "var(--font-roboto)"
  };
  const subStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 500, color: "var(--color-secondary)", opacity: 0.65, fontFamily: "var(--font-roboto)"
  };

  function renderRows(items: Reminder[], isPastDue?: boolean) {
    return items.map(r => (
      <Fragment key={r.id}>
        {props.editingId === r.id ? (
          <ReminderEditRow reminder={r} teamMembers={props.teamMembers} currentUserId={props.currentUserId} projectId={props.projectId} onSave={props.onSave} onCancel={props.onCancelEdit} />
        ) : (
          <DndReminderRow reminder={r} currentUserId={props.currentUserId} teamMembers={props.teamMembers} showScopeHint={props.showScopeHint} isPastDue={isPastDue} onComplete={props.onComplete} onDelete={props.onDelete} onEdit={() => props.onEdit(r.id)} />
        )}
      </Fragment>
    ));
  }

  return (
    <DndContext sensors={sensors}
      onDragStart={e => setActiveId(String(e.active.id))}
      onDragOver={e => setOverId(e.over ? String(e.over.id) : null)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveId(null); setOverId(null); }}>

      <div style={{ paddingBottom: 24 }}>
        {(() => {
          let inPastDueBlock = false;
          return sections.map((sec, idx) => {
            if (sec.isPastDueHeader) { inPastDueBlock = true; }
            else if (!sec.isSub) { inPastDueBlock = false; }
            const isPastDueSection = inPastDueBlock && !sec.isPastDueHeader;
            return (
              <Fragment key={sec.key}>
                <div style={{
                  paddingTop: idx === 0 ? 10 : (sec.isSub ? 8 : 14),
                  paddingBottom: 3,
                  paddingLeft: sec.isSub ? 24 : 16,
                  paddingRight: 16,
                }}>
                  <span style={sec.isSub ? subStyle : hdrStyle}>{sec.label}</span>
                </div>
                {!sec.isPastDueHeader && (
                  <DroppableZone id={sec.key} isOver={!!activeId && overId === sec.key} accentColor={accentColor}>
                    {renderRows(sec.items, isPastDueSection)}
                  </DroppableZone>
                )}
              </Fragment>
            );
          });
        })()}

        <div>
          {isAdding ? (
            <InlineAddRow defaultScope={getDefaultScope(props.selectedList)} accentColor={accentColor} teamMembers={props.teamMembers} onAdd={props.onAdd} onClose={onToggleAdd} />
          ) : (
            <button onClick={onToggleAdd}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", background: "none", border: "none", borderTop: sections.length > 0 ? "1px solid var(--color-border)" : "none", cursor: "pointer", fontSize: 14, fontFamily: "var(--font-roboto)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(0,0,0,0.02)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}>
              <Plus size={15} color={accentColor} />
              <span style={{ color: accentColor, fontWeight: 500 }}>New Reminder</span>
            </button>
          )}
          {completedItems.length > 0 && (
            <div style={{ borderTop: "1px solid var(--color-border)" }}>
              <button onClick={onToggleCompleted} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 16px", background: "none", border: "none", cursor: "pointer" }}>
                <span style={{ fontSize: 13, color: "var(--color-secondary)", fontFamily: "var(--font-roboto)" }}>{completedItems.length} Completed</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: accentColor, fontFamily: "var(--font-roboto)" }}>{showCompleted ? "Hide" : "Show"}</span>
              </button>
              {showCompleted && completedItems.map(r => <CompletedReminderRow key={r.id} reminder={r} currentUserId={currentUserId} onUncomplete={onUncomplete} />)}
            </div>
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={prefersReducedMotion ? null : { duration: 150, easing: "ease" }}>
        {activeReminder && (
          <div style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.15)", borderRadius: 4, backgroundColor: "var(--color-surface)", opacity: 0.96 }}>
            <ReminderRow reminder={activeReminder} isDraggable={false} currentUserId={props.currentUserId} teamMembers={props.teamMembers} showScopeHint={props.showScopeHint} onComplete={() => {}} onDelete={() => {}} onEdit={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ── UndoToast ─────────────────────────────────────────────────────────────────

function UndoToast({ title, onUndo }: { title: string; onUndo: () => void }) {
  return (
    <>
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>
      <div role="status" aria-live="polite" style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", backgroundColor: "#1B2E4B", color: "#fff", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.22)", zIndex: 200, fontSize: 13, fontFamily: "var(--font-roboto)", whiteSpace: "nowrap", animation: "toastIn 0.18s ease" }}>
        <Check size={13} color="rgba(255,255,255,0.7)" />
        <span style={{ color: "rgba(255,255,255,0.85)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        <button onClick={onUndo} style={{ background: "rgba(255,255,255,0.18)", border: "none", borderRadius: 6, padding: "4px 10px", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-roboto)" }}>Undo</button>
      </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface PendingUndo { reminder: Reminder; timerId: ReturnType<typeof setTimeout>; }

export default function RemindersPage() {
  const { show: showUndoToast } = useUndoToast();
  const { projectId, activeScope, subProjectId, subProjects, isLoading: projectLoading } = useProject();
  const [currentUserId, setCurrentUserId] = useState("");
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedList, setSelectedList] = useState<ListType>("all");
  const [selectedSubProjectId, setSelectedSubProjectId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("reminders_sidebar_collapsed") === "true"; } catch { return false; }
  });
  function handleToggleCollapse() {
    setSidebarCollapsed(v => {
      const next = !v;
      try { localStorage.setItem("reminders_sidebar_collapsed", String(next)); } catch {}
      return next;
    });
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      try { const s = localStorage.getItem("canopy_user"); if (s) setCurrentUserId(JSON.parse(s).id ?? "demo"); } catch { /* ignore */ }
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => { if (session?.user) setCurrentUserId(session.user.id); });
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    if (isSupabaseConfigured && projectLoading) return;

    async function load() {
      setLoading(true);
      if (!isSupabaseConfigured) { setLoading(false); return; }

      if (projectId) {
        const { data: members } = await supabase
          .from("team_members")
          .select("user_id, role, user_profiles(name, avatar_color, avatar_initials, avatar_url)")
          .eq("project_id", projectId);
        if (members) {
          const { computeInitials } = await import("@/lib/utils");
          setTeamMembers(members.map(row => {
            const p = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
            const profile = p as Record<string, string> | null;
            const name = profile?.name ?? "Team Member";
            return { id: row.user_id as string, name, email: "", role: (row.role ?? "researcher") as User["role"], avatarColor: profile?.avatar_color ?? "#B4D4E3", avatarInitials: computeInitials(name) || (profile?.avatar_initials ?? "??"), avatarUrl: profile?.avatar_url ?? undefined };
          }));
        }
      }

      // Fetch reminders: own, assigned, or lab-scope within current project.
      const projectFilter = projectId ? `,and(scope.eq.lab,project_id.eq.${projectId})` : "";
      const { data, error } = await supabase
        .from("reminders")
        .select("*")
        .or(`user_id.eq.${currentUserId},assignee_id.eq.${currentUserId}${projectFilter}`)
        .order("position", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });

      if (error) console.error("[Reminders] fetch:", error);
      if (data) {
        setReminders(data.map(row => ({
          id: row.id as string, userId: row.user_id as string,
          projectId: (row.project_id as string) ?? undefined,
          subProjectId: (row.sub_project_id as string) ?? undefined,
          scope: (row.scope as ReminderScope) ?? "personal",
          title: row.title as string,
          dueAt: (row.due_at as string) ?? undefined,
          linkedTaskId: (row.linked_task_id as string) ?? undefined,
          linkedEventId: (row.linked_event_id as string) ?? undefined,
          emailEnabled: (row.email_enabled as boolean) ?? false,
          sent: (row.sent as boolean) ?? false,
          completed: (row.completed as boolean) ?? false,
          priority: (row.priority as ReminderPriority) ?? undefined,
          recurrence: (row.recurrence as Reminder["recurrence"]) ?? undefined,
          createdAt: row.created_at as string,
          position: (row.position as number) ?? undefined,
          assigneeId: (row.assignee_id as string) ?? undefined,
        })));
      }
      setLoading(false);
    }
    load();
  }, [currentUserId, projectId, projectLoading]);

  // Realtime subscription: pick up lab reminders created/updated by other members
  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || !currentUserId) return;
    const channel = supabase
      .channel(`reminders:project:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reminders", filter: `project_id=eq.${projectId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new;
            // avoid duplication for own inserts (already added optimistically)
            if ((row.user_id as string) === currentUserId) return;
            setReminders((prev) => {
              if (prev.some((r) => r.id === row.id)) return prev;
              return [...prev, {
                id: row.id as string, userId: row.user_id as string,
                projectId: (row.project_id as string) ?? undefined,
                subProjectId: (row.sub_project_id as string) ?? undefined,
                scope: (row.scope as ReminderScope) ?? "personal",
                title: row.title as string,
                dueAt: (row.due_at as string) ?? undefined,
                linkedTaskId: (row.linked_task_id as string) ?? undefined,
                linkedEventId: (row.linked_event_id as string) ?? undefined,
                emailEnabled: (row.email_enabled as boolean) ?? false,
                sent: (row.sent as boolean) ?? false,
                completed: (row.completed as boolean) ?? false,
                priority: (row.priority as ReminderPriority) ?? undefined,
                recurrence: (row.recurrence as Reminder["recurrence"]) ?? undefined,
                createdAt: row.created_at as string,
                position: (row.position as number) ?? undefined,
                assigneeId: (row.assignee_id as string) ?? undefined,
              }];
            });
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new;
            setReminders((prev) => prev.map((r) => r.id !== row.id ? r : {
              ...r,
              title: row.title as string,
              dueAt: (row.due_at as string) ?? undefined,
              completed: (row.completed as boolean) ?? false,
              priority: (row.priority as ReminderPriority) ?? undefined,
              assigneeId: (row.assignee_id as string) ?? undefined,
              scope: (row.scope as ReminderScope) ?? r.scope,
              projectId: (row.project_id as string) ?? undefined,
              subProjectId: (row.sub_project_id as string) ?? undefined,
              linkedTaskId: (row.linked_task_id as string) ?? undefined,
              linkedEventId: (row.linked_event_id as string) ?? undefined,
              emailEnabled: (row.email_enabled as boolean) ?? false,
              sent: (row.sent as boolean) ?? false,
              recurrence: (row.recurrence as Reminder["recurrence"]) ?? undefined,
              position: (row.position as number) ?? undefined,
            }));
          } else if (payload.eventType === "DELETE") {
            setReminders((prev) => prev.filter((r) => r.id !== payload.old.id));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isSupabaseConfigured, projectId, currentUserId]);

  function commitDelete(id: string) { if (isSupabaseConfigured) supabase.from("reminders").delete().eq("id", id).then(({ error }) => { if (error) console.error("[Reminders] delete:", error); }); }
  function commitComplete(id: string) { if (isSupabaseConfigured) supabase.from("reminders").update({ completed: true }).eq("id", id).then(({ error }) => { if (error) console.error("[Reminders] complete:", error); }); }

  function handleComplete(id: string) {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;
    if (pendingUndo) { clearTimeout(pendingUndo.timerId); commitComplete(pendingUndo.reminder.id); }
    setReminders(prev => prev.map(r => r.id === id ? { ...r, completed: true } : r));
    const timerId = setTimeout(() => { commitComplete(id); setPendingUndo(null); }, 4000);
    setPendingUndo({ reminder, timerId });
  }
  function handleUndo() {
    if (!pendingUndo) return;
    clearTimeout(pendingUndo.timerId);
    setReminders(prev => prev.map(r => r.id === pendingUndo!.reminder.id ? { ...r, completed: false } : r));
    setPendingUndo(null);
  }
  async function handleUncomplete(id: string) {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, completed: false } : r));
    if (isSupabaseConfigured) { const { error } = await supabase.from("reminders").update({ completed: false }).eq("id", id); if (error) console.error("[Reminders] uncomplete:", error); }
  }

  async function handleAdd(title: string, scope: ReminderScope, priority?: ReminderPriority, dueAt?: string, assigneeId?: string) {
    // When the rail is in project mode, always save as project scope.
    // Otherwise, respect whatever the user's scope toggle shows.
    const effectiveScope: ReminderScope = activeScope === "project" ? "project" : scope;
    const now = Date.now();
    const tempId = crypto.randomUUID();
    const newReminder: Reminder = {
      id: tempId, userId: currentUserId,
      projectId: effectiveScope !== "personal" ? (projectId ?? undefined) : undefined,
      subProjectId: effectiveScope === "project" ? (selectedSubProjectId ?? subProjectId ?? undefined) : undefined,
      scope: effectiveScope, title, priority, dueAt, assigneeId,
      emailEnabled: false, sent: false, completed: false,
      createdAt: new Date().toISOString(),
      position: now,
    };
    setReminders(prev => [...prev, newReminder]);

    if (isSupabaseConfigured && currentUserId) {
      const { data, error } = await supabase.from("reminders")
        .insert({
          user_id: currentUserId,
          project_id: effectiveScope !== "personal" ? (projectId ?? null) : null,
          sub_project_id: effectiveScope === "project" ? (selectedSubProjectId ?? subProjectId ?? null) : null,
          scope: effectiveScope, title,
          priority: priority ?? null, due_at: dueAt ?? null,
          email_enabled: false, sent: false, completed: false,
          position: now, assignee_id: assigneeId ?? null,
        })
        .select().single();
      if (!error && data) setReminders(prev => prev.map(r => r.id === tempId ? { ...newReminder, id: data.id as string } : r));
      else if (error) console.error("[Reminders] add:", error);
    }
  }

  function handleDelete(id: string) {
    const reminder = reminders.find((r) => r.id === id);
    if (!reminder) return;
    setReminders((prev) => prev.filter((r) => r.id !== id));
    showUndoToast(
      `"${reminder.title}" deleted`,
      () => setReminders((prev) => [...prev, reminder]),
      () => commitDelete(id),
    );
  }

  async function handleUpdate(id: string, updates: UpdatePayload) {
    const newProjectId = updates.scope === "lab" ? (projectId ?? undefined) : undefined;
    setReminders(prev => prev.map(r => r.id === id ? { ...r, ...updates, projectId: newProjectId } : r));
    setEditingId(null);
    if (isSupabaseConfigured) {
      const { error } = await supabase.from("reminders").update({
        title: updates.title,
        priority: updates.priority ?? null,
        due_at: updates.dueAt ?? null,
        scope: updates.scope ?? "personal",
        project_id: newProjectId ?? null,
        assignee_id: updates.assigneeId ?? null,
      }).eq("id", id);
      if (error) console.error("[Reminders] update:", error);
    }
  }

  function handleReorder(fromId: string, beforeId: string | "end", items: Reminder[]) {
    const arr = items.filter(r => r.id !== fromId);
    const insertIdx = beforeId === "end" ? arr.length : arr.findIndex(r => r.id === beforeId);
    const prev = arr[insertIdx - 1];
    const next = arr[insertIdx];
    const newPos = prev && next ? (prev.position! + next.position!) / 2
      : prev ? prev.position! + 1000
      : next ? next.position! - 1000
      : Date.now();
    setReminders(all => all.map(r => r.id === fromId ? { ...r, position: newPos } : r));
    if (isSupabaseConfigured) supabase.from("reminders").update({ position: newPos }).eq("id", fromId).then(({ error }) => { if (error) console.error("[Reminders] reorder:", error); });
  }

  async function handleReschedule(id: string, newDueAt: string | null) {
    const original = reminders.find(r => r.id === id);
    if (!original) return;
    setReminders(prev => prev.map(r => r.id === id ? { ...r, dueAt: newDueAt ?? undefined } : r));
    if (isSupabaseConfigured) {
      const { error } = await supabase.from("reminders").update({ due_at: newDueAt }).eq("id", id);
      if (error) {
        console.error("[Reminders] reschedule:", error);
        setReminders(prev => prev.map(r => r.id === id ? original : r));
      }
    }
  }

  function handleListSelect(list: ListType) { setSelectedList(list); setSelectedSubProjectId(null); setIsAdding(false); setEditingId(null); setShowCompleted(false); }
  function handleSubProjectSelect(id: string) { setSelectedList("project"); setSelectedSubProjectId(id); setIsAdding(false); setEditingId(null); setShowCompleted(false); }

  const allActive = useMemo(() => reminders.filter(r => !r.completed), [reminders]);
  const allCompleted = useMemo(() => reminders.filter(r => r.completed), [reminders]);

  const sidebarCounts = useMemo(() => ({
    all:      allActive.length,
    personal: allActive.filter(r => r.scope === "personal").length,
    lab:      allActive.filter(r => r.scope === "lab").length,
  }), [allActive]);

  const sidebarProjectCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sp of subProjects) {
      map[sp.id] = allActive.filter(r => r.scope === "project" && r.subProjectId === sp.id).length;
    }
    return map;
  }, [allActive, subProjects]);

  const sidebarSections: ScopeSection[] = [
    { id: "all",      label: "All",      color: LIST_COLORS.all,      icon: <List size={17} />,     count: sidebarCounts.all,      isActive: selectedList === "all",      onClick: () => handleListSelect("all") },
    { id: "personal", label: "Personal", color: LIST_COLORS.personal, icon: <UserIcon size={17} />, count: sidebarCounts.personal, isActive: selectedList === "personal", onClick: () => handleListSelect("personal") },
    { id: "lab",      label: "Lab",      color: LIST_COLORS.lab,      icon: <Users size={17} />,    count: sidebarCounts.lab,      isActive: selectedList === "lab",      onClick: () => handleListSelect("lab") },
  ];

  const sidebarExtraContent = subProjects.length > 0 ? (
    <>
      <div style={{ height: 1, backgroundColor: "var(--color-border)", margin: "5px 2px" }} />
      <p style={{ fontSize: 10, fontWeight: 700, color: "var(--color-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "3px 11px 4px", margin: 0 }}>Projects</p>
      {subProjects.map(sp => {
        const active = selectedList === "project" && selectedSubProjectId === sp.id;
        const c = sp.color ?? LIST_COLORS.project;
        return (
          <button
            key={sp.id}
            onClick={() => handleSubProjectSelect(sp.id)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px 6px 11px", borderRadius: 7,
              border: "none", borderLeft: `3px solid ${active ? c : "transparent"}`,
              cursor: "pointer", backgroundColor: active ? `${c}18` : "transparent",
              marginBottom: 1, transition: "background-color 120ms ease, border-left-color 120ms ease",
              textAlign: "left", boxSizing: "border-box", fontFamily: "var(--font-roboto)",
            }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(0,0,0,0.04)"; }}
            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
          >
            <span style={{ flex: 1, fontSize: 13, color: active ? c : "var(--color-body)", fontWeight: active ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {sp.name}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: active ? c : "var(--color-secondary)", backgroundColor: active ? `${c}20` : "rgba(0,0,0,0.06)", borderRadius: 10, padding: "1px 7px", flexShrink: 0, minWidth: 20, textAlign: "center" }}>
              {sidebarProjectCounts[sp.id] ?? 0}
            </span>
          </button>
        );
      })}
    </>
  ) : null;

  const isLabHome = activeScope === "lab";
  const effectiveList: ListType = isLabHome ? selectedList : (activeScope === "project" ? "project" : "personal");
  const effectiveSubProjectId: string | null = isLabHome ? selectedSubProjectId : (activeScope === "project" ? (subProjectId ?? null) : null);

  const visible = useMemo(() => {
    const filtered = filterReminders(effectiveList, allActive, effectiveSubProjectId);
    if (DRAGGABLE_LISTS.includes(effectiveList)) return sortByPosition(filtered);
    return sortByDate(filtered);
  }, [effectiveList, effectiveSubProjectId, allActive]);

  const completedVisible = useMemo(() => filterReminders(effectiveList, allCompleted, effectiveSubProjectId), [effectiveList, effectiveSubProjectId, allCompleted]);

  const activeSubProject = effectiveList === "project" && effectiveSubProjectId
    ? subProjects.find(sp => sp.id === effectiveSubProjectId) ?? null
    : null;
  const panelColor = activeSubProject?.color ?? LIST_COLORS[effectiveList];
  const panelLabel = activeSubProject?.name ?? LIST_LABELS[effectiveList];
  const isDraggable = DRAGGABLE_LISTS.includes(effectiveList);

  if (loading || (isSupabaseConfigured && projectLoading)) {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "var(--color-canvas)" }}>
        <div style={{ width: 28, height: 28, border: "3px solid var(--color-border)", borderTopColor: "var(--color-navy)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const cardProps: CardProps = {
    items: visible, completedItems: completedVisible, showCompleted,
    isDraggable, accentColor: panelColor,
    currentUserId, teamMembers, editingId, isAdding, selectedList,
    projectId: projectId ?? undefined,
    showScopeHint: effectiveList === "all",
    onComplete: handleComplete, onDelete: handleDelete, onEdit: setEditingId,
    onSave: handleUpdate, onCancelEdit: () => setEditingId(null),
    onAdd: handleAdd, onToggleAdd: () => setIsAdding(v => !v),
    onToggleCompleted: () => setShowCompleted(v => !v),
    onUncomplete: handleUncomplete, onReorder: handleReorder,
    onReschedule: handleReschedule,
  };

  return (
    <ClientOnly>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", backgroundColor: "var(--color-canvas)" }}>

        <PageHeader
          title="Reminders"
          badge={
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", backgroundColor: `${panelColor}1a`, color: panelColor, padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
              {panelLabel}
            </span>
          }
        />

        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {isLabHome && (
            <div className="hidden md:flex" style={{ height: "100%", flexShrink: 0 }}>
              <ScopeSidebar
                storageKey="reminders_sidebar"
                sections={sidebarSections}
                extraContent={sidebarExtraContent}
                collapsed={sidebarCollapsed}
                onToggleCollapse={handleToggleCollapse}
                headerLabel="Filters"
              />
            </div>
          )}

          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

            {isLabHome && (
              <div className="flex md:hidden" style={{ overflowX: "auto", padding: "12px 16px", gap: 8, borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
                {(["all","personal","lab"] as ListType[]).map(id => {
                  const isAct = selectedList === id && !selectedSubProjectId;
                  return <button key={id} onClick={() => handleListSelect(id)} style={{ height: 32, paddingInline: 14, borderRadius: 20, flexShrink: 0, border: "none", backgroundColor: isAct ? LIST_COLORS[id] : "var(--color-dimmed-bg)", color: isAct ? "#fff" : "var(--color-secondary)", fontSize: 13, fontWeight: isAct ? 700 : 400, cursor: "pointer", fontFamily: "var(--font-roboto)" }}>{LIST_LABELS[id]}</button>;
                })}
                {subProjects.map(sp => {
                  const isAct = selectedList === "project" && selectedSubProjectId === sp.id;
                  return <button key={sp.id} onClick={() => handleSubProjectSelect(sp.id)} style={{ height: 32, paddingInline: 14, borderRadius: 20, flexShrink: 0, border: "none", backgroundColor: isAct ? (sp.color ?? LIST_COLORS.project) : "var(--color-dimmed-bg)", color: isAct ? "#fff" : "var(--color-secondary)", fontSize: 13, fontWeight: isAct ? 700 : 400, cursor: "pointer", fontFamily: "var(--font-roboto)" }}>{sp.name}</button>;
                })}
              </div>
            )}

            <div style={{ flex: 1, overflowY: "auto" }}>
              {visible.length > 0 || isAdding || completedVisible.length > 0 ? (
                <GroupedView {...cardProps} includeNoDate={true} />
              ) : (
                <EmptyState panelColor={panelColor} onAdd={() => setIsAdding(true)} />
              )}
            </div>
          </div>
        </div>
      </div>

      {pendingUndo && <UndoToast title={pendingUndo.reminder.title} onUndo={handleUndo} />}
    </ClientOnly>
  );
}

function EmptyState({ panelColor, onAdd }: { panelColor: string; onAdd: () => void }) {
  return (
    <div style={{ margin: "0 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 16px", textAlign: "center", gap: 12 }}>
        <svg width="64" height="52" viewBox="0 0 80 64" fill="none" aria-hidden="true" style={{ opacity: 0.65 }}>
          <circle cx="40" cy="28" r="18" stroke="var(--color-border)" strokeWidth="1.5" fill="var(--color-canvas)" />
          <path d="M40 18v10l6 4" stroke={panelColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
          <path d="M32 47c2.5 2 5 3 8 3s5.5-1 8-3" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="40" cy="12" r="2" fill="var(--color-border)" />
        </svg>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", margin: "0 0 4px" }}>No reminders here</p>
          <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>Set one to stay on top of what matters.</p>
        </div>
        <button onClick={onAdd} style={{ display: "flex", alignItems: "center", gap: 6, height: 34, paddingInline: 16, backgroundColor: panelColor, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <Plus size={13} /> New Reminder
        </button>
      </div>
    </div>
  );
}
