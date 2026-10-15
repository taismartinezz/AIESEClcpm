"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  X, ChevronLeft, Lock, Phone, Globe, Mail, MapPin,
  Send, Check, ChevronRight, Mic, MicOff,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import { resolveResources, hasNoCounselingResources } from "@/lib/support/institutions";
import type { LabResource, ResolvedResource } from "@/lib/support/institutions";

// ── Types ──────────────────────────────────────────────────────────────────────

type Screen =
  | { id: "entry" }
  | { id: "pick" }
  | { id: "compose"; recipient: Member }
  | { id: "sent"; recipientName: string; msgId: string }
  | { id: "b" }
  | { id: "b_pick"; filter: "pi" | "all" }
  | { id: "b_message"; recipient: Member };

interface Member {
  id: string;
  name: string;
  role: "pi" | "researcher";
  avatarColor: string;
  avatarInitials: string;
  avatarUrl?: string;
  contextNote?: string; // e.g. "PI", "on this task with you"
}

type SupportResource = LabResource;

// ── Props ─────────────────────────────────────────────────────────────────────

interface SupportPanelProps {
  track?: "work" | "wellbeing";
  onClose: () => void;
  projectId: string | null;
  userId: string;
}

// ── Timing chips ──────────────────────────────────────────────────────────────

type TimingChoice = "now" | "later_today" | "this_week";

const TIMING_OPTIONS: Array<{ id: TimingChoice; label: string; line: string }> = [
  { id: "now",         label: "Right now",     line: "I'm free right now if you have a moment." },
  { id: "later_today", label: "Later today",   line: "I'm free later today." },
  { id: "this_week",  label: "This week",      line: "Anytime this week works for me." },
];

// ── Slot-proposal helpers ─────────────────────────────────────────────────────

const SLOT_COUNT = 16;
const HOUR_START = 9;
const MONTH_ABR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_ABR   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

interface SuggestedSlot {
  date: string;
  startMin: number;
  shortLabel: string; // e.g. "Tue Aug 19, 10:00 AM"
}

function minToLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${suffix}`;
}

function findRecipientSlots(recipientSlotSet: Set<string>): SuggestedSlot[] {
  const results: SuggestedSlot[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let offset = 1; offset <= 14 && results.length < 3; offset++) {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    const jsDay = d.getDay();
    if (jsDay === 0 || jsDay === 6) continue;
    const gridDay = jsDay - 1; // 0=Mon

    for (let s = 0; s < SLOT_COUNT && results.length < 3; s++) {
      if (!recipientSlotSet.has(`${gridDay}-${s}`)) continue;
      const startMin = HOUR_START * 60 + s * 30;
      const dateStr = d.toISOString().split("T")[0];
      results.push({
        date: dateStr,
        startMin,
        shortLabel: `${DAY_ABR[jsDay]} ${MONTH_ABR[d.getMonth()]} ${d.getDate()}, ${minToLabel(startMin)}`,
      });
      break; // one slot per day
    }
  }
  return results;
}

function firstName(fullName: string): string {
  return fullName.split(" ")[0] || fullName;
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(" ").map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
}

function dmChannelKey(a: string, b: string): string {
  return `dm:${[a, b].sort().join(":")}`;
}

function contactHref(type: SupportResource["contact_type"], value: string): string {
  if (type === "phone") return `tel:${value}`;
  if (type === "email") return `mailto:${value}`;
  if (type === "url") return value.startsWith("http") ? value : `https://${value}`;
  return "";
}

function ContactIcon({ type, isUrgent }: { type: SupportResource["contact_type"]; isUrgent?: boolean }) {
  const sz = 15;
  const col = isUrgent ? "var(--color-error)" : "var(--color-navy)";
  if (type === "phone") return <Phone size={sz} color={col} />;
  if (type === "url") return <Globe size={sz} color={col} />;
  if (type === "email") return <Mail size={sz} color={col} />;
  return <MapPin size={sz} color={col} />;
}

// ── Panel shell ───────────────────────────────────────────────────────────────

function PanelShell({ title, onBack, onClose, children }: {
  title: string; onBack?: () => void; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 shrink-0" style={{
        height: 52, borderBottom: "1px solid var(--color-border)",
        backgroundColor: "var(--color-surface)",
      }}>
        {onBack && (
          <button onClick={onBack} aria-label="Back"
            className="flex items-center justify-center rounded-lg"
            style={{ width: 36, height: 36, minHeight: 44, border: "none", background: "transparent", cursor: "pointer" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-dimmed-bg)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
          >
            <ChevronLeft size={18} color="var(--color-secondary)" />
          </button>
        )}
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--color-body)", fontFamily: "var(--font-roboto)" }}>
          {title}
        </span>
        <button onClick={onClose} aria-label="Close panel"
          className="flex items-center justify-center rounded-lg"
          style={{ width: 36, height: 36, minHeight: 44, border: "none", background: "transparent", cursor: "pointer" }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-dimmed-bg)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
        >
          <X size={16} color="var(--color-secondary)" />
        </button>
      </div>
      {/* maxHeight = dialog cap (640px or viewport) minus header (52px). The dialog itself is
          height:auto so it shrinks on short screens; this div scrolls on tall content. */}
      <div style={{ overflowY: "auto", maxHeight: "calc(min(640px, 100vh - 32px) - 52px)", padding: "20px 20px 32px" }}>
        {children}
      </div>
    </div>
  );
}

// ── SupportPanel ──────────────────────────────────────────────────────────────

export default function SupportPanel({ track, onClose, projectId, userId }: SupportPanelProps) {
  // ── Data ────────────────────────────────────────────────────────────────────
  const [members, setMembers] = useState<Member[]>([]);
  const [resources, setResources] = useState<SupportResource[]>([]);
  const [institutionKey, setInstitutionKey] = useState<string | null>(null);
  const [isCurrentUserPi, setIsCurrentUserPi] = useState(false);
  const [piInvitation, setPiInvitation] = useState<{ text: string; piName: string } | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  // ── Screen ───────────────────────────────────────────────────────────────────
  const initialScreen: Screen = track === "wellbeing" ? { id: "b" } : { id: "entry" };
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [history, setHistory] = useState<Screen[]>([]);

  const push = useCallback((s: Screen) => {
    setHistory((h) => [...h, screen]);
    setScreen(s);
  }, [screen]);

  const back = useCallback(() => {
    const prev = history[history.length - 1];
    if (prev) {
      setHistory((h) => h.slice(0, -1));
      setScreen(prev);
    } else {
      onClose();
    }
  }, [history, onClose]);

  // ── Focus trap + ESC ─────────────────────────────────────────────────────────
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [screen, onClose]);

  // ── Load data ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId) { setLoadingData(false); return; }

    async function load() {
      if (!projectId) return;
      try {
        const [membQ, resQ, projQ] = await Promise.all([
          supabase
            .from("team_members")
            .select("user_id, role, user_profiles(name, avatar_initials, avatar_color, avatar_url)")
            .eq("project_id", projectId),
          supabase
            .from("support_resources")
            .select("id, label, description, confidentiality, category, contact_type, contact_value, availability, is_pinned, sort_order, active")
            .eq("project_id", projectId)
            .order("sort_order"),
          supabase
            .from("projects")
            .select("support_invitation, owner_id, institution_key")
            .eq("id", projectId)
            .single(),
        ]);

        const rawMembers: Member[] = (membQ.data ?? []).map((row: Record<string, unknown>) => {
          const raw = row["user_profiles"];
          const prof = (Array.isArray(raw) ? raw[0] : raw) as Record<string, string> | null;
          return {
            id: row["user_id"] as string,
            name: prof?.["name"] ?? "Team member",
            role: row["role"] as "pi" | "researcher",
            avatarColor: prof?.["avatar_color"] ?? "#B4D4E3",
            avatarInitials: prof?.["avatar_initials"] ?? initials(prof?.["name"] ?? "TM"),
            avatarUrl: prof?.["avatar_url"] ?? undefined,
          };
        }).filter((m) => m.id !== userId);
        setMembers(rawMembers);

        setResources((resQ.data ?? []) as SupportResource[]);

        if (!projQ.error && projQ.data) {
          const pd = projQ.data as Record<string, unknown>;
          if (pd["support_invitation"]) {
            const piMember = rawMembers.find((m) => m.role === "pi");
            setPiInvitation({ text: pd["support_invitation"] as string, piName: piMember?.name ?? "PI" });
          }
          if (pd["institution_key"]) setInstitutionKey(pd["institution_key"] as string);
          if (pd["owner_id"]) setIsCurrentUserPi((pd["owner_id"] as string) === userId);
        }
      } catch { /* non-fatal */ } finally {
        setLoadingData(false);
      }
    }

    if (isSupabaseConfigured) {
      void load();
    } else {
      setLoadingData(false);
    }
  }, [projectId, userId]);

  // ── Render ───────────────────────────────────────────────────────────────────
  const pi = members.find((m) => m.role.toLowerCase() === "pi");
  const canGoBack = history.length > 0;

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "rgba(27,46,75,0.45)" }}
      onClick={onClose}
      aria-hidden="false"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Support"
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(520px, 100%)",
          maxHeight: "min(640px, calc(100vh - 32px))",
          backgroundColor: "var(--color-surface)",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 8px 40px rgba(27,46,75,0.22)",
        }}
      >
        {screen.id === "entry" && (
          <EntryScreen
            piInvitation={piInvitation}
            onHelp={() => push({ id: "pick" })}
            onResources={() => push({ id: "b" })}
            onClose={onClose}
          />
        )}

        {screen.id === "pick" && (
          <SimplePickScreen
            members={members}
            onBack={back}
            onClose={onClose}
            onSelect={(recipient) => push({ id: "compose", recipient })}
          />
        )}

        {screen.id === "compose" && (
          <SimpleComposeScreen
            recipient={screen.recipient}
            projectId={projectId}
            userId={userId}
            onBack={back}
            onClose={onClose}
            onSent={(msgId) => {
              setHistory([]);
              setScreen({ id: "sent", recipientName: screen.recipient.name, msgId });
            }}
          />
        )}

        {screen.id === "sent" && (
          <ASentScreen
            recipientName={screen.recipientName}
            msgId={screen.msgId}
            onClose={onClose}
            onDone={() => {
              setHistory([]);
              setScreen({ id: "entry" });
            }}
          />
        )}

        {screen.id === "b" && (
          <BScreen
            resources={resources}
            institutionKey={institutionKey}
            loading={loadingData}
            pi={pi}
            members={members}
            isCurrentUserPi={isCurrentUserPi}
            projectId={projectId}
            onBack={canGoBack ? back : undefined}
            onClose={onClose}
            onPickRecipient={(filter) => push({ id: "b_pick", filter })}
          />
        )}

        {screen.id === "b_pick" && (
          <BPickScreen
            filter={screen.filter}
            members={members}
            pi={pi}
            onBack={back}
            onClose={onClose}
            onSelect={(recipient) => push({ id: "b_message", recipient })}
          />
        )}

        {screen.id === "b_message" && (
          <BMessageScreen
            recipient={screen.recipient}
            projectId={projectId}
            userId={userId}
            onBack={back}
            onClose={onClose}
            onSent={(msgId) => {
              setHistory([]);
              setScreen({ id: "sent", recipientName: screen.recipient.name, msgId });
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Screen: Entry ────────────────────────────────────────────────────────────

function EntryScreen({ piInvitation, onHelp, onResources, onClose }: {
  piInvitation: { text: string; piName: string } | null;
  onHelp: () => void;
  onResources: () => void;
  onClose: () => void;
}) {
  return (
    <PanelShell title="Get support" onClose={onClose}>
      {/* Privacy statement - upfront, not buried */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", backgroundColor: "var(--color-canvas)", borderRadius: 8, marginBottom: 20, border: "1px solid var(--color-border)" }}>
        <Lock size={13} color="var(--color-secondary)" style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0, lineHeight: 1.6 }}>
          What you write here is only seen by the person you message. Nothing in this flow is recorded or shared with your lab or advisor.
        </p>
      </div>

      {piInvitation && (
        <blockquote style={{ margin: "0 0 20px", padding: "10px 14px", borderLeft: "3px solid var(--color-border)", color: "var(--color-secondary)", fontSize: 13, lineHeight: 1.6 }}>
          <span style={{ fontWeight: 600 }}>{piInvitation.piName}:</span>{" "}
          &ldquo;{piInvitation.text}&rdquo;
        </blockquote>
      )}

      <button
        onClick={onHelp}
        style={{
          width: "100%", height: 52, fontSize: 15, fontWeight: 700,
          backgroundColor: "transparent", color: "var(--color-navy)",
          border: "2px solid var(--color-navy)", borderRadius: 10, cursor: "pointer",
          fontFamily: "var(--font-roboto)", marginBottom: 10,
        }}
      >
        I&rsquo;d like some help
      </button>

      <button
        onClick={onResources}
        style={{
          width: "100%", height: 52, fontSize: 15, fontWeight: 700,
          backgroundColor: "transparent", color: "var(--color-navy)",
          border: "2px solid var(--color-navy)", borderRadius: 10,
          cursor: "pointer", fontFamily: "var(--font-roboto)",
        }}
      >
        See wellbeing resources
      </button>
    </PanelShell>
  );
}

// ── Screen: Pick recipient ────────────────────────────────────────────────────

function SimplePickScreen({ members, onBack, onClose, onSelect }: {
  members: Member[];
  onBack: () => void;
  onClose: () => void;
  onSelect: (m: Member) => void;
}) {
  const sorted = [...members].sort((a, b) => {
    if (a.role === "pi" && b.role !== "pi") return -1;
    if (b.role === "pi" && a.role !== "pi") return 1;
    return a.name.localeCompare(b.name);
  }).map((m) => ({ ...m, contextNote: m.role === "pi" ? "PI" : "Researcher" }));

  return (
    <PanelShell title="Who would you like to reach?" onBack={onBack} onClose={onClose}>
      {sorted.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>No team members found.</p>
      )}
      <div className="flex flex-col gap-2">
        {sorted.map((m) => (
          <MemberRow key={m.id} member={m} onClick={() => onSelect(m)} />
        ))}
      </div>
    </PanelShell>
  );
}

function MemberRow({ member, onClick }: { member: Member; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        backgroundColor: hov ? "var(--color-dimmed-bg)" : "transparent",
        cursor: "pointer",
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        gap: 12,
        transition: "background-color 100ms",
      }}
    >
      <Avatar user={member} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0, fontFamily: "var(--font-roboto)" }}>
          {member.name}
        </p>
        {member.contextNote && (
          <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>
            {member.contextNote}
          </p>
        )}
      </div>
      <ChevronRight size={14} color="var(--color-secondary)" />
    </button>
  );
}

// ── Screen: Compose ──────────────────────────────────────────────────────────

function SimpleComposeScreen({ recipient, projectId, userId, onBack, onClose, onSent }: {
  recipient: Member;
  projectId: string | null;
  userId: string;
  onBack: () => void;
  onClose: () => void;
  onSent: (msgId: string) => void;
}) {
  const greeting = `Hi ${firstName(recipient.name)},`;
  const [body, setBody] = useState(greeting + "\n");
  const [timing, setTiming] = useState<TimingChoice | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Slot proposals
  const [showSlots, setShowSlots] = useState(false);
  const [slots, setSlots] = useState<SuggestedSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState<SuggestedSlot[]>([]);
  const [slotsLoaded, setSlotsLoaded] = useState(false);

  async function openSlots() {
    setShowSlots(v => !v);
    if (slotsLoaded || !projectId) return;
    setSlotsLoading(true);
    try {
      const { data } = await supabase
        .from("user_availability")
        .select("slots")
        .eq("project_id", projectId)
        .eq("user_id", recipient.id)
        .maybeSingle();
      const slotSet = new Set<string>((data?.slots as string[]) ?? []);
      setSlots(findRecipientSlots(slotSet));
    } catch { /* non-fatal */ } finally {
      setSlotsLoading(false);
      setSlotsLoaded(true);
    }
  }

  function toggleSlot(slot: SuggestedSlot) {
    setSelectedSlots(prev =>
      prev.some(s => s.date === slot.date)
        ? prev.filter(s => s.date !== slot.date)
        : prev.length < 3 ? [...prev, slot] : prev
    );
  }

  function addSlotsToMessage() {
    if (selectedSlots.length === 0) return;
    const times = selectedSlots.map(s => s.shortLabel).join(", ");
    const line = selectedSlots.length === 1
      ? `\n\nWould this work? ${times}.`
      : `\n\nWould any of these work? ${times}.`;
    setBody(b => b.trimEnd() + line);
    setSelectedSlots([]);
    setShowSlots(false);
  }

  function toggleTiming(choice: TimingChoice) {
    setTiming(prev => prev === choice ? null : choice);
  }

  async function send() {
    const timingLine = timing ? TIMING_OPTIONS.find(t => t.id === timing)?.line : null;
    const fullBody = body.trim() + (timingLine ? `\n\n${timingLine}` : "");
    if (!fullBody.trim()) return;
    setSending(true);
    setError("");
    const msgId = crypto.randomUUID();
    try {
      if (isSupabaseConfigured && projectId) {
        const { error: err } = await supabase.from("chat_messages").insert({
          id: msgId,
          channel: dmChannelKey(userId, recipient.id),
          sender_id: userId,
          content: fullBody,
          thread_parent_id: null,
          mentioned_user_ids: [],
          attachments: [],
        });
        if (err) throw err;
      }
      onSent(msgId);
    } catch {
      setError("Something went wrong. Try again, or copy and send the message manually.");
      setSending(false);
    }
  }

  const hasContent = body.trim().length > greeting.length;

  return (
    <PanelShell title={`Message ${firstName(recipient.name)}`} onBack={onBack} onClose={onClose}>
      {/* Recipient header */}
      <div className="flex items-center gap-3 mb-4">
        <Avatar user={recipient} size={36} />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", margin: 0, fontFamily: "var(--font-roboto)" }}>
            {recipient.name}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {recipient.contextNote && (
              <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: 0 }}>{recipient.contextNote}</p>
            )}
            <button onClick={onBack} style={{ fontSize: 11, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", fontFamily: "var(--font-roboto)" }}>
              Change
            </button>
          </div>
        </div>
      </div>

      {/* Privacy reminder */}
      <p style={{ fontSize: 11, color: "var(--color-secondary)", display: "flex", alignItems: "center", gap: 5, marginBottom: 10 }}>
        <Lock size={11} /> Only {firstName(recipient.name)} will see this.
      </p>

      {/* Blank message textarea - "Hi Name," pre-seeded, no template */}
      <VoiceDraftTextarea
        value={body}
        onChange={setBody}
        rows={7}
        placeholder={`${greeting}\n`}
      />

      {/* Timing chips - lightweight, optional */}
      <div style={{ marginTop: 14 }}>
        <p style={{ fontSize: 11, color: "var(--color-secondary)", marginBottom: 8 }}>
          When are you free to talk? (optional)
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TIMING_OPTIONS.map((opt) => {
            const on = timing === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => toggleTiming(opt.id)}
                style={{
                  fontSize: 12, padding: "6px 14px", borderRadius: 20, minHeight: 36,
                  border: `1px solid ${on ? "var(--color-navy)" : "var(--color-border)"}`,
                  backgroundColor: on ? "var(--color-navy)" : "transparent",
                  color: on ? "#fff" : "var(--color-body)",
                  cursor: "pointer", fontFamily: "var(--font-roboto)",
                  transition: "background-color 120ms, border-color 120ms",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Slot proposals - optional */}
      <div style={{ marginTop: 10 }}>
        <button
          onClick={openSlots}
          style={{
            fontSize: 12, color: "var(--color-secondary)",
            background: "transparent", border: "1px solid var(--color-border)",
            borderRadius: 20, padding: "5px 14px", cursor: "pointer",
            fontFamily: "var(--font-roboto)", minHeight: 36,
          }}
        >
          {showSlots ? "Hide times" : "Suggest a time to meet"}
        </button>

        {showSlots && (
          <div style={{ marginTop: 10 }}>
            {slotsLoading && (
              <p style={{ fontSize: 12, color: "var(--color-secondary)" }}>Looking for open times…</p>
            )}
            {!slotsLoading && slots.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--color-secondary)" }}>
                No availability set - {firstName(recipient.name)} hasn&rsquo;t filled in their schedule yet.
              </p>
            )}
            {!slotsLoading && slots.length > 0 && (
              <>
                <p style={{ fontSize: 11, color: "var(--color-secondary)", marginBottom: 8 }}>
                  Pick up to 3 times from {firstName(recipient.name)}&rsquo;s availability:
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {slots.map((slot) => {
                    const on = selectedSlots.some(s => s.date === slot.date);
                    return (
                      <button
                        key={slot.date}
                        onClick={() => toggleSlot(slot)}
                        style={{
                          textAlign: "left", fontSize: 13, padding: "8px 12px", borderRadius: 8,
                          border: `1px solid ${on ? "var(--color-navy)" : "var(--color-border)"}`,
                          backgroundColor: on ? "rgba(27,46,75,0.07)" : "transparent",
                          color: "var(--color-body)", cursor: "pointer",
                          fontFamily: "var(--font-roboto)", minHeight: 44,
                          display: "flex", alignItems: "center", gap: 10,
                        }}
                      >
                        {on && <Check size={13} color="var(--color-navy)" />}
                        {!on && <span style={{ width: 13 }} />}
                        {slot.shortLabel}
                      </button>
                    );
                  })}
                </div>
                {selectedSlots.length > 0 && (
                  <button
                    onClick={addSlotsToMessage}
                    style={{
                      marginTop: 10, fontSize: 12, fontWeight: 600,
                      color: "var(--color-navy)", background: "transparent",
                      border: "1px solid var(--color-navy)", borderRadius: 7,
                      padding: "6px 14px", cursor: "pointer",
                      fontFamily: "var(--font-roboto)", minHeight: 36,
                    }}
                  >
                    Add {selectedSlots.length} time{selectedSlots.length > 1 ? "s" : ""} to message
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-error)", marginTop: 10 }}>{error}</p>
      )}

      <button
        onClick={send}
        disabled={sending || !hasContent}
        style={{
          marginTop: 16, width: "100%", height: 48,
          backgroundColor: hasContent ? "var(--color-navy)" : "var(--color-dimmed-bg)",
          color: hasContent ? "#fff" : "var(--color-secondary)",
          border: "none", borderRadius: 8,
          fontSize: 14, fontWeight: 700, cursor: hasContent ? "pointer" : "default",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          fontFamily: "var(--font-roboto)", opacity: sending ? 0.7 : 1,
        }}
      >
        <Send size={14} />
        {sending ? "Sending…" : "Send"}
      </button>
    </PanelShell>
  );
}


// ── Screen: Sent confirmation ─────────────────────────────────────────────────

function ASentScreen({ recipientName, msgId: _msgId, onClose, onDone }: {
  recipientName: string;
  msgId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <PanelShell title="Message sent" onClose={onClose}>
      <div style={{ textAlign: "center", padding: "32px 0" }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", backgroundColor: "var(--color-success-bg, #e6f4ea)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <Check size={24} color="var(--color-success, #2d7a3a)" />
        </div>
        <p style={{ fontSize: 16, fontWeight: 700, color: "var(--color-body)", margin: "0 0 8px", fontFamily: "var(--font-roboto)" }}>
          Message sent to {recipientName}
        </p>
        <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: "0 0 28px", lineHeight: 1.6 }}>
          Only {recipientName.split(" ")[0]} will see it.
        </p>
        <button
          onClick={onDone}
          style={{
            width: "100%", height: 48, fontSize: 14, fontWeight: 600,
            backgroundColor: "var(--color-navy)", color: "#fff",
            border: "none", borderRadius: 10, cursor: "pointer",
            fontFamily: "var(--font-roboto)",
          }}
        >
          Done
        </button>
      </div>
    </PanelShell>
  );
}

// ── Voice-enabled textarea ────────────────────────────────────────────────────

interface ISpeechRecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface ISpeechRecognitionResultList { length: number; [i: number]: ISpeechRecognitionResult }
interface ISpeechRecognitionEvent { resultIndex: number; results: ISpeechRecognitionResultList }
interface ISpeechRecognitionErrorEvent { error: string }
interface ISpeechRecognition {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void;
  onresult: ((e: ISpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: ISpeechRecognitionErrorEvent) => void) | null;
}
interface ISpeechRecognitionWindow {
  SpeechRecognition?: new () => ISpeechRecognition;
  webkitSpeechRecognition?: new () => ISpeechRecognition;
}

function VoiceDraftTextarea({ value, onChange, rows = 8, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const [hasMic, setHasMic] = useState<boolean | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const baseRef = useRef("");
  const sessionRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const w = window as unknown as ISpeechRecognitionWindow;
    setHasMic(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => { recognitionRef.current?.stop(); };
  }, []);

  function start() {
    const w = window as unknown as ISpeechRecognitionWindow;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = false;
    r.lang = "en-US";
    baseRef.current = value;
    sessionRef.current = "";

    r.onresult = (e: ISpeechRecognitionEvent) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) sessionRef.current += e.results[i][0].transcript + " ";
      }
      const base = baseRef.current;
      const t = sessionRef.current.trimEnd();
      onChange((base + (base && t ? " " : "") + t).trimStart());
    };

    r.onend = () => setRecording(false);
    r.onerror = (e: ISpeechRecognitionErrorEvent) => {
      if (e.error === "not-allowed") setMicDenied(true);
      setRecording(false);
    };

    recognitionRef.current = r;
    try { r.start(); setRecording(true); } catch { /* ignore */ }
  }

  function stop() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
  }

  const showMic = hasMic === true && !micDenied;

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: `10px ${showMic ? 40 : 12}px 10px 12px`,
          fontSize: 13,
          fontFamily: "var(--font-roboto)",
          lineHeight: 1.6,
          backgroundColor: "var(--color-canvas)",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          color: "var(--color-body)",
          resize: "vertical",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      {showMic && (
        <button
          onClick={recording ? stop : start}
          aria-label={recording ? "Stop recording" : "Voice input"}
          style={{
            position: "absolute", bottom: 8, right: 8,
            width: 28, height: 28,
            backgroundColor: recording ? "var(--color-error)" : "transparent",
            border: `1px solid ${recording ? "var(--color-error)" : "var(--color-border)"}`,
            borderRadius: 6, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: recording ? "#fff" : "var(--color-secondary)",
          }}
        >
          {recording ? <MicOff size={13} /> : <Mic size={13} />}
        </button>
      )}
      {recording && (
        <p style={{ fontSize: 11, color: "var(--color-error)", marginTop: 4 }}>Recording</p>
      )}
      {micDenied && (
        <p style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 4 }}>
          Microphone access is off in your browser settings.
        </p>
      )}
    </div>
  );
}


// ── Screen: B Pick - recipient selection from Track B ────────────────────────

function BPickScreen({ filter, members, pi, onBack, onClose, onSelect }: {
  filter: "pi" | "all";
  members: Member[];
  pi: Member | undefined;
  onBack: () => void;
  onClose: () => void;
  onSelect: (m: Member) => void;
}) {
  const candidates = filter === "pi"
    ? (pi ? [pi] : members.filter(m => m.role.toLowerCase() === "pi"))
    : members;

  return (
    <PanelShell title="Who can help?" onBack={onBack} onClose={onClose}>
      {candidates.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>
          {filter === "pi" ? "No PI found in this lab." : "No team members found."}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {candidates.map((m) => (
          <MemberRow key={m.id} member={m} onClick={() => onSelect(m)} />
        ))}
      </div>
    </PanelShell>
  );
}

// ── Screen: B,Support resources ─────────────────────────────────────────────
// Track B: no analytics, no logging, no INSERT/UPDATE triggered by viewing this screen.

function BScreen({ resources, institutionKey, loading, pi, members, isCurrentUserPi, projectId, onBack, onClose, onPickRecipient }: {
  resources: SupportResource[];
  institutionKey: string | null;
  loading: boolean;
  pi: Member | undefined;
  members: Member[];
  isCurrentUserPi: boolean;
  projectId: string | null;
  onBack?: () => void;
  onClose: () => void;
  onPickRecipient: (filter: "pi" | "all") => void;
}) {
  const resolved = resolveResources(resources, institutionKey, "US");

  const CATEGORY_LABELS: Record<string, string> = {
    counseling: "Counseling",
    academic: "Academic support",
    workplace: "Workplace",
    health: "Health",
    other: "Other resources",
  };

  const urgentEntries = resolved.filter((r) => r.category === "urgent" || r.is_pinned);
  const nonUrgent = resolved.filter((r) => r.category !== "urgent" && !r.is_pinned);

  const grouped: Record<string, ResolvedResource[]> = {};
  for (const r of nonUrgent) {
    (grouped[r.category] ??= []).push(r);
  }

  if (process.env.NODE_ENV === "development" && !pi && members.length > 0) {
    console.warn("[SupportPanel] No PI found in lab members. Roles present:", members.map(m => m.role));
  }

  return (
    <PanelShell title="Support resources" onBack={onBack} onClose={onClose}>
      <div className="flex items-center gap-2 mb-4" style={{ color: "var(--color-secondary)" }}>
        <Lock size={13} />
        <span style={{ fontSize: 12, lineHeight: 1.5 }}>
          Nothing you open here is recorded or shared with your team.
        </span>
      </div>

      {loading && (
        <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>Loading...</p>
      )}

      {/* Urgent block - always has at least one entry (crisis default) */}
      <section className="mb-5">
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: "var(--color-error)", marginBottom: 8 }}>
          Urgent, always available
        </p>
        <div className="flex flex-col gap-2">
          {urgentEntries.map((r) => <ResourceRow key={r.id} r={r} isUrgent />)}
        </div>
      </section>

      {Object.entries(grouped).map(([cat, rows]) => (
        <section key={cat} className="mb-5">
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", marginBottom: 8 }}>
            {CATEGORY_LABELS[cat] ?? cat}
          </p>
          <div className="flex flex-col gap-2">
            {rows.map((r) => <ResourceRow key={r.id} r={r} />)}
          </div>
        </section>
      ))}

      {!loading && hasNoCounselingResources(resources, institutionKey) && isCurrentUserPi && (
        <p style={{ fontSize: 12, color: "var(--color-secondary)", marginBottom: 16 }}>
          Canopy doesn&rsquo;t have support resources for your institution yet.{" "}
          <a href="/team" style={{ color: "var(--color-navy)", fontWeight: 600 }}>Add them</a>
          {" "}so your team can find them.
        </p>
      )}

      <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16, marginTop: 8 }}>
        <p style={{ fontSize: 13, color: "var(--color-secondary)", marginBottom: 10 }}>
          If you&rsquo;d rather talk to someone on the project
        </p>
        <div className="flex flex-col gap-2">
          {!isCurrentUserPi && (
          <button
            onClick={() => onPickRecipient("pi")}
            style={{
              height: 44, padding: "0 16px",
              backgroundColor: "transparent",
              color: "var(--color-body)",
              border: "1px solid var(--color-border)", borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "var(--font-roboto)", textAlign: "left",
            }}
          >
            Message my PI
          </button>
          )}
          {members.length > 0 && (
            <button
              onClick={() => onPickRecipient("all")}
              style={{
                height: 44, padding: "0 16px",
                backgroundColor: "transparent",
                color: "var(--color-body)",
                border: "1px solid var(--color-border)", borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                fontFamily: "var(--font-roboto)", textAlign: "left",
              }}
            >
              Message a teammate
            </button>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

function ResourceRow({ r, isUrgent }: { r: ResolvedResource | SupportResource; isUrgent?: boolean }) {
  const href = contactHref(r.contact_type, r.contact_value);
  const isLink = r.contact_type === "url";
  const isInPerson = r.contact_type === "in_person";

  const content = (
    <div style={{
      padding: "12px 14px",
      borderRadius: 8,
      // Urgent rows use a canvas background with a red left border so text remains
      // legible in both light and dark mode (red backgrounds fail WCAG AA for secondary text).
      border: isUrgent ? "1px solid var(--color-border)" : "1px solid var(--color-border)",
      borderLeft: isUrgent ? "3px solid var(--color-error)" : "1px solid var(--color-border)",
      backgroundColor: "var(--color-canvas)",
    }}>
      <div className="flex items-start gap-3">
        <span style={{ marginTop: 2, flexShrink: 0 }}>
          <ContactIcon type={r.contact_type} isUrgent={isUrgent} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: isUrgent ? "var(--color-error)" : "var(--color-body)", margin: 0, fontFamily: "var(--font-roboto)" }}>
            {r.label}
          </p>
          {r.description && (
            <p style={{ fontSize: 12, color: "var(--color-body)", margin: "3px 0 0", lineHeight: 1.4 }}>
              {r.description}
            </p>
          )}
          {r.confidentiality && (
            <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "3px 0 0" }}>
              {r.confidentiality}
            </p>
          )}
          {r.availability && (
            <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "3px 0 0" }}>
              {r.availability}
            </p>
          )}
        </div>
      </div>
    </div>
  );

  if (isInPerson || !href) return <div>{content}</div>;

  return (
    <a href={href} target={isLink ? "_blank" : undefined} rel={isLink ? "noopener noreferrer" : undefined}
      style={{ display: "block", textDecoration: "none", minHeight: 44 }}>
      {content}
    </a>
  );
}

// ── Screen: B Message,no pre-fill ───────────────────────────────────────────

function BMessageScreen({ recipient, projectId, userId, onBack, onClose, onSent }: {
  recipient: Member;
  projectId: string | null;
  userId: string;
  onBack: () => void;
  onClose: () => void;
  onSent: (msgId: string) => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    setError("");
    const msgId = crypto.randomUUID();
    const channel = dmChannelKey(userId, recipient.id);
    try {
      if (isSupabaseConfigured && projectId) {
        const { error: err } = await supabase.from("chat_messages").insert({
          id: msgId,
          channel,
          sender_id: userId,
          content: body,
          thread_parent_id: null,
          mentioned_user_ids: [],
          attachments: [],
        });
        if (err) throw err;
      }
      onSent(msgId);
    } catch {
      setError("Something went wrong. One option is to send this via Chat directly.");
      setSending(false);
    }
  }

  return (
    <PanelShell title={`Message ${firstName(recipient.name)}`} onBack={onBack} onClose={onClose}>
      <div className="flex items-center gap-3 mb-4">
        <Avatar user={recipient} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", margin: 0, fontFamily: "var(--font-roboto)" }}>
            {recipient.name}
          </p>
          <button onClick={onBack} style={{ fontSize: 11, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", fontFamily: "var(--font-roboto)" }}>
            Change
          </button>
        </div>
      </div>
      <VoiceDraftTextarea
        value={body}
        onChange={setBody}
        rows={8}
        placeholder="Say as much or as little as you want."
      />
      {error && <p style={{ fontSize: 12, color: "var(--color-error)", marginTop: 8 }}>{error}</p>}
      <button
        onClick={send}
        disabled={sending}
        style={{
          marginTop: 12, width: "100%", height: 44,
          backgroundColor: "var(--color-navy)",
          color: "#fff",
          border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600,
          cursor: sending ? "default" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          fontFamily: "var(--font-roboto)",
          opacity: sending ? 0.7 : 1,
        }}
      >
        <Send size={14} />
        {sending ? "Sending..." : "Send"}
      </button>
      {!body.trim() && !sending && (
        <p style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 6, textAlign: "center" }}>
          Write something above before sending.
        </p>
      )}
    </PanelShell>
  );
}
