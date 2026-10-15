"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CURRENT_USER_ID, TEAM_MEMBERS, formatRelativeTime, getStoredUser, getStoredProject } from "@/lib/mock-data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import type { TeamMember, TaskStatus, LabRole } from "@/types";
import Avatar from "@/components/ui/Avatar";
import { Video, X, Edit3, Check, Users, TrendingUp, ShieldCheck, Plus, Phone, Globe, Lock, ChevronDown, ChevronRight } from "lucide-react";
import {
  getRegistryResources, getInstitutionName, hasNoCounselingResources, INSTITUTION_OPTIONS,
} from "@/lib/support/institutions";
import type { LabResource } from "@/lib/support/institutions";
import ProjectMembersModal from "@/components/projects/ProjectMembersModal";
import PageHeader from "@/components/ui/PageHeader";

// ── Status labels ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do", in_progress: "In Progress", in_review: "In Review", done: "Done",
};
const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: "#64748B", in_progress: "#1B2E4B", in_review: "#A0622A", done: "#2E7D52",
};

// ── PI wellbeing rollup ───────────────────────────────────────────────────────

type RollupRow = { week_start: string; question_id: string; avg_score: number; respondent_count: number };

const ROLLUP_COLORS: Record<string, string> = {
  cq1: "#1B2E4B", cq2: "#D97706", cq3: "#10B981", cq4: "#8B5CF6", cq5: "#EC4899",
};
const ROLLUP_LABELS: Record<string, string> = {
  cq1: "Support", cq2: "Workload", cq3: "Meaningful", cq4: "Boundaries", cq5: "Help",
};

function WellbeingRollupPanel({ rows, overdueCount, totalMembers, minRespondents, loading }: {
  rows: RollupRow[];
  overdueCount: number | null;
  totalMembers: number | null;
  minRespondents: number;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div style={{ padding: "14px 18px", borderRadius: 10, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", marginBottom: 24 }}>
        <div style={{ height: 12, width: "40%", backgroundColor: "var(--color-dimmed-bg)", borderRadius: 6 }} />
      </div>
    );
  }

  const qids = ["cq1", "cq2", "cq3", "cq4", "cq5"];
  const weeks = [...new Set(rows.map(r => r.week_start))].sort();

  return (
    <div style={{ borderRadius: 10, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", marginBottom: 24, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: "1px solid var(--color-border)" }}>
        <TrendingUp size={15} color="var(--color-navy)" />
        <span style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 14, color: "var(--color-navy)" }}>Team Wellbeing (PI view)</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
          <ShieldCheck size={12} color="var(--color-secondary)" />
          <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>min {minRespondents} respondents required</span>
        </div>
      </div>
      <div style={{ padding: "14px 18px" }}>
        {weeks.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
            Not enough data yet. Check-ins from at least {minRespondents} member{minRespondents === 1 ? "" : "s"} are required to show aggregates.
          </p>
        ) : (
          <>
            {(() => {
              const W = 480, H = 130;
              const padL = 24, padR = 12, padT = 10, padB = 28;
              const plotW = W - padL - padR;
              const plotH = H - padT - padB;
              const xStep = weeks.length > 1 ? plotW / (weeks.length - 1) : 0;
              function sx(i: number) { return padL + i * xStep; }
              function sy(s: number) { return padT + plotH - ((s - 1) / 4) * plotH; }
              function buildPath(qid: string): string {
                let d = ""; let penDown = false;
                for (let i = 0; i < weeks.length; i++) {
                  const row = rows.find(r => r.week_start === weeks[i] && r.question_id === qid);
                  if (!row) { penDown = false; continue; }
                  const x = sx(i), y = sy(row.avg_score);
                  d += penDown ? ` L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
                  penDown = true;
                }
                return d;
              }
              return (
                <div style={{ overflowX: "auto", marginBottom: 8 }}>
                  <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", minWidth: 280 }}>
                    {[1,2,3,4,5].map(s => (
                      <line key={s} x1={padL} y1={sy(s)} x2={W-padR} y2={sy(s)}
                        stroke="var(--color-border)" strokeWidth={0.5} />
                    ))}
                    {[1,3,5].map(s => (
                      <text key={s} x={padL-4} y={sy(s)+4} textAnchor="end"
                        style={{ fontSize: 8, fill: "var(--color-secondary)", fontFamily: "var(--font-roboto)" }}>{s}</text>
                    ))}
                    {weeks.map((wk, i) => {
                      const d = new Date(wk);
                      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                      return i % 2 === 0 ? (
                        <text key={wk} x={sx(i)} y={H-4} textAnchor="middle"
                          style={{ fontSize: 8, fill: "var(--color-secondary)", fontFamily: "var(--font-roboto)" }}>{label}</text>
                      ) : null;
                    })}
                    {qids.map(qid => {
                      const color = ROLLUP_COLORS[qid];
                      const path = buildPath(qid);
                      return (
                        <g key={qid}>
                          {path && <path d={path} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />}
                          {weeks.map((wk, i) => {
                            const row = rows.find(r => r.week_start === wk && r.question_id === qid);
                            return row ? <circle key={i} cx={sx(i)} cy={sy(row.avg_score)} r={3} fill={color} /> : null;
                          })}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              );
            })()}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginBottom: 12 }}>
              {qids.map(qid => (
                <div key={qid} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 10, height: 2.5, borderRadius: 2, backgroundColor: ROLLUP_COLORS[qid] }} />
                  <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>{ROLLUP_LABELS[qid]}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {overdueCount !== null && totalMembers !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 10, borderTop: "1px solid var(--color-border)", marginTop: 4 }}>
            <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>
              <strong style={{ color: "var(--color-body)" }}>{overdueCount}</strong> open tasks across {totalMembers} member{totalMembers === 1 ? "" : "s"}
            </span>
          </div>
        )}
        <p style={{ fontSize: 10, color: "var(--color-secondary)", marginTop: 8, marginBottom: 0 }}>
          Aggregated anonymously. Individual responses are never shown.
        </p>
      </div>
    </div>
  );
}

// ── Start Meeting modal ───────────────────────────────────────────────────────

function MeetingModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ backgroundColor: "rgba(27,46,75,0.35)" }} onClick={onClose}>
      <div style={{ backgroundColor: "var(--color-surface)", maxWidth: 360, width: "100%", borderRadius: 10, padding: 28, boxShadow: "0 8px 32px rgba(27,46,75,0.18)" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 17, color: "var(--color-navy)", margin: "0 0 8px" }}>Starting a Zoom meeting…</h2>
        <p style={{ fontSize: 13, color: "var(--color-secondary)", lineHeight: 1.5, marginBottom: 24 }}>
          Your team will receive a Zoom link via Canopy notifications.
        </p>
        <div className="flex gap-2">
          <a
            href="https://zoom.us"
            target="_blank"
            rel="noopener noreferrer"
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#fff", backgroundColor: "var(--color-navy)", border: "none", borderRadius: 7, padding: "10px 0", cursor: "pointer", textDecoration: "none", minHeight: 44, fontFamily: "var(--font-roboto)" }}
          >
            <Video size={15} /> Open Zoom
          </a>
          <button onClick={onClose} style={{ fontSize: 13, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", padding: "0 8px" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Member profile panel ──────────────────────────────────────────────────────

function MemberPanel({
  member, onClose, isPi, labRoles, onRoleChange,
}: {
  member: TeamMember;
  onClose: () => void;
  isPi: boolean;
  labRoles: LabRole[];
  onRoleChange: (memberId: string, roleId: string | null, roleName: string | null) => void;
}) {
  const [isMobile, setIsMobile] = useState(false);
  const [savingRole, setSavingRole] = useState(false);

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 768); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {!isMobile && (
        <div className="fixed inset-0 z-30" style={{ backgroundColor: "rgba(27,46,75,0.15)" }} onClick={onClose} />
      )}
      <div
        className={isMobile ? "animate-slide-in-bottom" : "animate-slide-in"}
        style={isMobile
          ? { position: "fixed", inset: 0, zIndex: 40, display: "flex", flexDirection: "column", backgroundColor: "var(--color-surface)" }
          : { position: "fixed", top: 0, right: 0, height: "100%", zIndex: 40, display: "flex", flexDirection: "column", width: 340, backgroundColor: "var(--color-surface)", borderLeft: "1px solid var(--color-border)", boxShadow: "-4px 0 20px rgba(27,46,75,0.1)" }
        }
      >
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Avatar user={member} size={48} />
              <div>
                <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 17, color: "var(--color-body)", margin: 0 }}>{member.name}</h2>
                {isPi && labRoles.length > 0 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                    <div style={{ position: "relative" }}>
                      <select
                        defaultValue={labRoles.find((r) => r.name === member.labRoleName)?.id ?? ""}
                        disabled={savingRole}
                        onChange={async (e) => {
                          const roleId = e.target.value || null;
                          const roleName = labRoles.find((r) => r.id === roleId)?.name ?? null;
                          setSavingRole(true);
                          await supabase.from("team_members").update({ lab_role_id: roleId }).eq("user_id", member.id);
                          setSavingRole(false);
                          onRoleChange(member.id, roleId, roleName);
                        }}
                        style={{ height: 30, fontSize: 12, color: "var(--color-body)", backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", borderRadius: 6, outline: "none", cursor: savingRole ? "default" : "pointer", fontFamily: "var(--font-roboto)", appearance: "none", padding: "0 24px 0 8px" }}
                        aria-label={`Role for ${member.name}`}
                      >
                        {labRoles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <ChevronDown size={11} color="var(--color-secondary)" style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                    </div>
                    {savingRole && <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>Saving…</span>}
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: "var(--color-secondary)", marginTop: 3, textTransform: "capitalize" }}>
                    {member.labRoleName ?? (member.role === "pi" ? "Principal Investigator" : "Researcher")}
                  </p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="flex items-center justify-center rounded-lg hover:bg-[rgba(27,46,75,0.06)]" style={{ width: 44, height: 44 }} aria-label="Close">
              <X size={18} color="var(--color-secondary)" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 10 }}>Tasks</p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(member.taskCounts) as [TaskStatus, number][]).map(([status, count]) => (
                <div key={status} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[status] }} />
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "var(--color-body)", lineHeight: 1 }}>{count}</p>
                    <p style={{ fontSize: 10, color: "var(--color-secondary)", marginTop: 1 }}>{STATUS_LABELS[status]}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {member.weeklyUpdate && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 8 }}>This Week</p>
              <div className="px-3 py-3 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
                <p style={{ fontSize: 13, color: "var(--color-body)", lineHeight: 1.5 }}>{member.weeklyUpdate}</p>
                {member.weeklyUpdatedAt && (
                  <p style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 5 }}>Updated {formatRelativeTime(member.weeklyUpdatedAt)}</p>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

// ── Member card ───────────────────────────────────────────────────────────────

function MemberCard({ member, onClick, isCurrentUser }: { member: TeamMember; onClick: () => void; isCurrentUser: boolean }) {
  const totalTasks = Object.values(member.taskCounts).reduce((a, b) => a + b, 0);

  return (
    <button onClick={onClick} className="text-left w-full"
      style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "20px 20px 16px", cursor: "pointer", transition: "box-shadow 0.15s, border-color 0.15s" }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = "var(--shadow-card)";
        el.style.borderColor = "var(--color-navy)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = "";
        el.style.borderColor = "var(--color-border)";
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <Avatar user={member} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", lineHeight: 1.2 }}>
            {member.name}
            {isCurrentUser && <span style={{ fontSize: 11, fontWeight: 400, color: "var(--color-secondary)", marginLeft: 6 }}>(you)</span>}
          </p>
          <p style={{ fontSize: 12, color: "var(--color-secondary)", marginTop: 2 }}>
            {member.labRoleName ?? (member.role === "pi" ? "PI" : "Researcher")}
          </p>
        </div>
        <ChevronRight size={14} color="var(--color-secondary)" style={{ flexShrink: 0, opacity: 0.5 }} />
      </div>
      <div className="grid grid-cols-2 gap-1.5 mb-4">
        {(Object.entries(member.taskCounts) as [TaskStatus, number][]).map(([status, count]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
            <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>
              {STATUS_LABELS[status]}: <span style={{ fontWeight: 600, color: "var(--color-body)" }}>{count}</span>
            </span>
          </div>
        ))}
      </div>
      {member.weeklyUpdate && (
        <div className="px-3 py-2 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
          <p style={{ fontSize: 12, color: "var(--color-secondary)", marginBottom: 3 }}>This week</p>
          <p style={{ fontSize: 12, color: "var(--color-body)", lineHeight: 1.45 }}>
            {member.weeklyUpdate.length > 72 ? member.weeklyUpdate.slice(0, 72) + "…" : member.weeklyUpdate}
          </p>
        </div>
      )}
    </button>
  );
}

// ── Weekly update bar ─────────────────────────────────────────────────────────

function WeeklyUpdateBar({ current, onSave }: { current?: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(current ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <div className="flex items-center gap-3 px-5 py-3 mb-6 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", borderRadius: 8 }}>
        <p style={{ fontSize: 13, color: current ? "var(--color-body)" : "var(--color-secondary)", flex: 1 }}>
          {current ? `This week: ${current}` : "What are you working on this week? (optional, visible to your team)"}
        </p>
        <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-[rgba(27,46,75,0.06)]"
          style={{ fontSize: 12, color: "var(--color-navy)", fontWeight: 600, border: "1px solid var(--color-border)", borderRadius: 7, cursor: "pointer", minHeight: 36 }}>
          <Edit3 size={12} />{current ? "Edit" : "Add Update"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 mb-6 rounded-lg" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", borderRadius: 7, height: 36 }}>
      <input
        ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)}
        placeholder="What are you working on this week?"
        style={{ flex: 1, fontSize: 13, color: "var(--color-body)", fontFamily: "var(--font-roboto)", backgroundColor: "transparent", border: "none", outline: "none" }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onSave(value); setEditing(false); }
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button onClick={() => { onSave(value); setEditing(false); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
        style={{ fontSize: 12, fontWeight: 700, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", minHeight: 36 }}>
        <Check size={12} /> Save
      </button>
    </div>
  );
}

// ── Support resources admin (PI only) ────────────────────────────────────────

const CATEGORY_OPTIONS = ["urgent", "counseling", "academic", "workplace", "health", "other"] as const;
const CONTACT_TYPE_OPTIONS = ["phone", "url", "email", "in_person"] as const;

function SupportResourcesAdmin({
  projectId, piRows, institutionKey, savingInstitution,
  showAddResource, newResource, savingResource, resourceError,
  onSetInstitution, onOverride, onSetNewResource, onToggleAddResource, onSaveResource, onDeleteResource,
}: {
  projectId: string;
  piRows: LabResource[];
  institutionKey: string | null;
  savingInstitution: boolean;
  showAddResource: boolean;
  newResource: Partial<LabResource>;
  savingResource: boolean;
  resourceError: string;
  onSetInstitution: (key: string) => void;
  onOverride: (category: string) => void;
  onSetNewResource: (r: Partial<LabResource>) => void;
  onToggleAddResource: () => void;
  onSaveResource: () => void;
  onDeleteResource: (id: string) => void;
}) {
  const registryRows = getRegistryResources(institutionKey);
  const institutionName = getInstitutionName(institutionKey);
  const showNoCounselingBanner = hasNoCounselingResources(piRows, institutionKey);

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", fontSize: 12, borderRadius: 6,
    border: "1px solid var(--color-border)", background: "var(--color-canvas)",
    color: "var(--color-body)", fontFamily: "var(--font-roboto)", outline: "none",
  };

  return (
    <div style={{ marginBottom: 32, padding: 20, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12 }}>
      <div className="flex items-center justify-between mb-4">
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-navy)", fontFamily: "var(--font-lora)", margin: 0 }}>
          Support resources
        </h2>
        <button
          onClick={onToggleAddResource}
          style={{ fontSize: 12, fontWeight: 600, color: "var(--color-navy)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "5px 12px", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
        >
          <Plus size={12} /> Add Resource
        </button>
      </div>

      {/* Institution picker */}
      <div className="flex items-center gap-3 mb-4">
        <span style={{ fontSize: 12, color: "var(--color-secondary)", whiteSpace: "nowrap" }}>Institution:</span>
        <select
          value={institutionKey ?? ""}
          onChange={e => onSetInstitution(e.target.value)}
          disabled={savingInstitution}
          style={{ ...inputStyle, width: "auto", minWidth: 200 }}
        >
          <option value="">Not set</option>
          {INSTITUTION_OPTIONS.map(o => (
            <option key={o.key} value={o.key}>{o.name}</option>
          ))}
        </select>
        {institutionName && (
          <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>
            Registry entries from {institutionName} are shown below.
          </span>
        )}
      </div>

      {showNoCounselingBanner && (
        <p style={{ fontSize: 12, color: "var(--color-secondary)", padding: "8px 12px", backgroundColor: "var(--color-dimmed-bg)", borderRadius: 7, marginBottom: 12 }}>
          Canopy doesn&rsquo;t have support resources for your institution yet. Add them so your team can find them.
        </p>
      )}

      {/* Registry rows - read-only */}
      {registryRows.length > 0 && (
        <div className="mb-4">
          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            From your institution
          </p>
          <div className="flex flex-col gap-2">
            {registryRows.map(r => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)" }}>
                {r.contact_type === "phone" ? <Phone size={13} color="var(--color-secondary)" /> : <Globe size={13} color="var(--color-secondary)" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>{r.label}</p>
                  {r.description && <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>{r.description}</p>}
                  <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>{r.contact_value}{r.availability ? ` · ${r.availability}` : ""}</p>
                </div>
                <span style={{ fontSize: 10, color: "var(--color-secondary)", whiteSpace: "nowrap", padding: "2px 7px", border: "1px solid var(--color-border)", borderRadius: 4 }}>
                  {r.category}
                </span>
                <button
                  onClick={() => onOverride(r.category)}
                  style={{ fontSize: 11, fontWeight: 600, color: "var(--color-navy)", background: "none", border: "1px solid var(--color-border)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  Override
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PI-configured rows */}
      {piRows.length > 0 && (
        <div className="mb-4">
          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Your lab&rsquo;s resources
          </p>
          <div className="flex flex-col gap-2">
            {piRows.map(r => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)" }}>
                {r.contact_type === "phone" ? <Phone size={13} color="var(--color-secondary)" /> : <Globe size={13} color="var(--color-secondary)" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>{r.label}</p>
                  {r.description && <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>{r.description}</p>}
                  <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>{r.contact_value}{r.availability ? ` · ${r.availability}` : ""}</p>
                </div>
                <span style={{ fontSize: 10, color: "var(--color-secondary)", whiteSpace: "nowrap", padding: "2px 7px", border: "1px solid var(--color-border)", borderRadius: 4 }}>
                  {r.category}
                </span>
                <button
                  onClick={() => onDeleteResource(r.id)}
                  style={{ fontSize: 11, color: "var(--color-error, #dc2626)", background: "none", border: "none", cursor: "pointer", padding: "4px 6px" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add resource form */}
      {showAddResource && (
        <div style={{ padding: 14, borderRadius: 10, border: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)" }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "var(--color-body)", marginBottom: 10 }}>New resource</p>
          <div className="flex flex-col gap-2">
            <input placeholder="Label *" value={newResource.label ?? ""} onChange={e => onSetNewResource({ ...newResource, label: e.target.value })} style={inputStyle} />
            <input placeholder="Description" value={newResource.description ?? ""} onChange={e => onSetNewResource({ ...newResource, description: e.target.value })} style={inputStyle} />
            <input placeholder="Contact value (phone number or URL) *" value={newResource.contact_value ?? ""} onChange={e => onSetNewResource({ ...newResource, contact_value: e.target.value })} style={inputStyle} />
            <input placeholder="Availability (e.g. Mon–Fri 9am–5pm)" value={newResource.availability ?? ""} onChange={e => onSetNewResource({ ...newResource, availability: e.target.value })} style={inputStyle} />
            <input placeholder="Confidentiality note" value={newResource.confidentiality ?? ""} onChange={e => onSetNewResource({ ...newResource, confidentiality: e.target.value })} style={inputStyle} />
            <div className="flex gap-2">
              <select value={newResource.category ?? ""} onChange={e => onSetNewResource({ ...newResource, category: e.target.value })} style={{ ...inputStyle, flex: 1 }}>
                <option value="">Category *</option>
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={newResource.contact_type ?? "phone"} onChange={e => onSetNewResource({ ...newResource, contact_type: e.target.value as LabResource["contact_type"] })} style={{ ...inputStyle, flex: 1 }}>
                {CONTACT_TYPE_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {resourceError && (
              <p style={{ fontSize: 12, color: "var(--color-error)", marginTop: 4, marginBottom: 2 }}>{resourceError}</p>
            )}
            <div className="flex gap-2 mt-1">
              <button
                onClick={onSaveResource}
                disabled={savingResource}
                style={{ flex: 1, height: 36, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: savingResource ? "default" : "pointer" }}
              >
                {savingResource ? "Saving…" : "Save"}
              </button>
              <button onClick={onToggleAddResource} style={{ flex: 1, height: 36, border: "1px solid var(--color-border)", borderRadius: 7, fontSize: 13, background: "transparent", cursor: "pointer", color: "var(--color-secondary)" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Team page ─────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { activeScope, subProjectId, subProjects, projectId } = useProject();
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [weeklyUpdate, setWeeklyUpdate] = useState<string | undefined>(undefined);
  const [isPi, setIsPi] = useState(false);
  const [storedProjectName, setStoredProjectName] = useState("");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    isSupabaseConfigured ? null : CURRENT_USER_ID
  );
  const [subProjectMemberIds, setSubProjectMemberIds] = useState<Set<string> | null>(null);
  const [projectTeam, setProjectTeam] = useState<TeamMember[]>([]);
  const [projectScopedCounts, setProjectScopedCounts] = useState<Record<string, Record<TaskStatus, number>>>({});
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [rollupRows, setRollupRows] = useState<RollupRow[]>([]);
  const [rollupLoading, setRollupLoading] = useState(false);
  const [overdueCount, setOverdueCount] = useState<number | null>(null);
  const [overdueTotalMembers, setOverdueTotalMembers] = useState<number | null>(null);
  const [minRespondents, setMinRespondents] = useState(2);
  const [adminResources, setAdminResources] = useState<LabResource[]>([]);
  const [institutionKey, setInstitutionKey] = useState<string | null>(null);
  const [savingInstitution, setSavingInstitution] = useState(false);
  const [showAddResource, setShowAddResource] = useState(false);
  const [newResource, setNewResource] = useState<Partial<LabResource>>({ contact_type: "phone" });
  const [savingResource, setSavingResource] = useState(false);
  const [resourceError, setResourceError] = useState("");
  const [labRoles, setLabRoles] = useState<LabRole[]>([]);
  const closeMemberPanel = useCallback(() => setSelectedMember(null), []);
  const closeMeetingModal = useCallback(() => setMeetingModalOpen(false), []);

  // Initialize UI state and resolve userId from auth session.
  useEffect(() => {
    const sp = getStoredProject();
    setStoredProjectName(sp.name);

    if (!isSupabaseConfigured) {
      const su = getStoredUser();
      setIsPi(su.role === "pi");
      setTeam(TEAM_MEMBERS);
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { setLoading(false); return; }
      setCurrentUserId(session.user.id);
      // Fetch real role -- never trust mock data for the PI gate
      const { data: prof } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();
      setIsPi((prof?.role as string | null) === "pi");
    });
  }, []);

  // Query team_members once we have both userId and projectId (from context).
  useEffect(() => {
    if (!currentUserId || !projectId) return;

    (async () => {
      // 1. Team roster for this project + the project's display name + lab roles
      const [{ data: memberData }, { data: projectData }, { data: labRolesData }] = await Promise.all([
        supabase
          .from("team_members")
          .select("*, user_profiles(name, avatar_color, avatar_initials, avatar_url, institution), lab_role_id")
          .eq("project_id", projectId),
        supabase
          .from("projects")
          .select("name, min_wellbeing_respondents")
          .eq("id", projectId)
          .maybeSingle(),
        supabase
          .from("lab_roles")
          .select("id, name, permission_level, is_system, created_at")
          .eq("project_id", projectId)
          .order("is_system", { ascending: false })
          .order("name"),
      ]);

      const labRoleMap: Record<string, string> = {};
      for (const r of labRolesData ?? []) {
        labRoleMap[(r as { id: string; name: string }).id] = (r as { id: string; name: string }).name;
      }
      if (labRolesData) {
        setLabRoles(labRolesData.map((r) => ({
          id: (r as { id: string }).id,
          projectId,
          name: (r as { name: string }).name,
          permissionLevel: (r as { permission_level: string }).permission_level as "pi" | "researcher",
          isSystem: (r as { is_system: boolean }).is_system,
          createdAt: (r as { created_at: string }).created_at,
        })));
      }

      // Override the localStorage-cached name with the real value from the DB.
      if (projectData?.name) setStoredProjectName(projectData.name as string);
      if (projectData?.min_wellbeing_respondents != null) setMinRespondents(projectData.min_wellbeing_respondents as number);

      // 2. Task counts - single embedded-join query so PostgREST handles the
      //    task_id → tasks.id match server-side; no client-side Map key lookup needed.
      const memberIds = (memberData ?? []).map((r) => r.user_id as string);
      const countMap: Record<string, Record<TaskStatus, number>> = {};

      if (memberIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: assigneeWithTasks, error: joinError } = await (supabase
          .from("task_assignees")
          .select("user_id, task_id, tasks(id, status, archived)")
          .in("user_id", memberIds) as any);

        if (joinError) console.error("[Team] assignee+task join error:", joinError);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const row of (assigneeWithTasks ?? []) as any[]) {
          const taskArr = row.tasks;
          const task = Array.isArray(taskArr) ? taskArr[0] : taskArr;
          if (!task) continue;           // task deleted or RLS-hidden
          if (task.archived) continue;   // skip archived tasks
          const status = task.status as TaskStatus;
          const uid = row.user_id as string;
          if (!countMap[uid]) countMap[uid] = { todo: 0, in_progress: 0, in_review: 0, done: 0 };
          if (status in countMap[uid]) countMap[uid][status]++;
        }

      }

        const members: TeamMember[] = (memberData ?? []).map((row) => {
          const profiles = row.user_profiles as unknown as Record<string, string>[] | Record<string, string> | null;
          const profile = Array.isArray(profiles) ? profiles[0] : (profiles as Record<string, string> | null);
          const uid = row.user_id as string;
          return {
            id: uid,
            name: profile?.name ?? "Unknown",
            email: "",
            role: row.role as TeamMember["role"],
            avatarColor: profile?.avatar_color ?? "#B4D4E3",
            avatarInitials: profile?.avatar_initials ?? "??",
            avatarUrl: profile?.avatar_url ?? undefined,
            institution: profile?.institution,
            taskCounts: countMap[uid] ?? { todo: 0, in_progress: 0, in_review: 0, done: 0 },
            weeklyUpdate: undefined,
            weeklyUpdatedAt: undefined,
            labRoleName: row.lab_role_id ? labRoleMap[row.lab_role_id as string] : undefined,
          };
        });

        // Ensure the current user always appears, even if not yet in team_members.
        if (currentUserId && !members.some((m) => m.id === currentUserId)) {
          const { data: myProfile } = await supabase
            .from("user_profiles")
            .select("name, avatar_color, avatar_initials, avatar_url, institution, role")
            .eq("id", currentUserId)
            .maybeSingle();
          if (myProfile) {
            members.unshift({
              id: currentUserId,
              name: myProfile.name ?? "Unknown",
              email: "",
              role: (myProfile.role as TeamMember["role"]) ?? "researcher",
              avatarColor: myProfile.avatar_color ?? "#B4D4E3",
              avatarInitials: myProfile.avatar_initials ?? "??",
              avatarUrl: myProfile.avatar_url ?? undefined,
              institution: myProfile.institution,
              taskCounts: countMap[currentUserId] ?? { todo: 0, in_progress: 0, in_review: 0, done: 0 },
              weeklyUpdate: undefined,
              weeklyUpdatedAt: undefined,
            });
          }
        }

        setTeam(members);
        setLoading(false);
    })();
  }, [currentUserId, projectId]);

  // Load support resources and institution_key for PI admin panel.
  useEffect(() => {
    if (!isPi || !projectId || !isSupabaseConfigured) return;
    (async () => {
      const [resQ, projQ] = await Promise.all([
        supabase
          .from("support_resources")
          .select("id, label, description, confidentiality, category, contact_type, contact_value, availability, is_pinned, sort_order, active")
          .eq("project_id", projectId)
          .order("sort_order"),
        supabase
          .from("projects")
          .select("institution_key")
          .eq("id", projectId)
          .maybeSingle(),
      ]);
      setAdminResources((resQ.data ?? []) as LabResource[]);
      if (projQ.data?.institution_key) setInstitutionKey(projQ.data.institution_key as string);
    })();
  }, [isPi, projectId]);

  // In project scope, fetch the full sub-project member list (includes external members
  // who may not be in team_members) directly from sub_project_members + user_profiles.
  // Also fetch task counts scoped to this sub-project so member cards show accurate counts.
  useEffect(() => {
    if (activeScope !== "project" || !subProjectId || !isSupabaseConfigured) {
      setSubProjectMemberIds(null);
      setProjectTeam([]);
      setProjectScopedCounts({});
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("sub_project_members")
        .select("user_id, user_profiles(name, avatar_color, avatar_initials, avatar_url, role, institution)")
        .eq("sub_project_id", subProjectId);

      if (!data) return;
      setSubProjectMemberIds(new Set(data.map((r) => r.user_id as string)));
      setProjectTeam(data.map((row) => {
        const p = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
        const prof = p as Record<string, string> | null;
        const name = prof?.name ?? "Unknown";
        return {
          id:              row.user_id as string,
          name,
          email:           "",
          role:            (prof?.role as "pi" | "researcher") ?? "researcher",
          avatarColor:     prof?.avatar_color ?? "#B4D4E3",
          avatarInitials:  prof?.avatar_initials ?? name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase(),
          avatarUrl:       prof?.avatar_url ?? undefined,
          institution:     prof?.institution ?? undefined,
          taskCounts:      { todo: 0, in_progress: 0, in_review: 0, done: 0 },
        } satisfies TeamMember;
      }));

      // Fetch task counts scoped to this sub-project only
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: scopedTasks } = await (supabase
        .from("tasks")
        .select("id, status, archived, task_assignees(user_id)")
        .eq("sub_project_id", subProjectId)
        .eq("archived", false) as any);

      const newCounts: Record<string, Record<TaskStatus, number>> = {};
      for (const task of (scopedTasks ?? []) as { status: string; task_assignees: { user_id: string }[] }[]) {
        const status = task.status as TaskStatus;
        for (const row of (task.task_assignees ?? [])) {
          if (!newCounts[row.user_id]) newCounts[row.user_id] = { todo: 0, in_progress: 0, in_review: 0, done: 0 };
          if (status in newCounts[row.user_id]) newCounts[row.user_id][status]++;
        }
      }
      setProjectScopedCounts(newCounts);
    })();
  }, [activeScope, subProjectId]);

  // F2: PI wellbeing rollup -- fetched only when the user is a PI and we have a projectId
  useEffect(() => {
    if (!isPi || !projectId || !isSupabaseConfigured) return;
    setRollupLoading(true);
    Promise.all([
      supabase.rpc("get_wellbeing_rollup", { p_project_id: projectId }),
      supabase.rpc("get_overdue_signal", { p_project_id: projectId }),
    ]).then(([{ data: rData }, { data: oData }]) => {
      setRollupRows((rData as RollupRow[] | null) ?? []);
      if (oData && Array.isArray(oData) && oData.length > 0) {
        setOverdueCount((oData[0] as { overdue_count: number }).overdue_count);
        setOverdueTotalMembers((oData[0] as { total_members: number }).total_members);
      }
      setRollupLoading(false);
    });
  }, [isPi, projectId]);

  // In project scope use the directly-fetched list with project-scoped task counts.
  const visibleTeam = activeScope === "project"
    ? projectTeam.map((m) => ({
        ...m,
        taskCounts: projectScopedCounts[m.id] ?? { todo: 0, in_progress: 0, in_review: 0, done: 0 },
      }))
    : team;

  const teamBadgeName = activeScope === "project"
    ? (subProjects.find((sp) => sp.id === subProjectId)?.name ?? storedProjectName ?? null)
    : null;
  const teamSubtitle = activeScope === "project"
    ? (teamBadgeName ? `Showing members of ${teamBadgeName}.` : `${visibleTeam.length} member${visibleTeam.length !== 1 ? "s" : ""}`)
    : `${visibleTeam.length} member${visibleTeam.length !== 1 ? "s" : ""} · ${storedProjectName}`;
  const canManageProject = activeScope === "project" && subProjectId && projectId
    && (isPi || (subProjects.find((sp) => sp.id === subProjectId)?.createdBy === currentUserId));

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "var(--font-roboto)" }}>

      <PageHeader
        title="Team"
        badge={teamBadgeName ? (
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", backgroundColor: "var(--color-navy-dim)", color: "var(--color-navy)", padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
            {teamBadgeName}
          </span>
        ) : undefined}
        subtitle={teamSubtitle}
        action={
          <div className="flex items-center gap-2">
            {canManageProject && (
              <button
                onClick={() => setShowMembersModal(true)}
                className="flex items-center gap-2 transition-opacity hover:opacity-80"
                style={{ border: "1px solid var(--color-border)", borderRadius: 7, backgroundColor: "var(--color-surface)", color: "var(--color-navy)", fontSize: 12, fontWeight: 600, cursor: "pointer", height: 36, padding: "0 12px" }}
              >
                <Users size={13} /> Manage Members
              </button>
            )}
            <button
              onClick={() => setMeetingModalOpen(true)}
              className="flex items-center gap-2 transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--color-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 7, cursor: "pointer", height: 36, padding: "0 14px" }}
            >
              <Video size={14} /> Start Meeting
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6">

        <WeeklyUpdateBar current={weeklyUpdate} onSave={setWeeklyUpdate} />

        {/* PI wellbeing rollup -- only shown to PI */}
        {isPi && (
          <WellbeingRollupPanel
            rows={rollupRows}
            overdueCount={overdueCount}
            totalMembers={overdueTotalMembers}
            minRespondents={minRespondents}
            loading={rollupLoading}
          />
        )}

        {/* PI support resources admin -- only shown to PI */}
        {isPi && projectId && (
          <SupportResourcesAdmin
            projectId={projectId}
            piRows={adminResources}
            institutionKey={institutionKey}
            savingInstitution={savingInstitution}
            showAddResource={showAddResource}
            newResource={newResource}
            savingResource={savingResource}
            resourceError={resourceError}
            onSetInstitution={async (key) => {
              if (!isSupabaseConfigured) { setInstitutionKey(key); return; }
              setSavingInstitution(true);
              await supabase.from("projects").update({ institution_key: key || null }).eq("id", projectId);
              setInstitutionKey(key || null);
              setSavingInstitution(false);
            }}
            onOverride={(cat) => {
              setNewResource({ category: cat, contact_type: "phone", active: true, sort_order: 0, is_pinned: false });
              setShowAddResource(true);
            }}
            onSetNewResource={setNewResource}
            onToggleAddResource={() => { setShowAddResource(v => !v); setNewResource({ contact_type: "phone" }); setResourceError(""); }}
            onSaveResource={async () => {
              if (!newResource.label || !newResource.contact_value || !newResource.category) {
                setResourceError("Label, Contact value, and Category are required.");
                return;
              }
              setSavingResource(true);
              const row: LabResource = {
                id: crypto.randomUUID(),
                label: newResource.label,
                description: newResource.description ?? null,
                confidentiality: newResource.confidentiality ?? null,
                category: newResource.category,
                contact_type: newResource.contact_type as LabResource["contact_type"],
                contact_value: newResource.contact_value,
                availability: newResource.availability ?? null,
                is_pinned: newResource.is_pinned ?? false,
                sort_order: newResource.sort_order ?? 0,
                active: true,
              };
              if (isSupabaseConfigured) {
                const { error: insErr } = await supabase.from("support_resources").insert({ ...row, project_id: projectId });
                if (insErr) {
                  setResourceError("Failed to save: " + insErr.message);
                  setSavingResource(false);
                  return;
                }
              }
              setAdminResources(prev => [...prev, row]);
              setResourceError("");
              setShowAddResource(false);
              setNewResource({ contact_type: "phone" });
              setSavingResource(false);
            }}
            onDeleteResource={async (id) => {
              setAdminResources(prev => prev.filter(r => r.id !== id));
              if (isSupabaseConfigured) await supabase.from("support_resources").delete().eq("id", id);
            }}
          />
        )}

        {/* Team grid */}
        {loading && (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" }}>
            {[1,2,3].map((i) => (
              <div key={i} style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 20, display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", backgroundColor: "var(--color-dimmed-bg)", flexShrink: 0 }} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ height: 14, borderRadius: 6, backgroundColor: "var(--color-dimmed-bg)", width: "60%" }} />
                  <div style={{ height: 11, borderRadius: 6, backgroundColor: "var(--color-dimmed-bg)", width: "40%" }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && visibleTeam.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", marginBottom: 16 }}>
            {activeScope === "project" ? "No members in this project yet." : "Your team will appear here once collaborators join."}
          </p>
        )}
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" }}>
          {visibleTeam.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              onClick={() => setSelectedMember(member)}
              isCurrentUser={member.id === currentUserId}
            />
          ))}
        </div>

      </div>

      {selectedMember && (
        <MemberPanel
          member={selectedMember}
          onClose={closeMemberPanel}
          isPi={isPi}
          labRoles={labRoles}
          onRoleChange={(memberId, _roleId, roleName) => {
            setTeam((prev) => prev.map((m) => m.id === memberId ? { ...m, labRoleName: roleName ?? undefined } : m));
            setSelectedMember((prev) => prev && prev.id === memberId ? { ...prev, labRoleName: roleName ?? undefined } : prev);
          }}
        />
      )}
      {meetingModalOpen && <MeetingModal onClose={closeMeetingModal} />}
      {showMembersModal && activeScope === "project" && subProjectId && projectId && (() => {
        const activeSp = subProjects.find((sp) => sp.id === subProjectId);
        const canManage = isPi || (activeSp?.createdBy != null && activeSp.createdBy === currentUserId);
        return (
          <ProjectMembersModal
            subProjectId={subProjectId}
            subProjectName={activeSp?.name ?? "Project"}
            labProjectId={projectId}
            currentUserId={currentUserId ?? ""}
            canManage={canManage}
            onClose={() => setShowMembersModal(false)}
          />
        );
      })()}
    </div>
  );
}
