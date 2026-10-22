"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Download, Mail, MapPin, Pencil, Plus, Trash2, UserCheck, ArrowUpDown, Video } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EVENT_TYPES, EVENT_TYPE_LABELS, attendanceByMember, formatEventDates, formatEventTime } from "@/lib/attendance";
import { authedPost, describeSend, type SendResult } from "@/lib/api-client";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { LcMember } from "@/hooks/useLcMembers";
import type { AttendanceRecord, Department, LcEvent, LcEventType } from "@/types";
import { Button, ErrorText, Panel, Stat, inputStyle, selectStyle } from "@/components/lc/ui";
import { askConfirm } from "@/components/ui/confirm";
import { formatDay } from "@/lib/dates";

// ── By event ──────────────────────────────────────────────────────────────────

export interface Rsvp { eventId: string; userId: string; response: "going" | "not_going" }

/** Going / Not going for the viewer; counts, names and "email invites" for the exec board. */
function RsvpBox({ event, rsvps, roster, userId, canManage, onChanged }: {
  event: LcEvent; rsvps: Rsvp[]; roster: LcMember[]; userId: string; canManage: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mine = rsvps.find((r) => r.eventId === event.id && r.userId === userId)?.response ?? null;
  const going = rsvps.filter((r) => r.eventId === event.id && r.response === "going");
  const notGoing = rsvps.filter((r) => r.eventId === event.id && r.response === "not_going");
  const upcoming = event.endsOn >= new Date().toISOString().slice(0, 10);
  const nameOf = (id: string) => roster.find((m) => m.id === id)?.name ?? "LC member";

  async function answer(response: "going" | "not_going") {
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("event_rsvps").upsert({ event_id: event.id, user_id: userId, response, responded_at: new Date().toISOString() }, { onConflict: "event_id,user_id" });
      if (err) throw new Error(err.message);
      onChanged();
    } catch (e) {
      setError(`Couldn't save your answer: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function emailInvites() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(describeSend(await authedPost<SendResult>("/api/events/invite", { eventId: event.id })));
      onChanged();
    } catch (e) {
      setError(`Couldn't send the invites: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!upcoming && !canManage) return null;
  return (
    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: 8 }}>
      {upcoming && (
        <div role="group" aria-label="Are you going?" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>Are you going?</span>
          <Button variant={mine === "going" ? "primary" : "secondary"} aria-pressed={mine === "going"} disabled={busy} onClick={() => answer("going")}>Going</Button>
          <Button variant={mine === "not_going" ? "primary" : "secondary"} aria-pressed={mine === "not_going"} disabled={busy} onClick={() => answer("not_going")}>Not going</Button>
        </div>
      )}
      {canManage && (
        <div style={{ fontSize: 12, color: "var(--color-body)" }}>
          <strong>{going.length}</strong> going · <strong>{notGoing.length}</strong> not going
          {going.length > 0 && <span style={{ color: "var(--color-secondary)" }}> · {going.slice(0, 8).map((r) => nameOf(r.userId)).join(", ")}{going.length > 8 ? "…" : ""}</span>}
          {upcoming && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <Button variant="secondary" disabled={busy} onClick={emailInvites}><Mail size={13} aria-hidden="true" /> {event.invitesSentAt ? "Email people who haven't had the invite" : "Email the invite"}</Button>
              {event.invitesSentAt && <span style={{ color: "var(--color-secondary)" }}>Invites sent {formatDay(event.invitesSentAt)}</span>}
            </div>
          )}
        </div>
      )}
      {note && <p role="status" style={{ fontSize: 12, color: "var(--color-body)", margin: 0 }}>{note}</p>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function EventsView({ events, records, rsvps, userId, roster, departments, canManage, onNew, onEdit, onLog, onChanged }: {
  events: LcEvent[]; records: AttendanceRecord[]; rsvps: Rsvp[]; userId: string; roster: LcMember[]; departments: Department[];
  canManage: boolean;
  onNew: () => void; onEdit: (e: LcEvent) => void; onLog: (e: LcEvent) => void; onChanged: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(events[0]?.id ?? null);
  const [type, setType] = useState<"all" | LcEventType>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = events.filter((e) => type === "all" || e.type === type);
  const selected = events.find((e) => e.id === selectedId) ?? shown[0] ?? null;
  const attendees = selected ? records.filter((r) => r.eventId === selected.id) : [];
  const nameOf = (id: string) => roster.find((m) => m.id === id)?.name ?? "LC member";
  const dept = (id: string | null) => departments.find((d) => d.id === id);

  async function remove(event: LcEvent) {
    if (!(await askConfirm(`Delete "${event.name}" and its attendance list?`))) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("lc_events").delete().eq("id", event.id);
      if (err) throw new Error(err.message);
      onChanged();
    } catch (e) {
      setError(`Couldn't delete the event: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16, alignItems: "start" }}>
      <Panel
        title="Events"
        action={<div style={{ display: "flex", gap: 8 }}>
          <select aria-label="Event type" value={type} onChange={(e) => setType(e.target.value as typeof type)} style={{ ...selectStyle, height: 32, width: 170 }}>
            <option value="all">All types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
          </select>
          {canManage && <Button onClick={onNew}><Plus size={14} aria-hidden="true" /> Event</Button>}
        </div>}
      >
        {shown.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>No events yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map((e) => {
              const active = selected?.id === e.id;
              const count = records.filter((r) => r.eventId === e.id).length;
              return (
                <li key={e.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <button
                    type="button" onClick={() => setSelectedId(e.id)} aria-pressed={active}
                    style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "10px 14px", textAlign: "left", border: "none", cursor: "pointer", backgroundColor: active ? "var(--color-navy-dim)" : "transparent" }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-body)" }}>{e.name}</span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)", marginTop: 2 }}>{EVENT_TYPE_LABELS[e.type]} · {formatEventDates(e)}</span>
                    </span>
                    <span style={{ fontSize: 12, color: "var(--color-secondary)", fontVariantNumeric: "tabular-nums" }}>{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {selected && (
        <Panel
          title={`${attendees.length} attendee${attendees.length === 1 ? "" : "s"}`}
          action={canManage && <div style={{ display: "flex", gap: 6 }}>
            <Button onClick={() => onLog(selected)}><UserCheck size={14} aria-hidden="true" /> Log attendance</Button>
            <button type="button" aria-label="Edit event" onClick={() => onEdit(selected)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6 }}><Pencil size={14} color="var(--color-secondary)" /></button>
            <button type="button" aria-label="Delete event" disabled={busy} onClick={() => remove(selected)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6 }}><Trash2 size={14} color="var(--color-secondary)" /></button>
          </div>}
        >
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "var(--color-navy)", margin: 0 }}>{selected.name}</p>
            <p style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "var(--color-secondary)", margin: "4px 0 0" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CalendarDays size={12} aria-hidden="true" />{formatEventDates(selected)}</span>
              {formatEventTime(selected) && <span>{formatEventTime(selected)}</span>}
              {selected.location && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><MapPin size={12} aria-hidden="true" />{selected.location}</span>}
              {selected.meetingUrl && <a href={selected.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--color-navy)" }}><Video size={12} aria-hidden="true" />Join online</a>}
              {dept(selected.departmentId) && <span>{dept(selected.departmentId)!.name}</span>}
            </p>
            {selected.description && <p style={{ fontSize: 12, color: "var(--color-body)", margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{selected.description}</p>}
          </div>
          <RsvpBox event={selected} rsvps={rsvps} roster={roster} userId={userId} canManage={canManage} onChanged={onChanged} />
          <ErrorText>{error}</ErrorText>
          {attendees.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>
              {canManage ? "No attendance logged yet." : "You weren't logged at this event."}
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: "4px 0" }}>
              {attendees.map((r) => {
                const m = roster.find((x) => x.id === r.userId);
                return (
                  <li key={r.userId} style={{ display: "flex", justifyContent: "space-between", padding: "6px 14px", fontSize: 13, color: "var(--color-body)" }}>
                    <span>{nameOf(r.userId)}</span>
                    <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{dept(m?.departmentId ?? null)?.name ?? ""}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}

// ── By member ─────────────────────────────────────────────────────────────────

export function ByMemberView({ events, records, people, termStart, initialUserId }: {
  events: LcEvent[]; records: AttendanceRecord[]; people: LcMember[]; termStart: string; initialUserId: string;
}) {
  const [userId, setUserId] = useState(initialUserId);
  const mine = records.filter((r) => r.userId === userId);
  const attended = events.filter((e) => mine.some((r) => r.eventId === e.id));
  const term = attendanceByMember(mine, events, { from: termStart }).get(userId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {people.length > 1 && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-secondary)" }}>
          Member
          <select value={userId} onChange={(e) => setUserId(e.target.value)} style={{ ...selectStyle, width: 240 }}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Stat label="Events this term" value={String(term?.total ?? 0)} note={`Since ${new Date(termStart + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`} />
        {EVENT_TYPES.filter((t) => (term?.byType[t] ?? 0) > 0).map((t) => (
          <Stat key={t} label={EVENT_TYPE_LABELS[t]} value={String(term!.byType[t])} note="this term" />
        ))}
      </div>
      <Panel title="Events attended">
        {attended.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>No attendance logged yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {attended.map((e) => (
              <li key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 14px", borderTop: "1px solid var(--color-border)", fontSize: 13 }}>
                <span style={{ color: "var(--color-body)" }}>{e.name}</span>
                <span style={{ color: "var(--color-secondary)", whiteSpace: "nowrap" }}>{EVENT_TYPE_LABELS[e.type]} · {formatEventDates(e)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

type SortKey = "name" | "department" | "total";

export function AttendanceTable({ events, records, people, departments }: {
  events: LcEvent[]; records: AttendanceRecord[]; people: LcMember[]; departments: Department[];
}) {
  const [departmentId, setDepartmentId] = useState("all");
  const [type, setType] = useState<"all" | LcEventType>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "total", dir: -1 });

  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "";
  const counts = useMemo(
    () => attendanceByMember(records, events, { from: from || undefined, to: to || undefined, types: type === "all" ? undefined : [type] }),
    [records, events, from, to, type],
  );
  const rows = people
    .filter((p) => departmentId === "all" || p.departmentId === departmentId)
    .map((p) => ({ ...p, total: counts.get(p.id)?.total ?? 0, byType: counts.get(p.id)?.byType }))
    .sort((a, b) => {
      const v = sort.key === "total" ? a.total - b.total
        : sort.key === "department" ? deptName(a.departmentId).localeCompare(deptName(b.departmentId))
        : a.name.localeCompare(b.name);
      return v * sort.dir || a.name.localeCompare(b.name);
    });

  const header = (key: SortKey, label: string, align: "left" | "right" = "left") => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} style={{ textAlign: align, padding: 0 }}>
      <button
        type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "total" ? -1 : 1 }))}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: "8px 10px", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)" }}
      >
        {label} <ArrowUpDown size={11} aria-hidden="true" />
      </button>
    </th>
  );

  function exportCsv() {
    downloadCsv(`attendance-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, [
      { header: "Name", value: (r) => r.name },
      { header: "Department", value: (r) => deptName(r.departmentId) },
      { header: "Events attended", value: (r) => r.total },
      ...EVENT_TYPES.map((t) => ({ header: EVENT_TYPE_LABELS[t], value: (r: (typeof rows)[number]) => r.byType?.[t] ?? 0 })),
    ]));
  }

  return (
    <Panel title="Attendance by member" action={<Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}><Download size={14} aria-hidden="true" /> CSV</Button>}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
        <select aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={{ ...selectStyle, width: 190, height: 34 }}>
          <option value="all">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select aria-label="Event type" value={type} onChange={(e) => setType(e.target.value as typeof type)} style={{ ...selectStyle, width: 190, height: 34 }}>
          <option value="all">All event types</option>
          {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-secondary)" }}>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...inputStyle, width: 140, height: 34 }} /></label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-secondary)" }}>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...inputStyle, width: 140, height: 34 }} /></label>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{header("name", "Name")}{header("department", "Department")}{header("total", "Events", "right")}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", fontSize: 13 }}>{r.name}</td>
                <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", fontSize: 13, color: "var(--color-secondary)" }}>{deptName(r.departmentId) || "-"}</td>
                <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", fontSize: 13, textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
