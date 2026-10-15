"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Calendar, Users, Send, Clock, Check, X, Plus,
  Lock, Trash2, ChevronLeft, ChevronRight, AlertCircle,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import { computeInitials } from "@/lib/utils";
import type {
  User, WeeklyAvailability, MeetingProposal, MeetingResponse,
  ScheduleEvent, MeetingResponseStatus, SubProject, UserSettings,
} from "@/types";
import AvailabilityGrid from "@/components/scheduling/AvailabilityGrid";
import TeamOverlapView from "@/components/scheduling/TeamOverlapView";
import MeetingProposalModal from "@/components/scheduling/MeetingProposalModal";
import Avatar from "@/components/ui/Avatar";
import ClientOnly from "@/components/ui/ClientOnly";
import { TimePicker, formatTimeDisplay } from "@/components/ui/DateTimePicker";
import ScopeSidebar, { type ScopeSection } from "@/components/ui/ScopeSidebar";
import PageHeader from "@/components/ui/PageHeader";

// Sentinel UUID stored in user_availability.sub_project_id to mean "Lab-wide"
// (NULL can't be used because two NULLs aren't treated as equal by the unique constraint)
const LAB_AVAILABILITY_ID = "00000000-0000-0000-0000-000000000000";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatProposedDate(date: string, time: string): string {
  const d = new Date(`${date}T${time}`);
  return (
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
    " at " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const STATUS_COLORS: Record<MeetingResponseStatus, { bg: string; text: string }> = {
  pending:  { bg: "#FEF3C7", text: "#92400E" },
  accepted: { bg: "#D1FAE5", text: "#065F46" },
  declined: { bg: "#FEE2E2", text: "#991B1B" },
};

const STATUS_LABELS: Record<MeetingResponseStatus, string> = {
  pending:  "Pending",
  accepted: "Accepted",
  declined: "Declined",
};

// ── Shared primitives ─────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between px-5 py-4"
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      <h3
        style={{
          fontFamily: "var(--font-lora)",
          fontWeight: 600,
          fontSize: 15,
          color: "var(--color-navy)",
          margin: 0,
        }}
      >
        {title}
      </h3>
      {action}
    </div>
  );
}

function EmptyState({ icon: Icon, heading, body, action }: {
  icon: React.ElementType;
  heading: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-10 flex flex-col items-center text-center gap-2">
      <Icon size={32} style={{ color: "var(--color-border)" }} />
      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>{heading}</p>
      {body && <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>{body}</p>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

// ── Tab: Calendar ─────────────────────────────────────────────────────────────

type CalView = "day" | "week" | "month" | "year";

const HOUR_H = 56;
const DAY_START_H = 7;
const DAY_END_H = 22;
const TOTAL_HOURS = DAY_END_H - DAY_START_H;
const MONTH_NAMES_CAL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_HDR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

interface CalEvent {
  id: string;
  title: string;
  date: string;
  startMin: number | null;
  endMin: number | null;
  color: string;
  bgColor: string;
  type: "lab" | "personal" | "meeting";
  isScheduleEvent: boolean;
  ownerId: string;
}

interface LayoutEvent extends CalEvent {
  col: number;
  totalCols: number;
}

function toCalEvents(events: ScheduleEvent[], proposals: MeetingProposal[]): CalEvent[] {
  const result: CalEvent[] = [];
  for (const e of events) {
    let startMin: number | null = null;
    let endMin: number | null = null;
    if (e.time) {
      const [h, m] = e.time.split(":").map(Number);
      startMin = h * 60 + m;
      endMin = startMin + 60;
    }
    result.push({
      id: e.id, title: e.title, date: e.date, startMin, endMin,
      color: e.scope === "lab" ? "var(--color-navy)" : "var(--color-secondary)",
      bgColor: "var(--color-navy-dim)",
      type: e.scope === "personal" ? "personal" : "lab",
      isScheduleEvent: true, ownerId: e.createdBy,
    });
  }
  for (const p of proposals) {
    if (!p.proposedTime) continue;
    const [h, m] = p.proposedTime.split(":").map(Number);
    const startMin = h * 60 + m;
    result.push({
      id: p.id, title: p.title, date: p.proposedDate, startMin, endMin: startMin + p.durationMinutes,
      color: "var(--color-success)", bgColor: "var(--color-navy-dim)",
      type: "meeting", isScheduleEvent: false, ownerId: p.proposerId,
    });
  }
  return result;
}

function layoutDayEvents(dayEvents: CalEvent[]): LayoutEvent[] {
  const timed = dayEvents.filter(e => e.startMin !== null).sort((a, b) => a.startMin! - b.startMin!);
  if (timed.length === 0) return [];
  const colEnds: number[] = [];
  const assigned = timed.map(ev => {
    let c = 0;
    while (c < colEnds.length && colEnds[c] > ev.startMin!) c++;
    colEnds[c] = ev.endMin!;
    return c;
  });
  const maxCols = Math.max(...assigned) + 1;
  return timed.map((ev, i) => ({ ...ev, col: assigned[i], totalCols: maxCols }));
}

function makeDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function getWeekStart(d: Date): Date {
  const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r;
}

function minToTimeStr(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function CalendarTab({
  events, proposals, currentUserId, projectId, onAddEvent, onDeleteEvent,
}: {
  events: ScheduleEvent[];
  proposals: MeetingProposal[];
  currentUserId: string;
  projectId: string;
  onAddEvent: (e: Omit<ScheduleEvent, "id">) => void;
  onDeleteEvent: (id: string) => void;
}) {
  const today = new Date();
  const todayStr = makeDateStr(today);

  const [view, setView] = useState<CalView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [showForm, setShowForm] = useState(false);
  const [formDate, setFormDate] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formScope, setFormScope] = useState<"lab" | "personal">("lab");
  const [formError, setFormError] = useState("");
  const [detailEvent, setDetailEvent] = useState<CalEvent | null>(null);
  const [showTP, setShowTP] = useState(false);
  const [tpPos, setTpPos] = useState<{ top: number; left: number } | null>(null);
  const timeBtnRef = useRef<HTMLButtonElement>(null);

  const calEvents = useMemo(() => toCalEvents(events, proposals), [events, proposals]);

  function navigate(dir: 1 | -1) {
    const d = new Date(anchor);
    if (view === "day") d.setDate(d.getDate() + dir);
    else if (view === "week") d.setDate(d.getDate() + dir * 7);
    else if (view === "month") d.setMonth(d.getMonth() + dir);
    else d.setFullYear(d.getFullYear() + dir);
    setAnchor(d);
  }

  function headerLabel(): string {
    if (view === "day")
      return anchor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (view === "week") {
      const ws = getWeekStart(anchor);
      const we = addDays(ws, 6);
      if (ws.getMonth() === we.getMonth())
        return `${ws.toLocaleDateString("en-US", { month: "long" })} ${ws.getDate()}–${we.getDate()}, ${ws.getFullYear()}`;
      return `${ws.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${we.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    }
    if (view === "month")
      return anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    return String(anchor.getFullYear());
  }

  function openAdd(date: string, startMin?: number) {
    setFormDate(date);
    setFormTime(startMin != null ? minToTimeStr(startMin) : "");
    setFormTitle(""); setFormScope("lab"); setFormError("");
    setShowForm(true); setDetailEvent(null);
  }

  function handleAdd() {
    if (!formTitle.trim()) { setFormError("Enter a title."); return; }
    onAddEvent({ projectId, title: formTitle.trim(), date: formDate, time: formTime || undefined, scope: formScope, createdBy: currentUserId });
    setShowForm(false);
  }

  const inputStyle: React.CSSProperties = {
    height: 36, border: "1px solid var(--color-border)", borderRadius: 6,
    padding: "0 10px", fontSize: 13, fontFamily: "var(--font-roboto)",
    backgroundColor: "var(--color-canvas)", color: "var(--color-body)", outline: "none", boxSizing: "border-box",
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderEventBlock(ev: LayoutEvent) {
    const clampedStart = Math.max(ev.startMin!, DAY_START_H * 60);
    const clampedEnd = Math.min(ev.endMin!, DAY_END_H * 60);
    if (clampedStart >= DAY_END_H * 60 || clampedEnd <= DAY_START_H * 60) return null;
    const top = (clampedStart - DAY_START_H * 60) / 60 * HOUR_H;
    const height = Math.max((clampedEnd - clampedStart) / 60 * HOUR_H, 20);
    const widthPct = 100 / ev.totalCols;
    const leftPct = ev.col * widthPct;
    return (
      <div
        key={ev.id}
        onClick={e => { e.stopPropagation(); setDetailEvent(ev); setShowForm(false); }}
        style={{
          position: "absolute", top, height,
          width: `calc(${widthPct}% - 2px)`,
          left: `calc(${leftPct}% + 1px)`,
          backgroundColor: ev.bgColor, borderLeft: `3px solid ${ev.color}`,
          borderRadius: 4, padding: "2px 5px", overflow: "hidden",
          cursor: "pointer", zIndex: 1, boxSizing: "border-box",
        }}
      >
        <p style={{ fontSize: 10, fontWeight: 600, color: ev.color, margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ev.title}
        </p>
        {height >= 38 && (
          <p style={{ fontSize: 9, color: ev.color, margin: 0, opacity: 0.7 }}>
            {formatTimeDisplay(minToTimeStr(ev.startMin!))}
          </p>
        )}
      </div>
    );
  }

  function renderTimeGrid(days: Date[]) {
    const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => DAY_START_H + i);
    const totalHeight = TOTAL_HOURS * HOUR_H;
    return (
      <div style={{ display: "flex", overflowY: "auto", maxHeight: 580 }}>
        <div style={{ width: 50, flexShrink: 0 }}>
          <div style={{ height: 1 }} />
          {hours.map(h => (
            <div key={h} style={{ height: HOUR_H, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", paddingRight: 8, paddingTop: 3 }}>
              <span style={{ fontSize: 10, color: "var(--color-secondary)", whiteSpace: "nowrap" }}>
                {h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`}
              </span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${days.length}, 1fr)`, borderLeft: "1px solid var(--color-border)" }}>
          {days.map(day => {
            const ds = makeDateStr(day);
            const isToday = ds === todayStr;
            const laidOut = layoutDayEvents(calEvents.filter(e => e.date === ds));
            return (
              <div key={ds} style={{ position: "relative", height: totalHeight, borderRight: "1px solid var(--color-border)", backgroundColor: isToday ? "rgba(27,46,75,0.015)" : "transparent" }}>
                {hours.map(h => (
                  <div
                    key={h}
                    onClick={() => openAdd(ds, h * 60)}
                    style={{ position: "absolute", top: (h - DAY_START_H) * HOUR_H, left: 0, right: 0, height: HOUR_H, borderTop: "1px solid var(--color-border)", cursor: "pointer" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "rgba(27,46,75,0.04)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}
                  />
                ))}
                {isToday && (() => {
                  const now = new Date();
                  const nowMin = now.getHours() * 60 + now.getMinutes();
                  if (nowMin < DAY_START_H * 60 || nowMin > DAY_END_H * 60) return null;
                  const nowTop = (nowMin - DAY_START_H * 60) / 60 * HOUR_H;
                  return <div style={{ position: "absolute", top: nowTop, left: 0, right: 0, height: 2, backgroundColor: "var(--color-error)", zIndex: 2, pointerEvents: "none" }} />;
                })()}
                {laidOut.map(ev => renderEventBlock(ev))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderWeekView() {
    const ws = getWeekStart(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const hasEvents = days.some(d => calEvents.some(e => e.date === makeDateStr(d)));
    return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "50px repeat(7, 1fr)", borderBottom: "1px solid var(--color-border)" }}>
          <div />
          {days.map(day => {
            const ds = makeDateStr(day);
            const isToday = ds === todayStr;
            return (
              <div key={ds} style={{ padding: "6px 0", textAlign: "center", borderLeft: "1px solid var(--color-border)" }}>
                <div style={{ fontSize: 10, color: "var(--color-secondary)", fontWeight: 700, letterSpacing: "0.05em" }}>{DAY_HDR[day.getDay()]}</div>
                <div style={{ fontSize: 18, fontWeight: 700, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", margin: "2px auto 0", borderRadius: "50%", backgroundColor: isToday ? "var(--color-navy)" : "transparent", color: isToday ? "#fff" : "var(--color-body)" }}>
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>
        {hasEvents ? renderTimeGrid(days) : (
          <EmptyState
            icon={Calendar}
            heading="No events scheduled this week"
            body="Click a day header or add one below."
            action={
              <button
                onClick={() => openAdd(makeDateStr(days.find(d => makeDateStr(d) === todayStr) ?? days[0]))}
                style={{ fontSize: 13, fontWeight: 600, padding: "8px 18px", borderRadius: 7, backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", cursor: "pointer" }}>
                + Add Event
              </button>
            }
          />
        )}
      </>
    );
  }

  function renderDayView() {
    const hasEvents = calEvents.some(e => e.date === makeDateStr(anchor));
    return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "50px 1fr", borderBottom: "1px solid var(--color-border)" }}>
          <div />
          <div style={{ padding: "6px 16px", borderLeft: "1px solid var(--color-border)" }}>
            <div style={{ fontSize: 10, color: "var(--color-secondary)", fontWeight: 700, letterSpacing: "0.05em" }}>{DAY_HDR[anchor.getDay()]}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: makeDateStr(anchor) === todayStr ? "var(--color-navy)" : "var(--color-body)" }}>{anchor.getDate()}</div>
          </div>
        </div>
        {hasEvents ? renderTimeGrid([anchor]) : (
          <EmptyState
            icon={Calendar}
            heading="No events today"
            action={
              <button
                onClick={() => openAdd(makeDateStr(anchor))}
                style={{ fontSize: 13, fontWeight: 600, padding: "8px 18px", borderRadius: 7, backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", cursor: "pointer" }}>
                + Add Event
              </button>
            }
          />
        )}
      </>
    );
  }

  function renderMonthView() {
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const startOffset = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    const MAX_CHIPS = 3;
    return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--color-border)" }}>
          {DAY_HDR.map(d => (
            <div key={d} style={{ textAlign: "center", padding: "8px 0", fontSize: 10, fontWeight: 700, color: "var(--color-secondary)", letterSpacing: "0.06em" }}>{d}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {Array.from({ length: totalCells }, (_, i) => {
            const dayNum = i - startOffset + 1;
            const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
            const ds = inMonth ? `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}` : null;
            const isToday = ds === todayStr;
            const dayEvents = ds ? calEvents.filter(e => e.date === ds) : [];
            const overflow = Math.max(0, dayEvents.length - MAX_CHIPS);
            return (
              <div
                key={i}
                onClick={() => { if (ds) openAdd(ds); }}
                style={{ minHeight: 88, borderRight: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)", padding: 4, backgroundColor: inMonth ? "transparent" : "rgba(27,46,75,0.015)", cursor: inMonth ? "pointer" : "default" }}
                onMouseEnter={e => { if (inMonth) (e.currentTarget as HTMLDivElement).style.backgroundColor = "rgba(27,46,75,0.03)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = inMonth ? "transparent" : "rgba(27,46,75,0.015)"; }}
              >
                {inMonth && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", backgroundColor: isToday ? "var(--color-navy)" : "transparent", color: isToday ? "#fff" : "var(--color-body)", marginBottom: 2 }}>
                      {dayNum}
                    </div>
                    {dayEvents.slice(0, MAX_CHIPS).map(ev => (
                      <div key={ev.id} onClick={e => { e.stopPropagation(); setDetailEvent(ev); setShowForm(false); }}
                        style={{ fontSize: 10, fontWeight: 600, color: ev.color, backgroundColor: ev.bgColor, borderRadius: 3, padding: "1px 4px", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>
                        {ev.startMin != null && `${Math.floor(ev.startMin / 60) % 12 || 12}:${String(ev.startMin % 60).padStart(2, "0")} `}{ev.title}
                      </div>
                    ))}
                    {overflow > 0 && <div style={{ fontSize: 10, color: "var(--color-secondary)", paddingLeft: 2 }}>+{overflow} more</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function renderYearView() {
    const year = anchor.getFullYear();
    return (
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
        {MONTH_NAMES_CAL.map((name, mi) => {
          const startOff = new Date(year, mi, 1).getDay();
          const dim = new Date(year, mi + 1, 0).getDate();
          const cells = Math.ceil((startOff + dim) / 7) * 7;
          return (
            <div key={mi}
              onClick={() => { const d = new Date(anchor); d.setMonth(mi); setAnchor(d); setView("month"); }}
              style={{ cursor: "pointer", border: "1px solid var(--color-border)", borderRadius: 8, padding: "8px 8px 6px", backgroundColor: "var(--color-canvas)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-navy)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)"; }}
            >
              <p style={{ fontSize: 11, fontWeight: 700, color: "var(--color-navy)", margin: "0 0 5px 0" }}>{name}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                {"SMTWTFS".split("").map((d, i) => (
                  <div key={i} style={{ fontSize: 6.5, color: "var(--color-secondary)", textAlign: "center", fontWeight: 700, paddingBottom: 1 }}>{d}</div>
                ))}
                {Array.from({ length: cells }, (_, i) => {
                  const dn = i - startOff + 1;
                  const inM = dn >= 1 && dn <= dim;
                  const ds = inM ? `${year}-${String(mi + 1).padStart(2, "0")}-${String(dn).padStart(2, "0")}` : null;
                  const isToday = ds === todayStr;
                  const hasEv = ds ? calEvents.some(e => e.date === ds) : false;
                  return (
                    <div key={i} style={{ fontSize: 7, textAlign: "center", lineHeight: "13px", borderRadius: 2, color: isToday ? "#fff" : inM ? "var(--color-body)" : "transparent", backgroundColor: isToday ? "var(--color-navy)" : hasEv ? "var(--color-navy-dim)" : "transparent" }}>
                      {inM ? dn : ""}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3 flex-wrap gap-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex items-center gap-2">
            <button onClick={() => setAnchor(new Date())}
              style={{ height: 30, paddingInline: 12, border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", backgroundColor: "var(--color-canvas)", color: "var(--color-body)", fontFamily: "var(--font-roboto)" }}>
              Today
            </button>
            <div className="flex">
              <button onClick={() => navigate(-1)} style={{ background: "none", border: "1px solid var(--color-border)", cursor: "pointer", padding: "4px 7px", borderRadius: "6px 0 0 6px", color: "var(--color-secondary)" }}>
                <ChevronLeft size={13} />
              </button>
              <button onClick={() => navigate(1)} style={{ background: "none", border: "1px solid var(--color-border)", borderLeft: "none", cursor: "pointer", padding: "4px 7px", borderRadius: "0 6px 6px 0", color: "var(--color-secondary)" }}>
                <ChevronRight size={13} />
              </button>
            </div>
            <span style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 15, color: "var(--color-navy)" }}>
              {headerLabel()}
            </span>
          </div>
          <div className="flex" style={{ backgroundColor: "var(--color-navy-dim)", borderRadius: 7, padding: 2 }}>
            {(["Day", "Week", "Month", "Year"] as const).map(v => {
              const id = v.toLowerCase() as CalView;
              const active = view === id;
              return (
                <button key={v} onClick={() => setView(id)}
                  style={{ padding: "4px 10px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12, fontWeight: active ? 600 : 400, fontFamily: "var(--font-roboto)", backgroundColor: active ? "var(--color-segment-active)" : "transparent", color: active ? "var(--color-navy)" : "var(--color-secondary)", boxShadow: active ? "0 1px 3px rgba(0,0,0,0.10)" : "none" }}>
                  {v}
                </button>
              );
            })}
          </div>
        </div>

        {view === "week" && <div style={{ overflowX: "auto" }}>{renderWeekView()}</div>}
        {view === "day" && <div style={{ overflowX: "auto" }}>{renderDayView()}</div>}
        {view === "month" && renderMonthView()}
        {view === "year" && <div className="p-4">{renderYearView()}</div>}
      </Card>

      {/* Add event form */}
      {showForm && (
        <Card>
          <SectionHeader
            title={formDate ? `New event · ${new Date(formDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}` : "New event"}
            action={<button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-secondary)", padding: 4 }}><X size={14} /></button>}
          />
          <div className="px-5 py-4 space-y-3">
            <div className="flex gap-1.5">
              {(["lab", "personal"] as const).map(s => (
                <button key={s} onClick={() => setFormScope(s)} style={{ height: 27, paddingInline: 12, borderRadius: 20, border: `1.5px solid ${formScope === s ? "var(--color-navy)" : "var(--color-border)"}`, backgroundColor: formScope === s ? "var(--color-navy)" : "transparent", color: formScope === s ? "#fff" : "var(--color-secondary)", fontSize: 12, fontWeight: formScope === s ? 600 : 400, cursor: "pointer", fontFamily: "var(--font-roboto)" }}>
                  {s === "lab" ? "Lab (visible to all)" : "Personal (only me)"}
                </button>
              ))}
            </div>
            <input autoFocus value={formTitle} onChange={e => { setFormTitle(e.target.value); setFormError(""); }} placeholder="Event title" style={{ ...inputStyle, width: "100%" }} onFocus={e => { e.currentTarget.style.borderColor = "var(--color-navy)"; }} onBlur={e => { e.currentTarget.style.borderColor = "var(--color-border)"; }} />
            <div className="flex items-center gap-2">
              <button ref={timeBtnRef} onClick={() => { if (!timeBtnRef.current) return; const r = timeBtnRef.current.getBoundingClientRect(); setTpPos({ top: r.bottom + 6, left: r.left }); setShowTP(v => !v); }} style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: formTime ? "var(--color-body)" : "var(--color-secondary)", width: "auto", padding: "0 10px" }}>
                {formTime ? formatTimeDisplay(formTime) : "+ time"}
              </button>
              {formTime && <button onClick={() => setFormTime("")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--color-secondary)" }}>clear</button>}
            </div>
            {showTP && tpPos && <TimePicker value={formTime || "09:00"} accentColor="var(--color-navy)" pos={tpPos} onChange={t => setFormTime(t)} onClear={() => { setFormTime(""); setShowTP(false); }} onClose={() => setShowTP(false)} />}
            {formError && <p style={{ fontSize: 11, color: "var(--color-error)", margin: 0 }}>{formError}</p>}
            <div className="flex gap-2">
              <button onClick={handleAdd} style={{ height: 32, paddingInline: 16, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Add</button>
              <button onClick={() => setShowForm(false)} style={{ height: 32, paddingInline: 12, background: "none", border: "none", fontSize: 12, color: "var(--color-secondary)", cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </Card>
      )}

      {/* Event detail */}
      {detailEvent && !showForm && (
        <Card>
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span style={{ width: 9, height: 9, borderRadius: "50%", backgroundColor: detailEvent.color, display: "inline-block", flexShrink: 0 }} />
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>{detailEvent.title}</p>
              </div>
              <button onClick={() => setDetailEvent(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--color-secondary)", flexShrink: 0 }}><X size={13} /></button>
            </div>
            <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 6px 19px" }}>
              {new Date(detailEvent.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {detailEvent.startMin != null && ` · ${formatTimeDisplay(minToTimeStr(detailEvent.startMin))}`}
              {detailEvent.type === "meeting" && detailEvent.endMin != null && ` · ${formatDuration(detailEvent.endMin - detailEvent.startMin!)}`}
            </p>
            {detailEvent.isScheduleEvent && detailEvent.ownerId === currentUserId && (
              <button onClick={() => { onDeleteEvent(detailEvent.id); setDetailEvent(null); }} className="flex items-center gap-1.5" style={{ marginLeft: 15, fontSize: 12, color: "var(--color-error)", background: "none", border: "none", cursor: "pointer" }}>
                <Trash2 size={12} /> Delete event
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Legend */}
      <div className="flex gap-5">
        {[{ color: "var(--color-navy)", label: "Lab event" }, { color: "var(--color-secondary)", label: "Personal" }, { color: "var(--color-success)", label: "Meeting" }].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: color, display: "inline-block" }} />
            <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Availability ─────────────────────────────────────────────────────────

type AvailScope = "mine" | "all";

function AvailabilityTab({
  onSave,
  allAvailabilities,
  teamMembers,
  currentUserId,
  googleConnected,
  onToggleGoogle,
  subProjects,
}: {
  onSave: (slots: string[], subProjectId: string | null) => void;
  allAvailabilities: WeeklyAvailability[];
  teamMembers: User[];
  currentUserId: string;
  googleConnected: boolean;
  onToggleGoogle: () => void;
  subProjects: SubProject[];
}) {
  const [scope, setScope] = useState<AvailScope>("mine");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => teamMembers.map(m => m.id));
  const [availSubProjectId, setAvailSubProjectId] = useState<string | null>(null); // null = Lab
  const [slots, setSlots] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);
  const skipSaveRef = useRef(false);

  // Sync slots when sub-project selection or loaded availabilities change
  useEffect(() => {
    skipSaveRef.current = true;
    const entry = allAvailabilities.find(
      a => a.userId === currentUserId && (a.subProjectId ?? null) === availSubProjectId
    );
    setSlots(entry?.slots ?? []);
  }, [availSubProjectId, allAvailabilities, currentUserId]);

  useEffect(() => {
    if (scope === "all") setSelectedIds(teamMembers.map(m => m.id));
  }, [scope, teamMembers]);

  // Auto-save 800ms after the user stops dragging
  useEffect(() => {
    if (isFirstMount.current) { isFirstMount.current = false; return; }
    if (skipSaveRef.current) { skipSaveRef.current = false; return; }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onSave(slots, availSubProjectId);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  const derivedSavedSlots = allAvailabilities.find(
    a => a.userId === currentUserId && (a.subProjectId ?? null) === availSubProjectId
  )?.slots ?? [];
  const hasChanges = JSON.stringify([...slots].sort()) !== JSON.stringify([...derivedSavedSlots].sort());

  const filteredAvailabilities = scope === "mine"
    ? allAvailabilities.filter(a => a.userId === currentUserId && (a.subProjectId ?? null) === availSubProjectId)
    : allAvailabilities.filter(a => selectedIds.includes(a.userId) && (a.subProjectId ?? null) === availSubProjectId);

  const filteredMembers = scope === "mine"
    ? teamMembers.filter(m => m.id === currentUserId)
    : teamMembers.filter(m => selectedIds.includes(m.id));

  const overlapTitle = filteredMembers.length === 0
    ? "Select people to compare"
    : filteredMembers.length <= 3
      ? `Overlap: ${filteredMembers.map(m => m.name.split(" ")[0]).join(", ")}`
      : `Overlap: ${filteredMembers.length} people`;

  return (
    <div className="space-y-4">
      {/* Scope pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {([["mine", "Mine"], ["all", "My Team"]] as [AvailScope, string][]).map(([s, label]) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            style={{
              height: 32, paddingInline: 14, borderRadius: 20,
              border: `1.5px solid ${scope === s ? "var(--color-navy)" : "var(--color-border)"}`,
              backgroundColor: scope === s ? "var(--color-navy)" : "transparent",
              color: scope === s ? "#fff" : "var(--color-secondary)",
              fontSize: 13, fontWeight: scope === s ? 600 : 400, cursor: "pointer", fontFamily: "var(--font-roboto)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Per-person chips - shown in My Team view; deselect to customise */}
      {scope === "all" && teamMembers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {teamMembers.map(m => {
            const checked = selectedIds.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => setSelectedIds(prev =>
                  checked ? prev.filter(id => id !== m.id) : [...prev, m.id]
                )}
                className="flex items-center gap-1.5"
                style={{
                  height: 30, paddingInline: 10, borderRadius: 20,
                  border: `1.5px solid ${checked ? "var(--color-navy)" : "var(--color-border)"}`,
                  backgroundColor: checked ? "var(--color-navy-dim)" : "transparent",
                  color: checked ? "var(--color-navy)" : "var(--color-secondary)",
                  fontSize: 12, fontWeight: checked ? 600 : 400, cursor: "pointer", fontFamily: "var(--font-roboto)",
                }}
              >
                <Avatar user={m} size={18} />
                {m.name.split(" ")[0]}
              </button>
            );
          })}
        </div>
      )}

      {/* Privacy gate: require ≥2 people before showing overlap view */}
      {scope === "all" && selectedIds.length < 2 && (
        <p style={{ fontSize: 13, color: "var(--color-secondary)", fontStyle: "italic" }}>
          Select at least 2 people to compare availability.
        </p>
      )}

      {scope === "mine" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Card>
            <SectionHeader
              title={
                subProjects.length > 0
                  ? `My Availability: ${availSubProjectId ? (subProjects.find(sp => sp.id === availSubProjectId)?.name ?? "Project") : "Lab-wide"}`
                  : "My Weekly Availability"
              }
              action={
                <div className="flex items-center gap-2">
                  {saved ? (
                    <span style={{ fontSize: 12, color: "var(--color-success)", fontWeight: 600 }}>✓ Saved</span>
                  ) : hasChanges ? (
                    <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>Saving…</span>
                  ) : null}
                </div>
              }
            />
            <div className="p-5">
              {subProjects.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap mb-4">
                  <span style={{ fontSize: 12, color: "var(--color-secondary)", fontWeight: 600, flexShrink: 0 }}>Scope:</span>
                  <button
                    onClick={() => setAvailSubProjectId(null)}
                    style={{
                      height: 28, paddingInline: 12, borderRadius: 20,
                      border: `1.5px solid ${availSubProjectId === null ? "var(--color-navy)" : "var(--color-border)"}`,
                      backgroundColor: availSubProjectId === null ? "var(--color-navy)" : "transparent",
                      color: availSubProjectId === null ? "#fff" : "var(--color-secondary)",
                      fontSize: 12, fontWeight: availSubProjectId === null ? 600 : 400,
                      cursor: "pointer", fontFamily: "var(--font-roboto)",
                    }}
                  >Lab</button>
                  {subProjects.map(sp => (
                    <button
                      key={sp.id}
                      onClick={() => setAvailSubProjectId(sp.id)}
                      style={{
                        height: 28, paddingInline: 12, borderRadius: 20,
                        border: `1.5px solid ${availSubProjectId === sp.id ? (sp.color ?? "#34A853") : "var(--color-border)"}`,
                        backgroundColor: availSubProjectId === sp.id ? (sp.color ?? "#34A853") : "transparent",
                        color: availSubProjectId === sp.id ? "#fff" : "var(--color-secondary)",
                        fontSize: 12, fontWeight: availSubProjectId === sp.id ? 600 : 400,
                        cursor: "pointer", fontFamily: "var(--font-roboto)",
                      }}
                    >{sp.name}</button>
                  ))}
                </div>
              )}
              <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-lg" style={{ backgroundColor: "var(--color-navy-dim)", border: "1px solid var(--color-border)" }}>
                <Lock size={13} style={{ marginTop: 2, color: "var(--color-navy)", flexShrink: 0 }} />
                <p style={{ fontSize: 12, color: "var(--color-body)", margin: 0, lineHeight: 1.5 }}>
                  You&apos;re editing your <strong>{availSubProjectId ? (subProjects.find(sp => sp.id === availSubProjectId)?.name ?? "project") : "lab-wide"}</strong> availability. Team members see only the aggregate overlap, not your individual schedule.
                </p>
              </div>
              <AvailabilityGrid slots={slots} onChange={setSlots} />
            </div>
          </Card>

          {/* Google Calendar Sync */}
          <Card>
            <SectionHeader title="Google Calendar" />
            <div className="px-5 py-4 space-y-3">
              <div
                className="flex items-start gap-2 p-3 rounded-lg"
                style={{
                  backgroundColor: "var(--color-navy-dim)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {googleConnected ? (
                  <Check size={13} style={{ color: "var(--color-success)", marginTop: 2, flexShrink: 0 }} />
                ) : (
                  <AlertCircle size={13} style={{ color: "var(--color-secondary)", marginTop: 2, flexShrink: 0 }} />
                )}
                <p style={{ fontSize: 12, color: "var(--color-body)", margin: 0, lineHeight: 1.5 }}>
                  {googleConnected
                    ? "Connected: free/busy syncs automatically. No event details are visible to anyone."
                    : "Not connected. Connect to sync your free/busy status automatically."}
                </p>
              </div>
              <button
                onClick={onToggleGoogle}
                className="w-full flex items-center justify-center gap-2"
                style={{
                  height: 38, border: "1px solid var(--color-border)", borderRadius: 7,
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-roboto)",
                  backgroundColor: googleConnected ? "transparent" : "var(--color-navy)",
                  color: googleConnected ? "var(--color-error)" : "#fff",
                }}
              >
                {googleConnected ? "Disconnect Calendar" : "Connect Google Calendar"}
              </button>
              <p style={{ fontSize: 11, color: "var(--color-secondary)", lineHeight: 1.5 }}>
                Only free/busy status is used. Event titles, descriptions, and attendees are never read or shared.
              </p>
            </div>
          </Card>
        </div>
      ) : (
        <Card>
          <SectionHeader title={overlapTitle} />
          <div className="p-5">
            {filteredMembers.length < 2 ? (
              <p style={{ fontSize: 13, color: "var(--color-secondary)", textAlign: "center", padding: "24px 0" }}>
                Select at least 2 people to compare availability.
              </p>
            ) : filteredAvailabilities.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-secondary)", textAlign: "center", padding: "24px 0" }}>
                None of the selected members have set their availability yet.
              </p>
            ) : (
              <TeamOverlapView
                availabilities={filteredAvailabilities}
                teamMembers={filteredMembers}
              />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Tab: Upcoming Meetings ────────────────────────────────────────────────────

function MeetingsTab({
  proposals,
  currentUserId,
  teamMembers,
  onRespond,
  onPropose,
}: {
  proposals: MeetingProposal[];
  currentUserId: string;
  teamMembers: User[];
  onRespond: (proposalId: string, status: "accepted" | "declined") => void;
  onPropose: () => void;
}) {
  const todayStr = new Date().toISOString().split("T")[0];

  const myProposals = proposals
    .filter(p => p.proposerId === currentUserId || p.inviteeIds.includes(currentUserId))
    .sort((a, b) => a.proposedDate.localeCompare(b.proposedDate));

  const upcoming = myProposals.filter(p => p.proposedDate >= todayStr);
  const past = myProposals.filter(p => p.proposedDate < todayStr);

  function getMember(id: string) { return teamMembers.find(m => m.id === id); }

  function ProposalRow({ p }: { p: MeetingProposal }) {
    const isIncoming = p.proposerId !== currentUserId;
    const myStatus = p.responses.find(r => r.userId === currentUserId)?.status ?? "pending";
    const needsResponse = isIncoming && myStatus === "pending";
    const c = STATUS_COLORS[myStatus as MeetingResponseStatus];
    const proposer = getMember(p.proposerId);

    return (
      <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>{p.title}</p>
            {p.description && <p style={{ fontSize: 12, color: "var(--color-secondary)", marginTop: 2 }}>{p.description}</p>}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="flex items-center gap-1" style={{ fontSize: 12, color: "var(--color-body)" }}>
                <Calendar size={11} style={{ color: "var(--color-navy)" }} />
                {formatProposedDate(p.proposedDate, p.proposedTime)}
              </span>
              <span className="flex items-center gap-1" style={{ fontSize: 12, color: "var(--color-secondary)" }}>
                <Clock size={11} /> {formatDuration(p.durationMinutes)}
              </span>
              {isIncoming && proposer && (
                <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: "var(--color-secondary)" }}>
                  <Avatar user={proposer} size={14} /> {proposer.name.split(" ")[0]}
                </span>
              )}
            </div>
          </div>
          {!needsResponse && (
            <span style={{ fontSize: 11, fontWeight: 600, flexShrink: 0, color: isIncoming ? c.text : "var(--color-secondary)", backgroundColor: isIncoming ? c.bg : "var(--color-navy-dim)", borderRadius: 12, padding: "2px 8px" }}>
              {isIncoming ? STATUS_LABELS[myStatus as MeetingResponseStatus] : "Proposed"}
            </span>
          )}
        </div>

        {!isIncoming && p.inviteeIds.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {p.inviteeIds.map(id => {
              const u = getMember(id);
              const resp = p.responses.find(r => r.userId === id);
              const status = resp?.status ?? "pending";
              const rc = STATUS_COLORS[status];
              if (!u) return null;
              return (
                <div key={id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ backgroundColor: rc.bg }}>
                  <Avatar user={u} size={16} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: rc.text }}>{u.name.split(" ")[0]}: {STATUS_LABELS[status]}</span>
                </div>
              );
            })}
          </div>
        )}

        {needsResponse && (
          <div className="flex gap-2 mt-3">
            <button onClick={() => onRespond(p.id, "accepted")} className="flex items-center gap-1.5"
              style={{ height: 32, paddingInline: 14, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-roboto)" }}>
              <Check size={12} /> Accept
            </button>
            <button onClick={() => onRespond(p.id, "declined")} className="flex items-center gap-1.5"
              style={{ height: 32, paddingInline: 14, backgroundColor: "transparent", color: "var(--color-error)", border: "1px solid var(--color-error)", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-roboto)" }}>
              <X size={12} /> Decline
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <SectionHeader
          title="Upcoming Meetings"
          action={
            <button onClick={onPropose} className="flex items-center gap-1.5"
              style={{ height: 32, paddingInline: 14, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-roboto)" }}>
              <Plus size={13} /> Propose
            </button>
          }
        />
        {upcoming.length === 0 ? (
          <EmptyState icon={Send} heading="No upcoming meetings"
            body="Propose a time with your lab members. Everyone can accept or decline."
            action={<button onClick={onPropose} style={{ fontSize: 13, fontWeight: 600, color: "var(--color-navy)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Propose a meeting</button>}
          />
        ) : (
          upcoming.map(p => <ProposalRow key={p.id} p={p} />)
        )}
      </Card>

      {past.length > 0 && (
        <Card>
          <SectionHeader title="Past" />
          {past.map(p => <ProposalRow key={p.id} p={p} />)}
        </Card>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "calendar" | "availability" | "meetings";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "calendar",     label: "Calendar",     icon: Calendar },
  { id: "availability", label: "Availability", icon: Users    },
  { id: "meetings",     label: "Meetings",     icon: Send     },
];

export default function SchedulingPage() {
  const { projectId, subProjects } = useProject();

  const [tab, setTab] = useState<Tab>("calendar");
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("scheduling_sidebar_collapsed") === "true"; } catch { return false; }
  });
  const [googleConnected, setGoogleConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  // Resolved from auth
  const [currentUserId, setCurrentUserId] = useState("");
  const [teamMembers, setTeamMembers] = useState<User[]>([]);

  // Scheduling data
  const [allAvailabilities, setAllAvailabilities] = useState<WeeklyAvailability[]>([]);
  const [allUserSettings, setAllUserSettings] = useState<UserSettings[]>([]);
  const [proposals, setProposals] = useState<MeetingProposal[]>([]);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);

  // Auth effect - resolve currentUserId once
  useEffect(() => {
    if (!isSupabaseConfigured) {
      try {
        const stored = localStorage.getItem("canopy_user");
        if (stored) { const u = JSON.parse(stored) as { id?: string }; setCurrentUserId(u.id ?? "demo"); }
        else setCurrentUserId("demo");
      } catch { setCurrentUserId("demo"); }
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setCurrentUserId(session.user.id);
    });
  }, []);

  // Team + availability + proposals - re-run when projectId or currentUserId resolves
  useEffect(() => {
    if (!projectId || !currentUserId) return;
    if (!isSupabaseConfigured) { setLoading(false); return; }

    async function fetchStaticData() {
      const { data: members } = await supabase
        .from("team_members")
        .select("user_id, role, user_profiles(name, avatar_color, avatar_initials, avatar_url)")
        .eq("project_id", projectId);

      if (members) {
        setTeamMembers(
          members.map((row) => {
            const p = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
            const profile = p as Record<string, string> | null;
            const name = profile?.name ?? "Team Member";
            return {
              id: row.user_id as string,
              name,
              email: "",
              role: (row.role ?? "researcher") as User["role"],
              avatarColor: profile?.avatar_color ?? "#B4D4E3",
              avatarInitials: computeInitials(name) || (profile?.avatar_initials ?? "??"),
              avatarUrl: profile?.avatar_url ?? undefined,
            };
          })
        );
      }

      const { data: avData } = await supabase
        .from("user_availability")
        .select("*")
        .eq("project_id", projectId);

      if (avData) {
        setAllAvailabilities(avData.map((row) => ({
          userId: row.user_id as string,
          projectId: row.project_id as string,
          subProjectId: (row.sub_project_id as string | null) === LAB_AVAILABILITY_ID ? null : ((row.sub_project_id as string | null) ?? null),
          slots: (row.slots as string[]) ?? [],
          updatedAt: row.updated_at as string,
        })));
      }

      // Fetch user settings (timezone + working hours) for all team members
      const memberIds = (members ?? []).map(m => m.user_id as string);
      if (memberIds.length > 0) {
        const { data: settingsData } = await supabase
          .from("user_settings")
          .select("*")
          .in("user_id", memberIds);
        if (settingsData) {
          setAllUserSettings(settingsData.map(row => ({
            userId: row.user_id as string,
            timezone: (row.timezone as string) ?? "America/New_York",
            workingHours: (row.working_hours as UserSettings["workingHours"]) ?? {},
            updatedAt: row.updated_at as string,
          })));
        }
      }

      const { data: propData } = await supabase
        .from("meeting_proposals")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (propData) {
        setProposals(
          propData.map((row) => ({
            id: row.id as string,
            projectId: row.project_id as string,
            proposerId: row.proposer_id as string,
            title: row.title as string,
            description: (row.description as string) ?? undefined,
            proposedDate: row.proposed_date as string,
            proposedTime: row.proposed_time as string,
            durationMinutes: row.duration_minutes as number,
            inviteeIds: (row.invitee_ids as string[]) ?? [],
            responses: (row.responses as MeetingResponse[]) ?? [],
            createdAt: row.created_at as string,
          }))
        );
      }

      setLoading(false);
    }

    fetchStaticData();
  }, [projectId, currentUserId]);

  // Realtime: update overlap grid when any team member saves their availability
  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || !currentUserId) return;
    const channel = supabase
      .channel(`availability:project:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_availability", filter: `project_id=eq.${projectId}` },
        (payload) => {
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const row = payload.new;
            const updated: WeeklyAvailability = {
              userId: row.user_id as string,
              projectId: row.project_id as string,
              subProjectId: (row.sub_project_id as string | null) === LAB_AVAILABILITY_ID ? null : ((row.sub_project_id as string | null) ?? null),
              slots: (row.slots as string[]) ?? [],
              updatedAt: row.updated_at as string,
            };
            setAllAvailabilities((prev) => {
              const exists = prev.some(
                (a) => a.userId === updated.userId &&
                  (a.subProjectId ?? LAB_AVAILABILITY_ID) === (row.sub_project_id as string ?? LAB_AVAILABILITY_ID)
              );
              return exists
                ? prev.map((a) =>
                    a.userId === updated.userId &&
                    (a.subProjectId ?? LAB_AVAILABILITY_ID) === (row.sub_project_id as string ?? LAB_AVAILABILITY_ID)
                      ? updated : a
                  )
                : [...prev, updated];
            });
          } else if (payload.eventType === "DELETE") {
            const row = payload.old;
            setAllAvailabilities((prev) =>
              prev.filter(
                (a) => !(
                  a.userId === (row.user_id as string) &&
                  (a.subProjectId ?? LAB_AVAILABILITY_ID) === (row.sub_project_id as string ?? LAB_AVAILABILITY_ID)
                )
              )
            );
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId, currentUserId]);

  // Events effect - fetches all lab/project events + current user's personal events
  useEffect(() => {
    if (!projectId || !currentUserId || !isSupabaseConfigured) return;

    async function fetchEvents() {
      const { data: evData } = await supabase
        .from("schedule_events")
        .select("*")
        .eq("project_id", projectId)
        .or(`scope.neq.personal,and(scope.eq.personal,created_by.eq.${currentUserId})`)
        .order("date", { ascending: true });

      if (evData) {
        setEvents(
          evData.map((row) => ({
            id: row.id as string,
            projectId: row.project_id as string,
            title: row.title as string,
            date: row.date as string,
            time: (row.time as string) ?? undefined,
            endTime: (row.end_time as string) ?? undefined,
            scope: row.scope as ScheduleEvent["scope"],
            createdBy: row.created_by as string,
            description: (row.description as string) ?? undefined,
            subProjectId: (row.sub_project_id as string) ?? null,
          }))
        );
      }
    }

    fetchEvents();
  }, [projectId, currentUserId]);

  // ── Write handlers ──────────────────────────────────────────────────────────

  function handleSaveAvailability(slots: string[], subProjectId: string | null) {
    const updated: WeeklyAvailability = {
      userId: currentUserId,
      projectId: projectId ?? "",
      subProjectId,
      slots,
      updatedAt: new Date().toISOString(),
    };
    setAllAvailabilities((prev) => {
      const exists = prev.some(
        (a) => a.userId === currentUserId && (a.subProjectId ?? null) === subProjectId
      );
      return exists
        ? prev.map((a) =>
            a.userId === currentUserId && (a.subProjectId ?? null) === subProjectId ? updated : a
          )
        : [...prev, updated];
    });

    if (isSupabaseConfigured && projectId && currentUserId) {
      supabase
        .from("user_availability")
        .upsert(
          {
            project_id: projectId,
            user_id: currentUserId,
            sub_project_id: subProjectId ?? LAB_AVAILABILITY_ID,
            slots,
            updated_at: updated.updatedAt,
          },
          { onConflict: "project_id,user_id,sub_project_id" }
        )
        .then(({ error }) => { if (error) console.error("[Scheduling] save availability:", error); });
    }
  }

  function handleRespond(proposalId: string, status: "accepted" | "declined") {
    let updatedResponses: MeetingResponse[] = [];

    setProposals((prev) =>
      prev.map((p) => {
        if (p.id !== proposalId) return p;
        const responses = p.responses.map((r) =>
          r.userId === currentUserId ? { ...r, status, respondedAt: new Date().toISOString() } : r
        );
        if (!responses.some((r) => r.userId === currentUserId)) {
          responses.push({ userId: currentUserId, status, respondedAt: new Date().toISOString() });
        }
        updatedResponses = responses;
        return { ...p, responses };
      })
    );

    if (isSupabaseConfigured && proposalId && updatedResponses.length > 0) {
      supabase
        .from("meeting_proposals")
        .update({ responses: updatedResponses })
        .eq("id", proposalId)
        .then(({ error }) => { if (error) console.error("[Scheduling] respond to proposal:", error); });
    }
  }

  async function handleProposal(proposal: Omit<MeetingProposal, "id" | "createdAt" | "responses">) {
    const initialResponses: MeetingResponse[] = proposal.inviteeIds.map((id) => ({
      userId: id,
      status: "pending",
    }));
    const tempId = crypto.randomUUID();
    const newProposal: MeetingProposal = {
      ...proposal,
      projectId: projectId ?? "",
      id: tempId,
      createdAt: new Date().toISOString(),
      responses: initialResponses,
    };

    if (isSupabaseConfigured && projectId && currentUserId) {
      const { data, error } = await supabase
        .from("meeting_proposals")
        .insert({
          project_id: projectId,
          proposer_id: currentUserId,
          title: proposal.title,
          description: proposal.description ?? null,
          proposed_date: proposal.proposedDate,
          proposed_time: proposal.proposedTime,
          duration_minutes: proposal.durationMinutes,
          invitee_ids: proposal.inviteeIds,
          responses: initialResponses,
        })
        .select()
        .single();
      if (!error && data) {
        const proposalId = data.id as string;
        setProposals((prev) => [{ ...newProposal, id: proposalId }, ...prev]);
        // Notify invitees
        const toNotify = proposal.inviteeIds.filter((id) => id !== currentUserId);
        if (toNotify.length > 0) {
          const dateStr = proposal.proposedDate
            ? `${proposal.proposedDate}${proposal.proposedTime ? " at " + proposal.proposedTime : ""}`
            : null;
          const notifs = toNotify.map((uid) => ({
            user_id: uid,
            type: "meeting_invite",
            title: `You were invited to "${proposal.title}"`,
            body: dateStr,
            related_id: proposalId,
            read: false,
          }));
          supabase.from("notifications").insert(notifs).then(({ error: ne }) => {
            if (ne) console.error("[Scheduling] meeting invite notification:", ne);
          });
        }
      } else {
        if (error) console.error("[Scheduling] create proposal:", error);
        setProposals((prev) => [newProposal, ...prev]);
      }
    } else {
      setProposals((prev) => [newProposal, ...prev]);
    }

    setShowProposalModal(false);
    setTab("meetings");
  }

  async function handleAddEvent(event: Omit<ScheduleEvent, "id">) {
    const tempId = crypto.randomUUID();
    if (isSupabaseConfigured && projectId && currentUserId) {
      const { data, error } = await supabase
        .from("schedule_events")
        .insert({
          project_id: projectId,
          title: event.title,
          date: event.date,
          time: event.time ?? null,
          end_time: event.endTime ?? null,
          scope: event.scope,
          sub_project_id: event.subProjectId ?? null,
          created_by: currentUserId,
          description: event.description ?? null,
        })
        .select()
        .single();
      if (!error && data) {
        setEvents((prev) => [...prev, { ...event, id: data.id as string }]);
      } else {
        if (error) console.error("[Scheduling] add event:", error);
        setEvents((prev) => [...prev, { ...event, id: tempId }]);
      }
    } else {
      setEvents((prev) => [...prev, { ...event, id: tempId }]);
    }
  }

  function handleDeleteEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    if (isSupabaseConfigured) {
      supabase.from("schedule_events").delete().eq("id", id)
        .then(({ error }) => { if (error) console.error("[Scheduling] delete event:", error); });
    }
  }

  const pendingCount = proposals.filter(
    (p) =>
      p.proposerId !== currentUserId &&
      p.inviteeIds.includes(currentUserId) &&
      (p.responses.find((r) => r.userId === currentUserId)?.status ?? "pending") === "pending"
  ).length;

  if (loading) {
    return (
      <div style={{ padding: "24px 28px", backgroundColor: "var(--color-canvas)", minHeight: "100%" }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{ marginBottom: 16, borderRadius: 10, border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", padding: "18px 20px", overflow: "hidden" }}
          >
            <div style={{ width: "35%", height: 14, borderRadius: 6, backgroundColor: "var(--color-border)", marginBottom: 12, animation: "skeleton-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.15}s` }} />
            <div style={{ width: "60%", height: 11, borderRadius: 6, backgroundColor: "var(--color-border)", marginBottom: 8, animation: "skeleton-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.15 + 0.1}s` }} />
            <div style={{ width: "45%", height: 11, borderRadius: 6, backgroundColor: "var(--color-border)", animation: "skeleton-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.15 + 0.2}s` }} />
          </div>
        ))}
        <style>{`@keyframes skeleton-pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }`}</style>
      </div>
    );
  }

  const schedulingSections: ScopeSection[] = TABS.map(({ id, label, icon: Icon }) => ({
    id,
    label,
    color: "var(--color-navy)",
    icon: <Icon size={17} />,
    count: id === "meetings" && pendingCount > 0 ? pendingCount : undefined,
    isActive: tab === id,
    onClick: () => setTab(id),
  }));

  return (
    <ClientOnly>
      <div className="flex flex-col h-full">
        <PageHeader title="Scheduling" />
        <div className="flex flex-1 overflow-hidden">
          <ScopeSidebar
            sections={schedulingSections}
            storageKey="scheduling_sidebar"
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(c => {
              const next = !c;
              try { localStorage.setItem("scheduling_sidebar_collapsed", String(next)); } catch {}
              return next;
            })}
            headerLabel="Views"
          />
          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-6 max-w-5xl mx-auto">
              {tab === "calendar" && (
                <CalendarTab
                  events={events}
                  proposals={proposals}
                  currentUserId={currentUserId}
                  projectId={projectId ?? ""}
                  onAddEvent={handleAddEvent}
                  onDeleteEvent={handleDeleteEvent}
                />
              )}
              {tab === "availability" && (
                <AvailabilityTab
                  onSave={handleSaveAvailability}
                  allAvailabilities={allAvailabilities}
                  teamMembers={teamMembers}
                  currentUserId={currentUserId}
                  googleConnected={googleConnected}
                  onToggleGoogle={() => setGoogleConnected(c => !c)}
                  subProjects={subProjects}
                />
              )}
              {tab === "meetings" && (
                <MeetingsTab
                  proposals={proposals}
                  currentUserId={currentUserId}
                  teamMembers={teamMembers}
                  onRespond={handleRespond}
                  onPropose={() => setShowProposalModal(true)}
                />
              )}
            </div>
          </div>
        </div>

        {showProposalModal && (
          <MeetingProposalModal
            currentUserId={currentUserId}
            teamMembers={teamMembers}
            allAvailabilities={allAvailabilities}
            allUserSettings={allUserSettings}
            proposals={proposals}
            events={events}
            onSubmit={handleProposal}
            onClose={() => setShowProposalModal(false)}
          />
        )}
      </div>
    </ClientOnly>
  );
}
