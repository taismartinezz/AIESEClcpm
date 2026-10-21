"use client";

import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import type { User, MeetingProposal } from "@/types";
import Avatar from "@/components/ui/Avatar";
import { supabase } from "@/lib/supabase";

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

// ── Find a time (server: Google free/busy, weekly grids, LC events) ───────────

interface SuggestedSlot {
  start: string;      // ISO
  end: string;
  free: string[];
  busy: string[];
  unknown: string[];
}
type Source = "google" | "grid" | "none";

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const timeLabel = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  currentUserId: string;
  projectId: string;
  teamMembers: User[];
  onSubmit: (proposal: Omit<MeetingProposal, "id" | "createdAt" | "responses">) => void;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MeetingProposalModal({
  currentUserId, projectId, teamMembers, onSubmit, onClose,
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
  const [sources, setSources] = useState<Record<string, Source>>({});
  const [findError, setFindError] = useState<string | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<SuggestedSlot | null>(null);
  const [finding, setFinding] = useState(false);

  const invitableMembers = teamMembers.filter(m => m.id !== currentUserId);

  function toggleInvitee(id: string) {
    setInvitees(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    // Reset suggestions when attendees change
    setSuggestions(null);
    setSelectedSuggestion(null);
  }

  async function handleFindTime() {
    setFinding(true);
    setFindError(null);
    setSelectedSuggestion(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/scheduling/find-time", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ projectId, userIds: invitees, durationMinutes: duration, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSuggestions(body.suggestions ?? []);
      setSources(body.sources ?? {});
    } catch (e) {
      setFindError(`Couldn't look for times: ${e instanceof Error ? e.message : String(e)}`);
      setSuggestions(null);
    } finally {
      setFinding(false);
    }
  }

  function pickSuggestion(s: SuggestedSlot) {
    setSelectedSuggestion(s);
    const d = new Date(s.start);
    setDate(localDate(d));
    setTime(localTime(d));
    setError("");
  }

  const firstName = (id: string) => (id === currentUserId ? "you" : (teamMembers.find((m) => m.id === id)?.name.split(" ")[0] ?? "someone"));
  const names = (ids: string[]) => ids.map(firstName).join(", ");
  const noInfo = Object.entries(sources).filter(([, src]) => src === "none").map(([id]) => id);

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
              placeholder="e.g. Plan the info session"
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
                          {member.role === "president" && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-secondary)" }}>LCP</span>}
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
                  Uses Google Calendar (busy times only, never details) or each person&apos;s weekly availability.
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
                  No time in the next 14 days works for anyone you picked. Try a shorter meeting, or ask people to connect Google Calendar or fill in their availability in the Calendar.
                </p>
              </div>
            )}

            {suggestions !== null && suggestions.length > 0 && (
              <div className="space-y-2">
                {suggestions.map((s, i) => {
                  const isSelected = selectedSuggestion?.start === s.start;
                  const start = new Date(s.start), end = new Date(s.end);
                  const who = s.busy.length === 0 && s.unknown.length === 0 ? "Everyone's free"
                    : s.busy.length === 0 ? `Free for everyone we can check (no info for ${names(s.unknown)})`
                    : `Busy: ${names(s.busy)}`;
                  return (
                    <button key={i} onClick={() => pickSuggestion(s)}
                      className="w-full text-left rounded-lg transition-all"
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: "1.5px solid", borderColor: isSelected ? "var(--color-navy)" : "var(--color-border)", backgroundColor: isSelected ? "rgba(27,46,75,0.07)" : "var(--color-canvas)", cursor: "pointer" }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: isSelected ? "var(--color-navy)" : "rgba(27,46,75,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? "#fff" : "var(--color-navy)" }}>{i + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>{dayLabel(start)}</p>
                        <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "1px 0 0" }}>
                          {timeLabel(start)} – {timeLabel(end)} · <span style={{ color: s.busy.length ? "var(--color-warning)" : "var(--color-success, #00A86B)" }}>{who}</span>
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

          {findError && <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: "-8px 0 0" }}>{findError}</p>}
          {suggestions !== null && noInfo.length > 0 && (
            <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "-8px 0 0" }}>
              No calendar or availability for {names(noInfo)}: they can connect Google Calendar or fill in their availability in the Calendar.
            </p>
          )}

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
