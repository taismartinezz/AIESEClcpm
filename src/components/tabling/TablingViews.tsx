"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Download, MapPin, Plus, Trash2, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { addDays, formatHours, formatTimeRange, groupByDay, hasStarted, isFull, slotHours, startOfWeek } from "@/lib/tabling";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { LcMember } from "@/hooks/useLcMembers";
import type { Department, TablingReportRow, TablingSignup, TablingSlot } from "@/types";
import { Button, ErrorText, Panel, Stat, inputStyle, selectStyle } from "@/components/lc/ui";
import { askConfirm } from "@/components/ui/confirm";

// ── Slot card ─────────────────────────────────────────────────────────────────

function SlotCard({ slot, mine, canManage, busy, departments, onSignUp, onWithdraw, onMark, onDelete }: {
  slot: TablingSlot; mine: TablingSignup | undefined; canManage: boolean; busy: boolean; departments: Department[];
  onSignUp: () => void; onWithdraw: () => void; onMark: () => void; onDelete: () => void;
}) {
  const started = hasStarted(slot);
  const full = isFull(slot);
  const dept = departments.find((d) => d.id === slot.departmentId);
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 12px", backgroundColor: "var(--color-surface)", opacity: busy ? 0.6 : 1 }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>{slot.purpose}</p>
      <p style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: 11, color: "var(--color-secondary)", margin: "4px 0 8px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Clock size={11} aria-hidden="true" />{formatTimeRange(slot)}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><MapPin size={11} aria-hidden="true" />{slot.location}</span>
        {dept && <span>{dept.name}</span>}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: full ? "var(--color-secondary)" : "var(--color-body)" }}>
          <Users size={12} aria-hidden="true" /> {slot.taken}/{slot.capacity}
        </span>
        {full && !mine && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-secondary)", border: "1px solid var(--color-border)", borderRadius: 20, padding: "1px 8px" }}>Full</span>}
        {mine && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-success)", backgroundColor: "var(--color-success-bg)", borderRadius: 20, padding: "1px 8px" }}>
          {mine.status === "attended" ? "Attended" : mine.status === "no_show" ? "No-show" : "You're signed up"}
        </span>}
        <span style={{ flex: 1 }} />
        {!started && !mine && !full && <Button onClick={onSignUp} disabled={busy} style={{ height: 30, fontSize: 12 }}>Sign up</Button>}
        {!started && mine && mine.status === "signed_up" && <Button variant="secondary" onClick={onWithdraw} disabled={busy} style={{ height: 30, fontSize: 12 }}>Withdraw</Button>}
        {started && canManage && <Button variant="secondary" onClick={onMark} style={{ height: 30, fontSize: 12 }}>Mark attendance</Button>}
        {canManage && !started && (
          <button type="button" aria-label={`Delete ${slot.purpose} slot`} onClick={onDelete} disabled={busy} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <Trash2 size={13} color="var(--color-secondary)" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Week ──────────────────────────────────────────────────────────────────────

export function WeekView({ slots, mySignups, canCreate, canManage, departments, onNew, onMark, onChanged }: {
  slots: TablingSlot[]; mySignups: TablingSignup[]; canCreate: boolean;
  canManage: (s: TablingSlot) => boolean; departments: Department[];
  onNew: () => void; onMark: (s: TablingSlot) => void; onChanged: () => void;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = groupByDay(slots, weekStart);
  const label = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  async function act(slot: TablingSlot, action: () => PromiseLike<{ error: { message: string } | null }>, what: string) {
    setBusyId(slot.id);
    setError(null);
    try {
      const { error: err } = await action();
      if (err) throw new Error(err.message);
      onChanged();
    } catch (e) {
      setError(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel
      action={<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", width: "100%" }}>
        <Button variant="secondary" aria-label="Previous week" onClick={() => setWeekStart((w) => addDays(w, -7))} style={{ width: 36, padding: 0 }}><ChevronLeft size={15} /></Button>
        <Button variant="secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</Button>
        <Button variant="secondary" aria-label="Next week" onClick={() => setWeekStart((w) => addDays(w, 7))} style={{ width: 36, padding: 0 }}><ChevronRight size={15} /></Button>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-navy)", margin: "0 0 0 6px", flex: "1 1 auto", whiteSpace: "nowrap" }}>{label}</h2>
        {canCreate && <Button onClick={onNew}><Plus size={14} aria-hidden="true" /> New slot</Button>}
      </div>}
    >
      <ErrorText>{error}</ErrorText>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 210px), 1fr))", gap: 12, padding: 14 }}>
        {days.map(({ day, slots: daySlots }) => (
          <section key={day.toISOString()} aria-label={day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}>
            <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: "0 0 6px" }}>
              {day.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {daySlots.length === 0 && <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>-</p>}
              {daySlots.map((s) => (
                <SlotCard
                  key={s.id} slot={s} departments={departments}
                  mine={mySignups.find((m) => m.slotId === s.id)} canManage={canManage(s)} busy={busyId === s.id}
                  onSignUp={() => act(s, () => supabase.rpc("tabling_sign_up", { p_slot_id: s.id }), "sign up")}
                  onWithdraw={() => act(s, () => supabase.rpc("tabling_withdraw", { p_slot_id: s.id }), "withdraw")}
                  onMark={() => onMark(s)}
                  onDelete={() => { void askConfirm("Delete this slot? Anyone signed up loses their place.").then((ok) => { if (ok) void act(s, () => supabase.from("tabling_slots").delete().eq("id", s.id), "delete the slot"); }); }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Panel>
  );
}

// ── My tabling ────────────────────────────────────────────────────────────────

export function MyTablingView({ slots, mySignups, myReport, termStart }: {
  slots: TablingSlot[]; mySignups: TablingSignup[]; myReport: TablingReportRow | undefined; termStart: string;
}) {
  const now = new Date();
  const upcoming = mySignups
    .map((su) => ({ su, slot: slots.find((s) => s.id === su.slotId) }))
    .filter((x): x is { su: TablingSignup; slot: TablingSlot } => !!x.slot && new Date(x.slot.startsAt) > now)
    .sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Stat label="Hours this term" value={formatHours(myReport?.hours ?? 0)} note={`Since ${new Date(termStart + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })} · attended shifts only`} />
        <Stat label="Shifts attended" value={String(myReport?.attended ?? 0)} />
        <Stat label="Upcoming shifts" value={String(upcoming.length)} />
      </div>
      <Panel title="Upcoming shifts">
        {upcoming.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>No upcoming shifts. Pick one from the week view.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {upcoming.map(({ slot }) => (
              <li key={slot.id} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--color-border)", fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: "var(--color-body)" }}>{slot.purpose}</span>
                <span style={{ color: "var(--color-secondary)" }}>
                  {new Date(slot.startsAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {formatTimeRange(slot)} · {slot.location} · {formatHours(slotHours(slot))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ── Report ────────────────────────────────────────────────────────────────────

export function TablingReport({ rows, people, departments, from, to, onRange }: {
  rows: TablingReportRow[]; people: LcMember[]; departments: Department[];
  from: string; to: string; onRange: (from: string, to: string) => void;
}) {
  const [departmentId, setDepartmentId] = useState("all");
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "";
  const shown = people
    .filter((p) => departmentId === "all" || p.departmentId === departmentId)
    .map((p) => ({ person: p, row: rows.find((r) => r.userId === p.id) }))
    .sort((a, b) => (b.row?.hours ?? 0) - (a.row?.hours ?? 0) || a.person.name.localeCompare(b.person.name));

  function exportCsv() {
    downloadCsv(`tabling-report-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(shown, [
      { header: "Name", value: (x) => x.person.name },
      { header: "Department", value: (x) => deptName(x.person.departmentId) },
      { header: "Hours (attended)", value: (x) => (x.row?.hours ?? 0).toFixed(2) },
      { header: "Shifts attended", value: (x) => x.row?.attended ?? 0 },
      { header: "No-shows", value: (x) => x.row?.noShows ?? 0 },
      { header: "Upcoming sign-ups", value: (x) => x.row?.upcoming ?? 0 },
    ]));
  }

  const td: React.CSSProperties = { padding: "8px 10px", borderTop: "1px solid var(--color-border)", fontSize: 13 };
  const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  return (
    <Panel title="Tabling report" action={<Button variant="secondary" onClick={exportCsv} disabled={shown.length === 0}><Download size={14} aria-hidden="true" /> CSV</Button>}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
        <select aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={{ ...selectStyle, width: 190, height: 34 }}>
          <option value="all">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-secondary)" }}>From <input type="date" value={from} onChange={(e) => onRange(e.target.value, to)} style={{ ...inputStyle, width: 140, height: 34 }} /></label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-secondary)" }}>To <input type="date" value={to} onChange={(e) => onRange(from, e.target.value)} style={{ ...inputStyle, width: 140, height: 34 }} /></label>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ fontSize: 11, color: "var(--color-secondary)" }}>
              <th scope="col" style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>Name</th>
              <th scope="col" style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>Department</th>
              <th scope="col" style={{ textAlign: "right", padding: "8px 10px", fontWeight: 600 }}>Hours</th>
              <th scope="col" style={{ textAlign: "right", padding: "8px 10px", fontWeight: 600 }}>Attended</th>
              <th scope="col" style={{ textAlign: "right", padding: "8px 10px", fontWeight: 600 }}>No-shows</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ person, row }) => (
              <tr key={person.id}>
                <td style={td}>{person.name}</td>
                <td style={{ ...td, color: "var(--color-secondary)" }}>{deptName(person.departmentId) || "-"}</td>
                <td style={{ ...num, fontWeight: 600 }}>{formatHours(row?.hours ?? 0)}</td>
                <td style={num}>{row?.attended ?? 0}</td>
                <td style={{ ...num, color: (row?.noShows ?? 0) > 0 ? "var(--color-warning)" : undefined }}>{row?.noShows ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
