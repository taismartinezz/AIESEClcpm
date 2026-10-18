"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useViewportFit, type FloatPos } from "@/components/ui/useViewportFit";
import { ChevronLeft, ChevronRight, CalendarDays, Clock } from "lucide-react";

// ── Constants (internal) ──────────────────────────────────────────────────────

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_LETTERS = ["S","M","T","W","T","F","S"];
const HOURS = [1,2,3,4,5,6,7,8,9,10,11,12];
const MINUTES = [0,5,10,15,20,25,30,35,40,45,50,55];
const ITEM_H = 34;

// ── Exported helpers ──────────────────────────────────────────────────────────

export function isoToLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function formatTimeDisplay(time: string): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h-12 : h;
  return `${h12}:${String(m).padStart(2,"0")} ${ap}`;
}

export function formatDateLabel(date: string): string {
  const d = new Date(date+"T00:00");
  const today = new Date(); today.setHours(0,0,0,0);
  const tmrw = new Date(today); tmrw.setDate(today.getDate()+1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tmrw.toDateString())  return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── CalendarPicker ────────────────────────────────────────────────────────────

export function CalendarPicker({ value, accentColor, pos, onSelect, onClear, onClose }: {
  value: string | undefined; accentColor: string; pos: FloatPos;
  onSelect: (date: string) => void; onClear: () => void; onClose: () => void;
}) {
  const todayDate = new Date(); todayDate.setHours(0,0,0,0);
  const todayStr = isoToLocalDate(todayDate.toISOString());
  const [cursor, setCursor] = useState(() => {
    if (value) { const d = new Date(value+"T00:00"); return { year: d.getFullYear(), month: d.getMonth() }; }
    return { year: todayDate.getFullYear(), month: todayDate.getMonth() };
  });
  const ref = useRef<HTMLDivElement>(null);
  const fit = useViewportFit(ref, pos);
  useEffect(() => {
    function down(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    function key(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  function prevMonth() { setCursor(p => p.month === 0 ? { year: p.year-1, month: 11 } : { ...p, month: p.month-1 }); }
  function nextMonth() { setCursor(p => p.month === 11 ? { year: p.year+1, month: 0 } : { ...p, month: p.month+1 }); }
  const daysInMonth = new Date(cursor.year, cursor.month+1, 0).getDate();
  const firstDow = new Date(cursor.year, cursor.month, 1).getDay();
  function ds(d: number) { return `${cursor.year}-${String(cursor.month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
  const btnBase: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
  // Portalled so a transformed / scrolling parent (modal, side panel) can't shift it.
  return createPortal((
    <div ref={ref} style={{ position: "fixed", top: fit.top, left: fit.left, zIndex: 500, width: 244, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.14)", padding: "14px 12px 10px", fontFamily: "var(--font-roboto)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={prevMonth} style={{ ...btnBase, width: 28, height: 28, borderRadius: 8 }} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-canvas)"; }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}><ChevronLeft size={14} color="var(--color-secondary)" /></button>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)" }}>{MONTH_NAMES[cursor.month]} {cursor.year}</span>
        <button onClick={nextMonth} style={{ ...btnBase, width: 28, height: 28, borderRadius: 8 }} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-canvas)"; }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}><ChevronRight size={14} color="var(--color-secondary)" /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 }}>
        {DAY_LETTERS.map((l,i) => <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "var(--color-secondary)", paddingBlock: 3 }}>{l}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
        {Array.from({ length: firstDow }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i+1; const d = ds(day); const isToday = d === todayStr; const isSel = d === value;
          return (
            <button key={day} onClick={() => onSelect(d)} style={{ width: 30, height: 30, borderRadius: "50%", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", border: isToday && !isSel ? `1.5px solid ${accentColor}55` : "1.5px solid transparent", backgroundColor: isSel ? accentColor : "transparent", color: isSel ? "#fff" : isToday ? accentColor : "var(--color-body)", fontSize: 12, fontWeight: isSel || isToday ? 600 : 400, cursor: "pointer", transition: "background-color 0.1s" }}
              onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = `${accentColor}20`; }}
              onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}>
              {day}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
        <button onClick={onClear} style={{ ...btnBase, fontSize: 12, color: "var(--color-secondary)", padding: "4px 6px", borderRadius: 6 }} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--color-body)"; }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--color-secondary)"; }}>Clear</button>
        <button onClick={() => onSelect(todayStr)} style={{ ...btnBase, fontSize: 12, fontWeight: 600, color: accentColor, padding: "4px 6px", borderRadius: 6 }} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = `${accentColor}12`; }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}>Today</button>
      </div>
    </div>
  ), document.body);
}

// ── TimePicker ────────────────────────────────────────────────────────────────

export function TimePicker({ value, accentColor, pos, onChange, onClear, onClose }: {
  value: string; accentColor: string; pos: FloatPos;
  onChange: (time: string) => void; onClear: () => void; onClose: () => void;
}) {
  const parsed = useMemo(() => {
    if (!value) return { h: 9, m: 0, ampm: "AM" as const };
    const [hh, mm] = value.split(":").map(Number);
    return { h: hh === 0 ? 12 : hh > 12 ? hh-12 : hh, m: Math.round(mm/5)*5 % 60, ampm: (hh >= 12 ? "PM" : "AM") as "AM"|"PM" };
  }, [value]);
  const [selH, setSelH] = useState(parsed.h);
  const [selM, setSelM] = useState(parsed.m);
  const [selAP, setSelAP] = useState<"AM"|"PM">(parsed.ampm);
  const ref = useRef<HTMLDivElement>(null);
  const fit = useViewportFit(ref, pos);
  const hourRef = useRef<HTMLDivElement>(null);
  const minRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function down(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [onClose]);
  useEffect(() => {
    const hi = HOURS.indexOf(selH); if (hi >= 0 && hourRef.current) hourRef.current.scrollTop = Math.max(0, (hi-1)*ITEM_H);
    const mi = MINUTES.indexOf(selM); if (mi >= 0 && minRef.current) minRef.current.scrollTop = Math.max(0, (mi-1)*ITEM_H);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function emit(h: number, m: number, ap: "AM"|"PM") {
    let h24 = h; if (ap === "AM" && h === 12) h24 = 0; else if (ap === "PM" && h !== 12) h24 = h+12;
    onChange(`${String(h24).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
  }
  const itemStyle = (active: boolean): React.CSSProperties => ({ height: ITEM_H, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: active ? 700 : 400, cursor: "pointer", borderRadius: 8, color: active ? "#fff" : "var(--color-body)", margin: "1px 2px", backgroundColor: active ? accentColor : "transparent", transition: "background-color 0.1s", userSelect: "none" });
  const colStyle: React.CSSProperties = { height: ITEM_H*4, overflowY: "auto", scrollbarWidth: "none" };
  // Portalled so a transformed / scrolling parent (modal, side panel) can't shift it.
  return createPortal((
    <div ref={ref} style={{ position: "fixed", top: fit.top, left: fit.left, zIndex: 501, width: 200, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.14)", padding: "12px 10px 10px", fontFamily: "var(--font-roboto)" }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <div ref={hourRef} style={{ flex: 1, ...colStyle }}>
          {HOURS.map(h => <div key={h} onClick={() => { setSelH(h); emit(h, selM, selAP); }} style={itemStyle(h === selH)} onMouseEnter={e => { if (h !== selH) (e.currentTarget as HTMLDivElement).style.backgroundColor = `${accentColor}18`; }} onMouseLeave={e => { if (h !== selH) (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}>{h}</div>)}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-secondary)", paddingBottom: 2 }}>:</div>
        <div ref={minRef} style={{ flex: 1, ...colStyle }}>
          {MINUTES.map(m => <div key={m} onClick={() => { setSelM(m); emit(selH, m, selAP); }} style={itemStyle(m === selM)} onMouseEnter={e => { if (m !== selM) (e.currentTarget as HTMLDivElement).style.backgroundColor = `${accentColor}18`; }} onMouseLeave={e => { if (m !== selM) (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}>{String(m).padStart(2,"0")}</div>)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 2 }}>
          {(["AM","PM"] as const).map(ap => (
            <button key={ap} onClick={() => { setSelAP(ap); emit(selH, selM, ap); }} style={{ width: 38, height: 30, borderRadius: 8, border: "1.5px solid", borderColor: ap === selAP ? accentColor : "var(--color-border)", backgroundColor: ap === selAP ? accentColor : "transparent", color: ap === selAP ? "#fff" : "var(--color-secondary)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-roboto)" }}>{ap}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
        <button onClick={onClear} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-secondary)", padding: "4px 6px", borderRadius: 6, fontFamily: "var(--font-roboto)" }} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--color-body)"; }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--color-secondary)"; }}>Clear</button>
        <button onClick={onClose} style={{ background: `${accentColor}18`, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, color: accentColor, padding: "4px 10px", borderRadius: 6, fontFamily: "var(--font-roboto)" }}>Done</button>
      </div>
    </div>
  ), document.body);
}

// ── DateTimeFields ────────────────────────────────────────────────────────────

export function DateTimeFields({ selDate, selTime, showTime, accentColor, onDateChange, onTimeChange, onToggleTime, onRefocus }: {
  selDate: string | undefined; selTime: string; showTime: boolean; accentColor: string;
  onDateChange: (d: string | undefined) => void; onTimeChange: (t: string) => void;
  onToggleTime: () => void; onRefocus?: () => void;
}) {
  const [showCal, setShowCal] = useState(false);
  const [calPos, setCalPos] = useState<FloatPos | null>(null);
  const [showTP, setShowTP] = useState(false);
  const [tpPos, setTpPos] = useState<FloatPos | null>(null);
  const dateRef = useRef<HTMLButtonElement>(null);
  const timeRef = useRef<HTMLButtonElement>(null);

  function openCal() {
    if (!dateRef.current) return;
    const r = dateRef.current.getBoundingClientRect();
    setCalPos({ top: r.bottom+6, left: r.left, anchorTop: r.top }); setShowCal(v => !v); setShowTP(false);
  }
  function openTP() {
    if (!timeRef.current) return;
    const r = timeRef.current.getBoundingClientRect();
    setTpPos({ top: r.bottom+6, left: r.left, anchorTop: r.top }); setShowTP(v => !v); setShowCal(false);
    if (!showTime) onToggleTime();
  }

  const pill = (active: boolean): React.CSSProperties => ({ height: 26, paddingInline: 10, borderRadius: 20, border: "1.5px solid", borderColor: active ? accentColor : "var(--color-border)", backgroundColor: active ? `${accentColor}18` : "transparent", color: active ? accentColor : "var(--color-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-roboto)", display: "flex", alignItems: "center", gap: 4 });

  return (
    <>
      <button ref={dateRef} onClick={openCal} style={pill(!!selDate)}>
        <CalendarDays size={11} />
        {selDate ? formatDateLabel(selDate) : "Date"}
      </button>

      {selDate && (
        <button ref={timeRef} onClick={openTP} style={{ ...pill(showTime && !!selTime), fontSize: showTime && selTime ? 12 : 11 }}>
          <Clock size={11} />
          {showTime && selTime ? formatTimeDisplay(selTime) : "+ time"}
        </button>
      )}

      {showCal && calPos && (
        <CalendarPicker value={selDate} accentColor={accentColor} pos={calPos}
          onSelect={d => { onDateChange(d); setShowCal(false); setTimeout(() => onRefocus?.(), 30); }}
          onClear={() => { onDateChange(undefined); onTimeChange(""); if (showTime) onToggleTime(); setShowCal(false); setTimeout(() => onRefocus?.(), 30); }}
          onClose={() => setShowCal(false)} />
      )}

      {showTP && tpPos && (
        <TimePicker value={selTime || "09:00"} accentColor={accentColor} pos={tpPos}
          onChange={t => onTimeChange(t)}
          onClear={() => { onTimeChange(""); if (showTime) onToggleTime(); setShowTP(false); setTimeout(() => onRefocus?.(), 30); }}
          onClose={() => { setShowTP(false); setTimeout(() => onRefocus?.(), 30); }} />
      )}
    </>
  );
}
