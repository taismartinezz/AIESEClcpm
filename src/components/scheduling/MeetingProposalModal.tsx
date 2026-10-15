"use client";

import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import type { User, MeetingProposal, WeeklyAvailability, ScheduleEvent, UserSettings, WorkingHours } from "@/types";
import Avatar from "@/components/ui/Avatar";

// Mirror slot constants from AvailabilityGrid - grid covers 9:00–16:30 in 30-min steps
const HOUR_START = 9;
const SLOT_COUNT = 16;

const DEFAULT_WORKING_HOURS: WorkingHours = {
  "0": { start: "09:00", end: "17:00" },
  "1": { start: "09:00", end: "17:00" },
  "2": { start: "09:00", end: "17:00" },
  "3": { start: "09:00", end: "17:00" },
  "4": { start: "09:00", end: "17:00" },
  "5": null,
  "6": null,
};

const DURATION_OPTIONS = [
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "45 min", value: 45 },
  { label: "1 hour", value: 60 },
  { label: "1.5 hours", value: 90 },
  { label: "2 hours", value: 120 },
];

const inputStyle: React.CSSProperties = {
  height: 38,
  border: "1px solid var(--color-border)",
  borderRadius: 7,
  padding: "0 10px",
  fontSize: 13,
  fontFamily: "var(--font-roboto)",
  backgroundColor: "var(--color-canvas)",
  color: "var(--color-body)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

// ── Time-finding helpers ───────────────────────────────────────────────────────

function parseTimeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minToTimeStr(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function minToLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${suffix}`;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface SuggestedSlot {
  date: string;       // YYYY-MM-DD
  startMin: number;   // minutes from midnight
  endMin: number;
  dayLabel: string;   // e.g. "Tuesday, Aug 12"
}

function findSuggestedTimes(
  attendeeIds: string[],
  durationMinutes: number,
  allAvailabilities: WeeklyAvailability[],
  allUserSettings: UserSettings[],
  proposals: MeetingProposal[],
  events: ScheduleEvent[],
): { slots: SuggestedSlot[]; noAvailData: boolean } {
  if (attendeeIds.length === 0) return { slots: [], noAvailData: false };

  const requiredSlots = Math.ceil(durationMinutes / 30);
  const BUFFER_MIN = 15;

  // Build per-attendee slot sets
  const availSets = attendeeIds.map(id => {
    const avail = allAvailabilities.find(a => a.userId === id);
    return new Set(avail?.slots ?? []);
  });

  // If nobody has set availability at all, flag it
  const noAvailData = availSets.every(s => s.size === 0);

  // Per-attendee working hours (falls back to 9AM-5PM default)
  const attendeeWorkingHours = attendeeIds.map(id => {
    const s = allUserSettings.find(u => u.userId === id);
    return s?.workingHours ?? DEFAULT_WORKING_HOURS;
  });

  const suggestions: SuggestedSlot[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let offset = 1; offset <= 14 && suggestions.length < 3; offset++) {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    const jsDay = d.getDay(); // 0=Sun…6=Sat
    const gridDay = jsDay - 1; // 0=Mon…4=Fri (jsDay 0=Sun would give -1, filtered below)

    // Skip weekend days (any attendee off) or days where any attendee has no working hours
    const anyoneOff = attendeeWorkingHours.some(wh => {
      const dayKey = String(gridDay >= 0 ? gridDay : 6); // Sun = key "6"
      return wh[dayKey] === null || wh[dayKey] === undefined;
    });
    if (jsDay === 0 || jsDay === 6 || anyoneOff) continue;

    const dateStr = d.toISOString().split("T")[0];
    const dayLabel = `${FULL_DAY_NAMES[gridDay]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;

    // Gather events/proposals on this date involving any attendee
    const busy: { startMin: number; endMin: number }[] = [];
    for (const ev of events) {
      if (ev.date !== dateStr || !ev.time) continue;
      busy.push({
        startMin: parseTimeToMin(ev.time),
        endMin: ev.endTime ? parseTimeToMin(ev.endTime) : parseTimeToMin(ev.time) + 60,
      });
    }
    for (const p of proposals) {
      if (p.proposedDate !== dateStr || !p.proposedTime) continue;
      const involves = attendeeIds.some(id => id === p.proposerId || p.inviteeIds.includes(id));
      if (!involves) continue;
      const sm = parseTimeToMin(p.proposedTime);
      busy.push({ startMin: sm, endMin: sm + p.durationMinutes });
    }

    // Compute the intersection of working-hour windows for this day across all attendees
    const dayKey = String(gridDay);
    const workWindowStart = Math.max(...attendeeWorkingHours.map(wh => parseTimeToMin((wh[dayKey] as { start: string; end: string }).start)));
    const workWindowEnd   = Math.min(...attendeeWorkingHours.map(wh => parseTimeToMin((wh[dayKey] as { start: string; end: string }).end)));

    for (let s = 0; s <= SLOT_COUNT - requiredSlots && suggestions.length < 3; s++) {
      const startMin = HOUR_START * 60 + s * 30;
      const endMin = startMin + durationMinutes;

      // Skip if outside any attendee's working hours
      if (startMin < workWindowStart || endMin > workWindowEnd) continue;

      // All attendees must have every required consecutive slot available
      const allFree = availSets.every(avail => {
        for (let i = s; i < s + requiredSlots; i++) {
          if (!avail.has(`${gridDay}-${i}`)) return false;
        }
        return true;
      });
      if (!allFree) continue;

      // 15-min buffer around any existing event
      const blocked = busy.some(b => startMin < b.endMin + BUFFER_MIN && endMin > b.startMin - BUFFER_MIN);
      if (blocked) continue;

      suggestions.push({ date: dateStr, startMin, endMin, dayLabel });
    }
  }

  return { slots: suggestions.slice(0, 3), noAvailData };
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  currentUserId: string;
  teamMembers: User[];
  allAvailabilities: WeeklyAvailability[];
  allUserSettings: UserSettings[];
  proposals: MeetingProposal[];
  events: ScheduleEvent[];
  onSubmit: (proposal: Omit<MeetingProposal, "id" | "createdAt" | "responses">) => void;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MeetingProposalModal({
  currentUserId, teamMembers, allAvailabilities, allUserSettings, proposals, events, onSubmit, onClose,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);
  const [invitees, setInvitees] = useState<string[]>([]);
  const [error, setError] = useState("");

  // Find-a-time state
  const [suggestions, setSuggestions] = useState<SuggestedSlot[] | null>(null);
  const [noAvailData, setNoAvailData] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<SuggestedSlot | null>(null);
  const [finding, setFinding] = useState(false);

  const invitableMembers = teamMembers.filter(m => m.id !== currentUserId);

  function toggleInvitee(id: string) {
    setInvitees(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    // Reset suggestions when attendees change
    setSuggestions(null);
    setSelectedSuggestion(null);
    setNoAvailData(false);
  }

  function handleFindTime() {
    setFinding(true);
    const allAttendees = [currentUserId, ...invitees];
    const result = findSuggestedTimes(allAttendees, duration, allAvailabilities, allUserSettings, proposals, events);
    setSuggestions(result.slots);
    setNoAvailData(result.noAvailData);
    setSelectedSuggestion(null);
    setFinding(false);
  }

  function pickSuggestion(s: SuggestedSlot) {
    setSelectedSuggestion(s);
    setDate(s.date);
    setTime(minToTimeStr(s.startMin));
    setError("");
  }

  function handleSubmit() {
    if (!title.trim()) { setError("Please enter a meeting title."); return; }
    if (!date) { setError("Please select a date."); return; }
    if (!time) { setError("Please select a time."); return; }
    if (invitees.length === 0) { setError("Please invite at least one person."); return; }
    setError("");
    onSubmit({
      projectId: "",
      proposerId: currentUserId,
      title: title.trim(),
      description: description.trim() || undefined,
      proposedDate: date,
      proposedTime: time,
      durationMinutes: duration,
      inviteeIds: invitees,
    });
  }

  const canFindTime = invitees.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(27,46,75,0.35)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="animate-slide-up-fade"
        style={{
          backgroundColor: "var(--color-surface)",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(27,46,75,0.18)",
          width: "100%",
          maxWidth: 500,
          margin: "0 16px",
          maxHeight: "92vh",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "var(--color-navy)", margin: 0 }}>
            Propose a Meeting
          </h2>
          <button onClick={onClose} style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer", borderRadius: 7 }}>
            <X size={16} color="var(--color-secondary)" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">

          {/* Title */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", display: "block", marginBottom: 5, letterSpacing: "0.03em" }}>
              MEETING TITLE
            </label>
            <input
              autoFocus
              value={title}
              onChange={e => { setTitle(e.target.value); setError(""); }}
              placeholder="e.g. Consent Form Review"
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            />
          </div>

          {/* Duration */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", display: "block", marginBottom: 5, letterSpacing: "0.03em" }}>
              DURATION
            </label>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => { setDuration(opt.value); setSuggestions(null); setSelectedSuggestion(null); }}
                  style={{ padding: "5px 12px", borderRadius: 20, border: "1px solid", borderColor: duration === opt.value ? "var(--color-navy)" : "var(--color-border)", backgroundColor: duration === opt.value ? "var(--color-navy)" : "transparent", color: duration === opt.value ? "#fff" : "var(--color-body)", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "var(--font-roboto)" }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Invite */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", display: "block", marginBottom: 5, letterSpacing: "0.03em" }}>
              INVITE
            </label>
            {invitableMembers.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: "8px 0" }}>No teammates yet.</p>
            ) : (
              <div className="space-y-1">
                {invitableMembers.map(member => {
                  const isChecked = invitees.includes(member.id);
                  return (
                    <button key={member.id} onClick={() => toggleInvitee(member.id)}
                      className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-left transition-colors"
                      style={{ border: "1px solid", borderColor: isChecked ? "var(--color-navy)" : "var(--color-border)", backgroundColor: isChecked ? "rgba(27,46,75,0.05)" : "transparent", cursor: "pointer" }}>
                      <Avatar user={member} size={26} />
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-body)", margin: 0 }}>
                          {member.name}
                          {member.role === "pi" && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-secondary)" }}>PI</span>}
                        </p>
                      </div>
                      <div style={{ width: 16, height: 16, borderRadius: 4, border: "2px solid", borderColor: isChecked ? "var(--color-navy)" : "var(--color-border)", backgroundColor: isChecked ? "var(--color-navy)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {isChecked && (
                          <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                            <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Find a time ─────────────────────────────────────────────────── */}
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", margin: 0, letterSpacing: "0.03em" }}>FIND A TIME</p>
                <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0", opacity: 0.8 }}>
                  Checks everyone&apos;s availability and suggests open slots.
                </p>
              </div>
              <button
                onClick={handleFindTime}
                disabled={!canFindTime || finding}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 7, border: "1px solid", borderColor: canFindTime ? "var(--color-navy)" : "var(--color-border)", backgroundColor: canFindTime ? "rgba(27,46,75,0.06)" : "transparent", color: canFindTime ? "var(--color-navy)" : "var(--color-secondary)", fontSize: 12, fontWeight: 600, cursor: canFindTime ? "pointer" : "not-allowed", fontFamily: "var(--font-roboto)", flexShrink: 0 }}
              >
                <Sparkles size={13} />
                {finding ? "Searching…" : "Find best times"}
              </button>
            </div>

            {!canFindTime && (
              <p style={{ fontSize: 12, color: "var(--color-secondary)", fontStyle: "italic" }}>
                Select at least one person to invite first.
              </p>
            )}

            {suggestions !== null && suggestions.length === 0 && (
              <div style={{ backgroundColor: "rgba(27,46,75,0.04)", borderRadius: 8, padding: "10px 14px" }}>
                <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
                  {noAvailData
                    ? "No availability data found. Ask your team to set their availability in the Availability tab, then try again."
                    : "No common availability found in the next 14 days for the selected attendees and duration. Try a shorter duration or check the Availability tab."}
                </p>
              </div>
            )}

            {suggestions !== null && suggestions.length > 0 && (
              <div className="space-y-2">
                {suggestions.map((s, i) => {
                  const isSelected = selectedSuggestion?.date === s.date && selectedSuggestion?.startMin === s.startMin;
                  return (
                    <button key={i} onClick={() => pickSuggestion(s)}
                      className="w-full text-left rounded-lg transition-all"
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: "1.5px solid", borderColor: isSelected ? "var(--color-navy)" : "var(--color-border)", backgroundColor: isSelected ? "rgba(27,46,75,0.07)" : "var(--color-canvas)", cursor: "pointer" }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: isSelected ? "var(--color-navy)" : "rgba(27,46,75,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? "#fff" : "var(--color-navy)" }}>{i + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>{s.dayLabel}</p>
                        <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "1px 0 0" }}>
                          {minToLabel(s.startMin)} – {minToLabel(s.endMin)}
                        </p>
                      </div>
                      {isSelected && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-navy)", flexShrink: 0 }}>Selected</span>
                      )}
                    </button>
                  );
                })}
                <p style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 4 }}>
                  Click a suggestion to fill in date and time, or enter them manually below.
                </p>
              </div>
            )}
          </div>

          {/* Date + Time (manual entry / fallback) */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", display: "block", marginBottom: 5, letterSpacing: "0.03em" }}>
              DATE &amp; TIME
            </label>
            <div className="flex gap-3">
              <input type="date" value={date} onChange={e => { setDate(e.target.value); setSelectedSuggestion(null); setError(""); }}
                style={{ ...inputStyle, flex: 1 }}
                onFocus={e => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
              />
              <input type="time" value={time} onChange={e => { setTime(e.target.value); setSelectedSuggestion(null); setError(""); }}
                style={{ ...inputStyle, flex: 1 }}
                onFocus={e => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", display: "block", marginBottom: 5, letterSpacing: "0.03em" }}>
              DESCRIPTION (OPTIONAL)
            </label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="What is this meeting about?" rows={3}
              style={{ ...inputStyle, height: "auto", padding: "8px 10px", resize: "none", lineHeight: 1.5 }}
              onFocus={e => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            />
          </div>

          {error && <p style={{ fontSize: 12, color: "var(--color-error)", margin: 0 }} role="alert">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4" style={{ borderTop: "1px solid var(--color-border)" }}>
          <button onClick={onClose} style={{ fontSize: 13, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", padding: "8px 12px" }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={invitableMembers.length === 0}
            style={{ backgroundColor: invitableMembers.length === 0 ? "var(--color-border)" : "var(--color-navy)", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, padding: "8px 20px", cursor: invitableMembers.length === 0 ? "not-allowed" : "pointer", fontFamily: "var(--font-roboto)" }}>
            Send Proposal
          </button>
        </div>
      </div>
    </div>
  );
}
