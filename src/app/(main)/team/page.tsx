"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CURRENT_USER_ID, formatRelativeTime, getStoredProject } from "@/lib/mock-data";
import { TASK_STATUS_COLORS, TASK_STATUS_LABELS, emptyTaskCounts } from "@/lib/tasks";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import type { TeamMember, TaskStatus, LabRole, Department } from "@/types";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, toUserRole } from "@/lib/permissions";
import { groupDirectory } from "@/lib/team";
import Avatar from "@/components/ui/Avatar";
import { Video, X, Edit3, Check, Users, Plus, Phone, Globe, ChevronDown, ChevronRight } from "lucide-react";
import {
  getRegistryResources, getInstitutionName, hasNoCounselingResources, INSTITUTION_OPTIONS,
} from "@/lib/support/institutions";
import type { LabResource } from "@/lib/support/institutions";
import ProjectMembersModal from "@/components/projects/ProjectMembersModal";
import PageHeader from "@/components/ui/PageHeader";

// ── Status labels ─────────────────────────────────────────────────────────────

const STATUS_LABELS = TASK_STATUS_LABELS;
const STATUS_COLORS = TASK_STATUS_COLORS;

// ── Start Meeting modal ───────────────────────────────────────────────────────

function MeetingModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ backgroundColor: "rgba(2,99,196,0.35)" }} onClick={onClose}>
      <div style={{ backgroundColor: "var(--color-surface)", maxWidth: 360, width: "100%", borderRadius: 10, padding: 28, boxShadow: "0 8px 32px rgba(2,99,196,0.18)" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 17, color: "var(--color-navy)", margin: "0 0 8px" }}>Starting a Zoom meeting…</h2>
        <p style={{ fontSize: 13, color: "var(--color-secondary)", lineHeight: 1.5, marginBottom: 24 }}>
          Share the meeting link with your team in Chat once it opens.
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
  member, onClose, isPresident, projectId, labRoles, departments, onMemberChange,
}: {
  member: TeamMember;
  onClose: () => void;
  isPresident: boolean;
  projectId: string | null;
  labRoles: LabRole[];
  departments: Department[];
  onMemberChange: (memberId: string, patch: Partial<TeamMember>) => void;
}) {
  const [isMobile, setIsMobile] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const department = departments.find((d) => d.id === member.departmentId) ?? null;

  async function saveMembership(patch: Record<string, unknown>, local: Partial<TeamMember>) {
    if (!projectId) return;
    setSavingRole(true);
    setSaveError(null);
    try {
      const { error } = await supabase.from("team_members").update(patch)
        .eq("user_id", member.id).eq("project_id", projectId);
      if (error) throw new Error(error.message);
      onMemberChange(member.id, local);
    } catch (e) {
      setSaveError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingRole(false);
    }
  }

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
        <div className="fixed inset-0 z-30" style={{ backgroundColor: "rgba(2,99,196,0.15)" }} onClick={onClose} />
      )}
      <div
        className={isMobile ? "animate-slide-in-bottom" : "animate-slide-in"}
        style={isMobile
          ? { position: "fixed", inset: 0, zIndex: 40, display: "flex", flexDirection: "column", backgroundColor: "var(--color-surface)" }
          : { position: "fixed", top: 0, right: 0, height: "100%", zIndex: 40, display: "flex", flexDirection: "column", width: 340, backgroundColor: "var(--color-surface)", borderLeft: "1px solid var(--color-border)", boxShadow: "-4px 0 20px rgba(2,99,196,0.1)" }
        }
      >
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Avatar user={member} size={48} />
              <div>
                <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 17, color: "var(--color-body)", margin: 0 }}>{member.name}</h2>
                {isPresident && labRoles.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 }}>
                    <div style={{ position: "relative" }}>
                      <select
                        value={labRoles.find((r) => r.name === member.labRoleName)?.id ?? ""}
                        disabled={savingRole}
                        onChange={(e) => {
                          const roleId = e.target.value || null;
                          const role = labRoles.find((r) => r.id === roleId);
                          saveMembership({ lab_role_id: roleId }, {
                            labRoleName: role?.name, role: role?.permissionLevel ?? member.role,
                          });
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
                    <div style={{ position: "relative" }}>
                      <select
                        value={member.departmentId ?? ""}
                        disabled={savingRole}
                        onChange={(e) => {
                          const departmentId = e.target.value || null;
                          saveMembership({ department_id: departmentId }, { departmentId });
                        }}
                        style={{ height: 30, fontSize: 12, color: "var(--color-body)", backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", borderRadius: 6, outline: "none", cursor: savingRole ? "default" : "pointer", fontFamily: "var(--font-roboto)", appearance: "none", padding: "0 24px 0 8px", maxWidth: 200 }}
                        aria-label={`Department for ${member.name}`}
                      >
                        <option value="">No department</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <ChevronDown size={11} color="var(--color-secondary)" style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                    </div>
                    {savingRole && <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>Saving…</span>}
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: "var(--color-secondary)", marginTop: 3 }}>
                    {member.labRoleName ?? ROLE_DESCRIPTIONS[member.role]}
                    {department && <> · {department.name}</>}
                  </p>
                )}
                {saveError && <p role="alert" style={{ fontSize: 11, color: "var(--color-error)", margin: "6px 0 0" }}>{saveError}</p>}
              </div>
            </div>
            <button onClick={onClose} className="flex items-center justify-center rounded-lg hover:bg-[rgba(2,99,196,0.06)]" style={{ width: 44, height: 44 }} aria-label="Close">
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

function MemberCard({ member, onClick, isCurrentUser, department }: { member: TeamMember; onClick: () => void; isCurrentUser: boolean; department?: Department | null }) {

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
          <p style={{ fontSize: 12, color: "var(--color-secondary)", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span>{member.labRoleName ?? ROLE_LABELS[member.role]}</span>
            {department && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: department.color }} />
                {department.name}
              </span>
            )}
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
        <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-[rgba(2,99,196,0.06)]"
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
  piRows, institutionKey, savingInstitution,
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
          There are no built-in support resources for your university yet. Add them so your team can find them.
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

function TeamWorkspace() {
  const { activeScope, subProjectId, subProjects, projectId, role: myRole, departments } = useProject();
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [weeklyUpdate, setWeeklyUpdate] = useState<string | undefined>(undefined);
  const isPresident = myRole === "president";
  const [storedProjectName, setStoredProjectName] = useState(() => getStoredProject().name);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    isSupabaseConfigured ? null : CURRENT_USER_ID
  );
  const [projectTeam, setProjectTeam] = useState<TeamMember[]>([]);
  const [projectScopedCounts, setProjectScopedCounts] = useState<Record<string, Record<TaskStatus, number>>>({});
  const [showMembersModal, setShowMembersModal] = useState(false);
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
    if (!isSupabaseConfigured) return;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { setLoading(false); return; }
      setCurrentUserId(session.user.id);
    });
  }, []);

  // Query team_members once we have both userId and projectId (from context).
  useEffect(() => {
    // Demo mode keeps the mock roster set above; only a real database is queried.
    if (!isSupabaseConfigured || !currentUserId || !projectId) return;

    (async () => {
      // 1. Team roster for this project + the project's display name + lab roles
      const [{ data: memberData }, { data: projectData }, { data: labRolesData }] = await Promise.all([
        supabase
          .from("team_members")
          .select("*, user_profiles(name, avatar_color, avatar_initials, avatar_url, institution), lab_role_id")
          .eq("project_id", projectId),
        supabase
          .from("projects")
          .select("name")
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
          permissionLevel: toUserRole((r as { permission_level: string }).permission_level),
          isSystem: (r as { is_system: boolean }).is_system,
          createdAt: (r as { created_at: string }).created_at,
        })));
      }

      // Override the localStorage-cached name with the real value from the DB.
      if (projectData?.name) setStoredProjectName(projectData.name as string);

      // 2. Task counts - single embedded-join query so PostgREST handles the
      //    task_id → tasks.id match server-side; no client-side Map key lookup needed.
      const memberIds = (memberData ?? []).map((r) => r.user_id as string);
      const countMap: Record<string, Record<TaskStatus, number>> = {};

      if (memberIds.length > 0) {

        const { data: assigneeWithTasks, error: joinError } = await (supabase
          .from("task_assignees")
          .select("user_id, task_id, tasks(id, status, archived)")
          .in("user_id", memberIds));

        if (joinError) console.error("[Team] assignee+task join error:", joinError);


        for (const row of (assigneeWithTasks ?? [])) {
          const taskArr = row.tasks;
          const task = Array.isArray(taskArr) ? taskArr[0] : taskArr;
          if (!task) continue;           // task deleted or RLS-hidden
          if (task.archived) continue;   // skip archived tasks
          const status = task.status as TaskStatus;
          const uid = row.user_id as string;
          if (!countMap[uid]) countMap[uid] = emptyTaskCounts();
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
            role: toUserRole(row.role),
            departmentId: (row.department_id as string | null) ?? null,
            avatarColor: profile?.avatar_color ?? "#B4D4E3",
            avatarInitials: profile?.avatar_initials ?? "??",
            avatarUrl: profile?.avatar_url ?? undefined,
            institution: profile?.institution,
            taskCounts: countMap[uid] ?? emptyTaskCounts(),
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
              role: toUserRole(myProfile.role),
              avatarColor: myProfile.avatar_color ?? "#B4D4E3",
              avatarInitials: myProfile.avatar_initials ?? "??",
              avatarUrl: myProfile.avatar_url ?? undefined,
              institution: myProfile.institution,
              taskCounts: countMap[currentUserId] ?? emptyTaskCounts(),
              weeklyUpdate: undefined,
              weeklyUpdatedAt: undefined,
            });
          }
        }

        setTeam(members);
        setLoading(false);
    })();
  }, [currentUserId, projectId]);

  // Load support resources and institution_key for the president's admin panel.
  useEffect(() => {
    if (!isPresident || !projectId || !isSupabaseConfigured) return;
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
  }, [isPresident, projectId]);

  // In project scope, fetch the full sub-project member list (includes external members
  // who may not be in team_members) directly from sub_project_members + user_profiles.
  // Also fetch task counts scoped to this sub-project so member cards show accurate counts.
  useEffect(() => {
    if (activeScope !== "project" || !subProjectId || !isSupabaseConfigured) {
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("sub_project_members")
        .select("user_id, user_profiles(name, avatar_color, avatar_initials, avatar_url, role, institution)")
        .eq("sub_project_id", subProjectId);

      if (!data) return;
      setProjectTeam(data.map((row) => {
        const p = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
        const prof = p as Record<string, string> | null;
        const name = prof?.name ?? "Unknown";
        return {
          id:              row.user_id as string,
          name,
          email:           "",
          role:            toUserRole(prof?.role),
          avatarColor:     prof?.avatar_color ?? "#B4D4E3",
          avatarInitials:  prof?.avatar_initials ?? name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase(),
          avatarUrl:       prof?.avatar_url ?? undefined,
          institution:     prof?.institution ?? undefined,
          taskCounts:      emptyTaskCounts(),
        } satisfies TeamMember;
      }));

      // Fetch task counts scoped to this sub-project only

      const { data: scopedTasks } = await (supabase
        .from("tasks")
        .select("id, status, archived, task_assignees(user_id)")
        .eq("sub_project_id", subProjectId)
        .eq("archived", false));

      const newCounts: Record<string, Record<TaskStatus, number>> = {};
      for (const task of (scopedTasks ?? []) as { status: string; task_assignees: { user_id: string }[] }[]) {
        const status = task.status as TaskStatus;
        for (const row of (task.task_assignees ?? [])) {
          if (!newCounts[row.user_id]) newCounts[row.user_id] = emptyTaskCounts();
          if (status in newCounts[row.user_id]) newCounts[row.user_id][status]++;
        }
      }
      setProjectScopedCounts(newCounts);
    })();
  }, [activeScope, subProjectId]);

  // In project scope use the directly-fetched list with project-scoped task counts.
  const visibleTeam = activeScope === "project"
    ? projectTeam.map((m) => ({
        ...m,
        taskCounts: projectScopedCounts[m.id] ?? emptyTaskCounts(),
      }))
    : team;

  const teamBadgeName = activeScope === "project"
    ? (subProjects.find((sp) => sp.id === subProjectId)?.name ?? storedProjectName ?? null)
    : null;
  const teamSubtitle = activeScope === "project"
    ? (teamBadgeName ? `Showing members of ${teamBadgeName}.` : `${visibleTeam.length} member${visibleTeam.length !== 1 ? "s" : ""}`)
    : `${visibleTeam.length} member${visibleTeam.length !== 1 ? "s" : ""} · ${storedProjectName}`;
  const canManageProject = activeScope === "project" && subProjectId && projectId
    && (isPresident || (subProjects.find((sp) => sp.id === subProjectId)?.createdBy === currentUserId));

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

        {/* Support resources admin -- president only */}
        {isPresident && projectId && (
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
            {activeScope === "project" ? "No members in this group yet." : "Your LC will appear here once members join."}
          </p>
        )}
        {isPresident && isSupabaseConfigured && departments.length === 0 && activeScope !== "project" && (
          <p role="status" style={{ fontSize: 13, color: "var(--color-body)", marginBottom: 16, padding: "10px 14px", borderRadius: 8, backgroundColor: "var(--color-navy-dim)" }}>
            Your LC has no departments yet.{" "}
            <a href="/settings#departments" style={{ color: "var(--color-navy)", fontWeight: 600 }}>Create them in Settings</a>{" "}
            (e.g. oGX, oGT, oGV) so you can place members and assign VPs.
          </p>
        )}
        {groupDirectory(visibleTeam, departments, activeScope === "project").map((section) => (
          <section key={section.key} aria-labelledby={`team-section-${section.key}`} style={{ marginBottom: 28 }}>
            {section.title && (
              <h2
                id={`team-section-${section.key}`}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: "0 0 12px" }}
              >
                {section.color && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: section.color }} />}
                {section.title}
                <span style={{ fontWeight: 400 }}>· {section.members.length}</span>
              </h2>
            )}
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" }}>
              {section.members.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  department={departments.find((d) => d.id === member.departmentId) ?? null}
                  onClick={() => setSelectedMember(member)}
                  isCurrentUser={member.id === currentUserId}
                />
              ))}
            </div>
          </section>
        ))}

      </div>

      {selectedMember && (
        <MemberPanel
          member={selectedMember}
          onClose={closeMemberPanel}
          isPresident={isPresident}
          projectId={projectId}
          labRoles={labRoles}
          departments={departments}
          onMemberChange={(memberId, patch) => {
            setTeam((prev) => prev.map((m) => m.id === memberId ? { ...m, ...patch } : m));
            setSelectedMember((prev) => prev && prev.id === memberId ? { ...prev, ...patch } : prev);
          }}
        />
      )}
      {meetingModalOpen && <MeetingModal onClose={closeMeetingModal} />}
      {showMembersModal && activeScope === "project" && subProjectId && projectId && (() => {
        const activeSp = subProjects.find((sp) => sp.id === subProjectId);
        const canManage = isPresident || (activeSp?.createdBy != null && activeSp.createdBy === currentUserId);
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

export default function TeamPage() {
  const { projectId, activeScope, subProjectId } = useProject();
  return <TeamWorkspace key={`${projectId}:${activeScope}:${subProjectId}`} />;
}
