"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, GraduationCap, BookOpen, Globe,
  Link as LinkIcon, Settings, Lock, X, Copy, Plus, Check, Pencil,
} from "lucide-react";

function LinkedinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" fill="#0A66C2"/>
      <rect x="2" y="9" width="4" height="12" fill="#0A66C2"/>
      <circle cx="4" cy="4" r="2" fill="#0A66C2"/>
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="#000000"/>
    </svg>
  );
}

import {
  JOURNAL_PROMPTS, ACTIVE_PROMPT_IDS,
} from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { showToast } from "@/components/ui/Toast";
import type { TaskStatus, PromptCategory } from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do", in_progress: "In Progress", in_review: "In Review", done: "Done",
};
const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: "var(--status-todo-text)", in_progress: "var(--color-navy)", in_review: "var(--color-warning)", done: "var(--color-success)",
};
const PROMPT_CATEGORY_LABELS: Record<PromptCategory, string> = {
  emotional_processing: "Emotional Processing",
  research_reflection: "Research Reflection",
  team_support: "Team & Support",
  boundaries_workload: "Boundaries & Workload",
  looking_forward: "Looking Forward",
};
const RESEARCH_PARTICIPATION_OPTIONS = [
  { value: "both_publications", label: "Participate in both publications" },
  { value: "wellbeing_only", label: "Well-being research only" },
  { value: "private", label: "Keep data private" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: "var(--font-roboto)", fontWeight: 700, fontSize: 12,
      textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)",
      margin: "0 0 10px",
    }}>
      {children}
    </p>
  );
}

function FieldInput({
  value, onChange, placeholder, multiline, minHeight,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  multiline?: boolean; minHeight?: number;
}) {
  const style: React.CSSProperties = {
    width: "100%", border: "1px solid var(--color-border)", borderRadius: 8,
    fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 14,
    color: "var(--color-body)", backgroundColor: "var(--color-surface)",
    outline: "none", boxSizing: "border-box",
    padding: multiline ? "10px 14px" : "0 14px",
    resize: multiline ? "vertical" : undefined,
    minHeight: multiline ? (minHeight ?? 120) : 36,
    height: multiline ? undefined : 36,
  };
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={style}
        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={style}
      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
    />
  );
}

function TagPill({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "4px 10px", borderRadius: 20,
      border: "1px solid var(--color-navy)", color: "var(--color-navy)",
      fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 13,
    }}>
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", color: "var(--color-navy)", minWidth: 16, minHeight: 16 }}
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}

function StatCard({ label, count }: { label: string; count: number }) {
  return (
    <div style={{
      backgroundColor: "var(--color-surface)", borderRadius: 10, border: "1px solid var(--color-border)",
      padding: "16px 20px", display: "flex", flexDirection: "column", gap: 4,
    }}>
      <span style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 24, color: "var(--color-navy)", lineHeight: 1 }}>
        {count}
      </span>
      <span style={{ fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 12, color: "var(--color-secondary)" }}>
        {label}
      </span>
    </div>
  );
}

// ── Prompts Modal ─────────────────────────────────────────────────────────────

function PromptsModal({
  activeIds, onSave, onClose,
}: {
  activeIds: string[]; onSave: (ids: string[]) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(activeIds);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const togglePrompt = (id: string) => {
    setDraft((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const categories = Array.from(new Set(JOURNAL_PROMPTS.map((p) => p.category)));

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: "rgba(27,46,75,0.35)" }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "var(--color-surface)", maxWidth: 560, width: "100%", borderRadius: 10,
          border: "1px solid var(--color-border)", boxShadow: "0 8px 32px rgba(27,46,75,0.14)",
          maxHeight: "85vh", display: "flex", flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompts-modal-title"
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          <h2 id="prompts-modal-title" style={{
            fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16,
            color: "var(--color-navy)", margin: 0,
          }}>
            Manage Journal Prompts
          </h2>
          <p style={{ fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-secondary)", marginTop: 4 }}>
            Select which prompts are available to your team.
          </p>
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 24px" }}>
          {categories.map((cat) => (
            <div key={cat} style={{ marginBottom: 20 }}>
              <p style={{
                fontFamily: "var(--font-roboto)", fontWeight: 700, fontSize: 11,
                textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)",
                marginBottom: 8,
              }}>
                {PROMPT_CATEGORY_LABELS[cat]}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {JOURNAL_PROMPTS.filter((p) => p.category === cat).map((prompt) => {
                  const active = draft.includes(prompt.id);
                  return (
                    <button
                      key={prompt.id}
                      onClick={() => togglePrompt(prompt.id)}
                      style={{
                        textAlign: "left", padding: "10px 14px",
                        borderRadius: 8, cursor: "pointer",
                        fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-body)",
                        backgroundColor: active ? "rgba(27,46,75,0.04)" : "var(--color-surface)",
                        border: active ? "1px solid var(--color-navy)" : "1px solid var(--color-border)",
                        transition: "border-color 120ms ease",
                      }}
                    >
                      {prompt.text}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => { onSave(draft); onClose(); }}
            style={{
              height: 44, padding: "0 24px", backgroundColor: "var(--color-navy)", color: "#fff",
              border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)",
              fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy)"; }}
          >
            Save
          </button>
          <button
            onClick={onClose}
            style={{
              height: 44, padding: "0 16px", backgroundColor: "var(--color-surface)", color: "var(--color-secondary)",
              border: "1px solid var(--color-border)", borderRadius: 8, fontFamily: "var(--font-roboto)",
              fontWeight: 600, fontSize: 13, cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Archive Confirm Modal ─────────────────────────────────────────────────────

function ArchiveModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: "rgba(27,46,75,0.35)" }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "var(--color-surface)", maxWidth: 400, width: "100%", borderRadius: 10,
          border: "1px solid var(--color-border)", boxShadow: "0 8px 32px rgba(27,46,75,0.14)",
          padding: 28,
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-modal-title"
      >
        <h2 id="archive-modal-title" style={{
          fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16,
          color: "var(--color-navy)", margin: "0 0 8px",
        }}>
          Archive this project?
        </h2>
        <p style={{
          fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-secondary)",
          lineHeight: 1.6, margin: "0 0 24px",
        }}>
          Team members will lose access. This cannot be undone.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, height: 44, backgroundColor: "var(--color-surface)", color: "var(--color-body)",
              border: "1px solid var(--color-border)", borderRadius: 8,
              fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1, height: 44, backgroundColor: "var(--color-error)", color: "#fff",
              border: "none", borderRadius: 8,
              fontFamily: "var(--font-roboto)", fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-error)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-error)"; }}
          >
            Archive
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Profile Page ──────────────────────────────────────────────────────────────

type LinkFields = {
  scholar: string; linkedin: string; researchgate: string;
  twitter: string; website: string; orcid: string;
};

const EMPTY_LINKS: LinkFields = {
  scholar: "", linkedin: "", researchgate: "", twitter: "", website: "", orcid: "",
};

type TabId = "about" | "links" | "activity";

export default function ProfilePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Source of truth: Supabase ─────────────────────────────────────────────
  const [profile, setProfile] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // ── Photo (local only - needs Supabase Storage to persist) ───────────────
  const [photo, setPhoto] = useState<string | null>(null);

  // ── Edit mode ────────────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [draftBio, setDraftBio] = useState("");
  const [draftInterests, setDraftInterests] = useState<string[]>([]);
  const [draftDepartment, setDraftDepartment] = useState("");
  const [draftInstitution, setDraftInstitution] = useState("");
  const [draftLinks, setDraftLinks] = useState<LinkFields>(EMPTY_LINKS);
  const [interestInput, setInterestInput] = useState("");

  // ── Inline header editing ────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingInstitution, setEditingInstitution] = useState(false);
  const [institutionInput, setInstitutionInput] = useState("");

  // ── Links & interests (UI-only until added to Supabase schema) ───────────
  const [interests, setInterests] = useState<string[]>([]);
  const [links, setLinks] = useState<LinkFields>(EMPTY_LINKS);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>("about");
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 640); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── PI Lab Settings state (initialized from project after load) ──────────
  const [projectName, setProjectName] = useState("");
  const [projectInstitution, setProjectInstitution] = useState("");
  const [researchType, setResearchType] = useState("");
  const [researchParticipation, setResearchParticipation] = useState("");
  const [activePromptIds, setActivePromptIds] = useState<string[]>(ACTIVE_PROMPT_IDS);

  // ── Invite codes (PI only) ────────────────────────────────────────────────
  const [inviteCodes, setInviteCodes] = useState<{ id: string; code: string; used_by: string | null; created_at: string }[]>([]);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [labRoleName, setLabRoleName] = useState<string | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // ── Activity stats ────────────────────────────────────────────────────────
  const [taskCounts, setTaskCounts] = useState<Record<TaskStatus, number>>({
    todo: 0, in_progress: 0, in_review: 0, done: 0,
  });
  const [recentTasks, setRecentTasks] = useState<import("@/types").Task[]>([]);
  const [litCount, setLitCount] = useState(0);
  const [journalStreak, setJournalStreak] = useState(0);

  // ── Load profile & project from Supabase ─────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) { router.push("/login"); return; }

      const { data: prof } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      const { data: membership } = await supabase
        .from("team_members")
        .select("project_id, lab_role_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (membership?.project_id) {
        if (membership.lab_role_id) {
          const { data: roleRow } = await supabase
            .from("lab_roles")
            .select("name")
            .eq("id", membership.lab_role_id)
            .maybeSingle();
          if (roleRow) setLabRoleName((roleRow as { name: string }).name);
        }
        const { data: proj } = await supabase
          .from("projects")
          .select("*")
          .eq("id", membership.project_id)
          .maybeSingle();
        setProject(proj);
        if (proj) {
          setProjectName((proj.name as string) ?? "");
          setProjectInstitution((proj.institution as string) ?? "");
          setResearchType((proj.research_type as string) ?? "");
          setResearchParticipation((proj.research_participation as string) ?? "private");
        }
      }

      setProfile(prof);
      if (prof?.avatar_url) setPhoto(prof.avatar_url);
      setLoading(false);
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load activity stats once project is known ─────────────────────────────
  useEffect(() => {
    if (!project?.id) return;

    const projectId = project.id as string;

    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null;
      if (!user) return;

      supabase.from("tasks").select("id,status,title,due_date,created_at")
        .eq("project_id", projectId)
        .then(({ data }) => {
          if (!data) return;
          const counts = { todo: 0, in_progress: 0, in_review: 0, done: 0 } as Record<TaskStatus, number>;
          data.forEach((t) => { counts[t.status as TaskStatus] = (counts[t.status as TaskStatus] ?? 0) + 1; });
          setTaskCounts(counts);
          const recent = [...data]
            .sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime())
            .slice(0, 5)
            .map((row) => ({
              id: row.id as string, projectId, title: row.title as string,
              description: "", status: row.status as TaskStatus,
              priority: "medium" as const, assigneeIds: [],
              dueDate: row.due_date as string | undefined,
              createdAt: row.created_at as string, updatedAt: row.created_at as string,
              comments: [], files: [], links: [],
            }));
          setRecentTasks(recent);
        });

      supabase.from("literature_items").select("id", { count: "exact", head: true })
        .eq("project_id", projectId).eq("added_by", user.id)
        .then(({ count }) => setLitCount(count ?? 0));

      const monthStart = new Date().toISOString().slice(0, 7) + "-01";
      supabase.from("journal_entries").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).gte("created_at", monthStart)
        .then(({ count }) => setJournalStreak(count ?? 0));
    });
  }, [project]);

  // ── Load invite codes once profile is known (PI only) ────────────────────
  useEffect(() => {
    if (!profile || profile.role !== "pi") return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null;
      if (!user) return;
      supabase.from("invite_codes")
        .select("id, code, used_by, created_at")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .then(({ data }) => {
          if (data) setInviteCodes(data as typeof inviteCodes);
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const handleGenerateCode = useCallback(async () => {
    setGeneratingCode(true);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user || !project?.id) { setGeneratingCode(false); return; }
    const code = "CANOPY-" + Math.random().toString(36).substring(2, 6).toUpperCase();
    const { data } = await supabase.from("invite_codes")
      .insert({ code, project_id: project.id, created_by: user.id })
      .select("id, code, used_by, created_at")
      .single();
    if (data) setInviteCodes((prev) => [data as (typeof inviteCodes)[0], ...prev]);
    setGeneratingCode(false);
  }, [project]);

  const handleCopyInvite = useCallback(async (codeId: string, code: string) => {
    const link = `${window.location.origin}/login?invite=${code}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopiedCodeId(codeId);
    setTimeout(() => setCopiedCodeId((prev) => (prev === codeId ? null : prev)), 2000);
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handlePhotoChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!file.type.startsWith("image/")) {
      showToast("Please select an image file (JPG, PNG, GIF, WebP).", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("Image must be smaller than 5 MB.", "error");
      return;
    }

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => setPhoto(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Upload to Supabase Storage
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) return;

    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${user.id}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      showToast("Photo preview shown. Storage upload failed: " + uploadError.message, "error");
      return;
    }

    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) return;

    // Store a cache-busted URL so all sessions (not just the current one) get the fresh image.
    const bustedUrl = publicUrl + "?t=" + Date.now();
    setPhoto(bustedUrl);

    await supabase.from("user_profiles").update({ avatar_url: bustedUrl }).eq("id", user.id);
    showToast("Profile photo updated.", "success");
  }, []);

  const handleRemovePhoto = useCallback(async () => {
    setPhoto(null);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (user) {
      await supabase.from("user_profiles").update({ avatar_url: null }).eq("id", user.id);
    }
  }, []);

  const handleSaveName = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (trimmed) {
      const parts = trimmed.split(/\s+/).filter(Boolean);
      const newInitials = parts.length === 1
        ? parts[0][0].toUpperCase()
        : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();

      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (user) {
        const { data: updated } = await supabase
          .from("user_profiles")
          .update({ name: trimmed, avatar_initials: newInitials })
          .eq("id", user.id)
          .select("*")
          .maybeSingle();
        if (updated) {
          setProfile(updated);
          window.dispatchEvent(new CustomEvent("canopy:profile-updated", { detail: updated }));
        }
      }
    }
    setEditingName(false);
  }, [nameInput]);

  const handleSaveInstitution = useCallback(async () => {
    const trimmed = institutionInput.trim();
    if (trimmed) {
      if (profile?.role === "pi" && project?.id) {
        const { data: updatedProj } = await supabase
          .from("projects")
          .update({ institution: trimmed })
          .eq("id", project.id)
          .select("*")
          .maybeSingle();
        if (updatedProj) setProject(updatedProj);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user ?? null;
        if (user) {
          const { data: updatedProf } = await supabase
            .from("user_profiles")
            .update({ institution: trimmed })
            .eq("id", user.id)
            .select("*")
            .maybeSingle();
          if (updatedProf) setProfile(updatedProf);
        }
      }
    }
    setEditingInstitution(false);
  }, [institutionInput, profile?.role, project]);

  const handleEnterEditMode = useCallback(() => {
    setDraftBio(profile?.bio ?? "");
    setDraftInterests([...interests]);
    setDraftDepartment(profile?.department ?? "");
    setDraftInstitution(profile?.institution ?? "");
    setDraftLinks({ ...links });
    setEditMode(true);
  }, [profile, interests, links]);

  const handleSaveProfile = useCallback(async () => {
    setInterests(draftInterests);
    setLinks(draftLinks);

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (user) {
      const updatePayload: Record<string, string | null> = {
        bio: draftBio || null,
        department: draftDepartment || null,
      };
      if (profile?.role !== "pi") updatePayload.institution = draftInstitution || null;
      const { data: updated } = await supabase
        .from("user_profiles")
        .update(updatePayload)
        .eq("id", user.id)
        .select("*")
        .maybeSingle();
      if (updated) setProfile(updated);
    }

    setEditMode(false);
    setInterestInput("");
    showToast("Profile updated.", "success");
  }, [draftBio, draftDepartment, draftInstitution, draftInterests, draftLinks, profile?.role]);

  const handleCancelEdit = useCallback(() => {
    setEditMode(false);
    setInterestInput("");
  }, []);

  const handleAddInterest = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const val = interestInput.trim();
    if (!val || draftInterests.length >= 8 || draftInterests.includes(val)) return;
    setDraftInterests((prev) => [...prev, val]);
    setInterestInput("");
  }, [interestInput, draftInterests]);

  const handleSaveLabSettings = useCallback(async () => {
    if (!project?.id) return;
    await supabase
      .from("projects")
      .update({
        name: projectName,
        institution: projectInstitution,
        research_type: researchType,
        research_participation: researchParticipation,
      })
      .eq("id", project.id);
    setProject((prev: any) => ({
      ...prev,
      name: projectName,
      institution: projectInstitution,
      research_type: researchType,
      research_participation: researchParticipation,
    }));
    showToast("Lab settings saved.", "success");
  }, [project, projectName, projectInstitution, researchType, researchParticipation]);

  const handleSavePrompts = useCallback((ids: string[]) => {
    setActivePromptIds(ids);
  }, []);

  // ── Derived display values ────────────────────────────────────────────────
  const isPi = profile?.role === "pi";
  const memberSinceDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "";
  const roleBadgeLabel = labRoleName ?? (profile?.role === "pi" ? "Principal Investigator" : "Researcher");

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const tabs: { id: TabId; label: string }[] = [
    { id: "about", label: "About" },
    { id: "links", label: "Links" },
    { id: "activity", label: "Activity" },
  ];

  // ── Link platform definitions ──────────────────────────────────────────────
  const linkPlatforms: {
    key: keyof LinkFields;
    label: string;
    icon: React.ReactNode;
    placeholder: string;
  }[] = [
    {
      key: "scholar", label: "Google Scholar",
      icon: <GraduationCap size={16} color="#4285F4" />,
      placeholder: "https://scholar.google.com/citations?user=...",
    },
    {
      key: "linkedin", label: "LinkedIn",
      icon: <LinkedinIcon />,
      placeholder: "https://linkedin.com/in/yourname",
    },
    {
      key: "researchgate", label: "ResearchGate",
      icon: <BookOpen size={16} color="#00CCBB" />,
      placeholder: "https://researchgate.net/profile/...",
    },
    {
      key: "twitter", label: "Twitter / X",
      icon: <TwitterIcon />,
      placeholder: "https://twitter.com/yourhandle",
    },
    {
      key: "website", label: "Personal website",
      icon: <Globe size={16} color="var(--color-secondary)" />,
      placeholder: "https://yourname.com",
    },
    {
      key: "orcid", label: "ORCID",
      icon: <LinkIcon size={16} color="#A6CE39" />,
      placeholder: "https://orcid.org/0000-0000-0000-0000",
    },
  ];

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    const bar = (w: string | number, h = 13, mb = 0) => (
      <div style={{ width: w, height: h, borderRadius: 4, backgroundColor: "var(--color-border)", opacity: 0.6, marginBottom: mb }} className="animate-pulse" />
    );
    return (
      <div style={{ padding: isMobile ? "16px" : "40px 24px", backgroundColor: "var(--color-canvas)", minHeight: "100%" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {/* Back link */}
          <div style={{ marginBottom: 24 }}>{bar(56, 13)}</div>
          {/* Header card */}
          <div style={{ backgroundColor: "var(--color-surface)", borderRadius: 10, border: "1px solid var(--color-border)", padding: isMobile ? "20px 16px 16px" : "28px 28px 24px", marginBottom: 24, display: "flex", gap: 28 }}>
            <div style={{ width: 96, height: 96, borderRadius: "50%", backgroundColor: "var(--color-border)", flexShrink: 0 }} className="animate-pulse" />
            <div style={{ flex: 1, paddingTop: 8 }}>
              {bar("60%", 20, 10)}
              {bar("40%", 13, 8)}
              {bar("50%", 13)}
            </div>
          </div>
          {/* Section cards */}
          {[1, 2].map((i) => (
            <div key={i} style={{ backgroundColor: "var(--color-surface)", borderRadius: 10, border: "1px solid var(--color-border)", padding: "20px 24px", marginBottom: 20 }}>
              {bar("30%", 11, 16)}
              {[1, 2, 3].map((j) => (
                <div key={j} style={{ marginBottom: 14 }}>
                  {bar("20%", 10, 6)}
                  {bar("100%", 36)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const displayName = profile?.name ?? "";
  const displayInitials = profile?.avatar_initials ?? "??";
  const displayAvatarColor = profile?.avatar_color ?? "#B4D4E3";
  const displayInstitution = isPi ? (project?.institution ?? "") : (profile?.institution ?? "");
  const displayBio = profile?.bio ?? "";
  const displayDepartment = profile?.department ?? "";

  return (
    <div style={{ padding: isMobile ? "16px" : "40px 24px", backgroundColor: "var(--color-canvas)", minHeight: "100%" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>

        {/* Back link */}
        <button
          onClick={() => router.push("/")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "none", border: "none", cursor: "pointer",
            fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13,
            color: "var(--color-navy)", textDecoration: "none", padding: 0, marginBottom: 24,
            minHeight: 44,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
        >
          <ChevronLeft size={16} />
          Back
        </button>

        {/* ── Header section ─────────────────────────────────────────────── */}
        <div style={{
          backgroundColor: "var(--color-surface)", borderRadius: 10, border: "1px solid var(--color-border)",
          padding: isMobile ? "20px 16px 16px" : "28px 28px 24px", marginBottom: 24,
          display: "flex", flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 16 : 28, alignItems: isMobile ? "center" : "flex-start",
        }}>
          {/* Avatar column */}
          <div style={{ width: isMobile ? "auto" : 140, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            {photo ? (
              <div style={{ width: 96, height: 96, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
                <img
                  src={photo}
                  alt={displayName}
                  style={{ width: 96, height: 96, objectFit: "cover", display: "block" }}
                />
              </div>
            ) : (
              <div style={{
                width: 96, height: 96, borderRadius: "50%", flexShrink: 0,
                backgroundColor: displayAvatarColor,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 28, color: "#3a3a3a",
                userSelect: "none",
              }}>
                {displayInitials}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handlePhotoChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                height: 36, minHeight: 44, padding: "0 12px",
                backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 7,
                fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 11,
                color: "var(--color-navy)", cursor: "pointer", whiteSpace: "nowrap",
                display: "flex", alignItems: "center",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-navy-dim)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)"; }}
            >
              Change photo
            </button>

            {photo && (
              <button
                onClick={handleRemovePhoto}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 12,
                  color: "var(--color-error)", padding: 0, minHeight: 44, display: "flex", alignItems: "center",
                }}
              >
                Remove photo
              </button>
            )}
          </div>

          {/* Info column */}
          <div style={{ flex: 1, minWidth: 0, width: isMobile ? "100%" : undefined, textAlign: isMobile ? "center" : undefined }}>
            {/* Name row + edit button */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 8, justifyContent: isMobile ? "center" : undefined, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editingName ? (
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleSaveName(); }
                      else if (e.key === "Escape") setEditingName(false);
                    }}
                    onBlur={handleSaveName}
                    style={{
                      fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 24,
                      color: "var(--color-navy)", border: "none", borderBottom: "2px solid var(--color-navy)",
                      outline: "none", background: "transparent", width: "100%",
                      padding: "0 0 2px",
                    }}
                  />
                ) : (
                  <div
                    className="group"
                    onClick={() => { setNameInput(displayName); setEditingName(true); }}
                    title="Click to edit name"
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                  >
                    <h1
                      style={{
                        fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 24,
                        color: displayName ? "var(--color-navy)" : "var(--color-secondary)", margin: 0,
                        wordBreak: "break-word",
                      }}
                    >
                      {displayName || "Set up your profile"}
                    </h1>
                    <span
                      className="opacity-0 group-hover:opacity-60 transition-opacity"
                      aria-hidden="true"
                      style={{ flexShrink: 0, paddingTop: 4 }}
                    >
                      <Pencil size={14} color="var(--color-secondary)" />
                    </span>
                  </div>
                )}
              </div>

              {!editMode ? (
                <button
                  onClick={handleEnterEditMode}
                  style={{
                    height: 36, minHeight: 44, padding: "0 14px", flexShrink: 0,
                    backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8,
                    fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 12,
                    color: "var(--color-navy)", cursor: "pointer", display: "flex", alignItems: "center",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-navy-dim)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)"; }}
                >
                  Edit profile
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={handleSaveProfile}
                    style={{
                      height: 36, minHeight: 44, padding: "0 14px",
                      backgroundColor: "var(--color-navy)", color: "#fff",
                      border: "none", borderRadius: 8,
                      fontFamily: "var(--font-roboto)", fontWeight: 700, fontSize: 12,
                      cursor: "pointer", display: "flex", alignItems: "center",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy-hover)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy)"; }}
                  >
                    Save changes
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    style={{
                      height: 36, minHeight: 44, padding: "0 12px",
                      backgroundColor: "var(--color-surface)", color: "var(--color-secondary)",
                      border: "1px solid var(--color-border)", borderRadius: 8,
                      fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 12,
                      cursor: "pointer", display: "flex", alignItems: "center",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Role badge */}
            <div style={{ marginBottom: 8 }}>
              <span style={{
                display: "inline-block", padding: "3px 10px", borderRadius: 20,
                backgroundColor: "var(--color-navy)", color: "#fff",
                fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 11,
              }}>
                {roleBadgeLabel}
              </span>
            </div>

            {/* Institution */}
            {editingInstitution ? (
              <input
                autoFocus
                value={institutionInput}
                onChange={(e) => setInstitutionInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setEditingInstitution(false); }}
                style={{
                  fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 14,
                  color: "var(--color-secondary)", border: "none", borderBottom: "1px solid var(--color-navy)",
                  outline: "none", background: "transparent", width: "100%", padding: "0 0 2px",
                }}
              />
            ) : (
              <p
                onClick={() => { setInstitutionInput(displayInstitution); setEditingInstitution(true); }}
                title="Click to edit"
                style={{
                  fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 14,
                  color: "var(--color-secondary)", margin: 0, cursor: "text",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%",
                }}
              >
                {displayInstitution}
              </p>
            )}
          </div>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div style={{
          backgroundColor: "var(--color-surface)", borderRadius: 10, border: "1px solid var(--color-border)",
          overflow: "hidden",
        }}>
          {/* Tab bar */}
          <div style={{
            display: "flex", borderBottom: "1px solid var(--color-border)",
            paddingLeft: 4, overflowX: "auto",
          }}>
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: isMobile ? "0 12px" : "0 20px", height: 48, minHeight: 44,
                    background: "none", border: "none", cursor: "pointer",
                    fontFamily: "var(--font-roboto)", fontWeight: active ? 600 : 400,
                    fontSize: isMobile ? 13 : 14, color: active ? "var(--color-navy)" : "var(--color-secondary)",
                    borderBottom: active ? "2px solid var(--color-navy)" : "2px solid transparent",
                    transition: "color 120ms ease, border-color 120ms ease",
                    marginBottom: -1, whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div style={{ padding: isMobile ? 16 : 28 }}>

            {/* ── ABOUT ──────────────────────────────────────────────────── */}
            {activeTab === "about" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                {/* Bio */}
                <div>
                  <SectionLabel>Bio</SectionLabel>
                  {editMode ? (
                    <FieldInput
                      value={draftBio}
                      onChange={setDraftBio}
                      placeholder="Tell your team a bit about your research background and what brought you to this work."
                      multiline
                    />
                  ) : (
                    <p style={{
                      fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 14,
                      color: displayBio ? "var(--color-body)" : "var(--color-secondary)", lineHeight: 1.7, margin: 0,
                    }}>
                      {displayBio || "No bio yet."}
                    </p>
                  )}
                </div>

                {/* Research Interests */}
                <div>
                  <SectionLabel>Research Interests</SectionLabel>
                  {editMode ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {draftInterests.map((tag) => (
                          <TagPill
                            key={tag}
                            label={tag}
                            onRemove={() => setDraftInterests((prev) => prev.filter((t) => t !== tag))}
                          />
                        ))}
                      </div>
                      {draftInterests.length < 8 && (
                        <input
                          type="text"
                          value={interestInput}
                          onChange={(e) => setInterestInput(e.target.value)}
                          onKeyDown={handleAddInterest}
                          placeholder="Add a research interest and press Enter"
                          style={{
                            height: 36, border: "1px solid var(--color-border)", borderRadius: 8,
                            padding: "0 14px", fontFamily: "var(--font-roboto)",
                            fontWeight: 400, fontSize: 13, color: "var(--color-body)",
                            outline: "none", boxSizing: "border-box",
                          }}
                          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
                          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
                        />
                      )}
                    </div>
                  ) : (
                    interests.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {interests.map((tag) => <TagPill key={tag} label={tag} />)}
                      </div>
                    ) : (
                      <p style={{ fontFamily: "var(--font-roboto)", fontSize: 14, color: "var(--color-secondary)", margin: 0 }}>
                        No interests added yet.
                      </p>
                    )
                  )}
                </div>

                {/* Department */}
                <div>
                  <SectionLabel>Department</SectionLabel>
                  {editMode ? (
                    <FieldInput
                      value={draftDepartment}
                      onChange={setDraftDepartment}
                      placeholder="e.g. Department of Psychology"
                    />
                  ) : (
                    <p style={{
                      fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 14,
                      color: displayDepartment ? "var(--color-body)" : "var(--color-secondary)", margin: 0,
                    }}>
                      {displayDepartment || "Not specified."}
                    </p>
                  )}
                </div>

                {/* Institution (researchers only - PIs edit this via the inline header or Lab Settings) */}
                {!isPi && (
                  <div>
                    <SectionLabel>Institution</SectionLabel>
                    {editMode ? (
                      <FieldInput
                        value={draftInstitution}
                        onChange={setDraftInstitution}
                        placeholder="e.g. Northwestern University"
                      />
                    ) : (
                      <p style={{
                        fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 14,
                        color: displayInstitution ? "var(--color-body)" : "var(--color-secondary)", margin: 0,
                      }}>
                        {displayInstitution || "Not specified."}
                      </p>
                    )}
                  </div>
                )}

                {/* Member since */}
                <div>
                  <SectionLabel>Member since</SectionLabel>
                  <p style={{ fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 14, color: "var(--color-secondary)", margin: 0 }}>
                    {memberSinceDate}
                  </p>
                </div>
              </div>
            )}

            {/* ── LINKS ──────────────────────────────────────────────────── */}
            {activeTab === "links" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {linkPlatforms.map(({ key, label, icon, placeholder }) => {
                  const value = editMode ? draftLinks[key] : links[key];
                  return (
                    <div
                      key={key}
                      style={{
                        backgroundColor: "var(--color-surface)", borderRadius: 10, border: "1px solid var(--color-border)",
                        padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
                        flexWrap: isMobile ? "wrap" : undefined,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                        {icon}
                      </div>
                      <span style={{
                        fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13,
                        color: "var(--color-body)", width: isMobile ? 88 : 120, flexShrink: 0,
                      }}>
                        {label}
                      </span>
                      {editMode ? (
                        <input
                          type="url"
                          value={draftLinks[key]}
                          onChange={(e) => setDraftLinks((prev) => ({ ...prev, [key]: e.target.value }))}
                          placeholder={placeholder}
                          style={{
                            flex: 1, minWidth: 0, height: 36, border: "1px solid var(--color-border)", borderRadius: 8,
                            padding: "0 14px", fontFamily: "var(--font-roboto)",
                            fontWeight: 400, fontSize: 13, color: "var(--color-body)",
                            outline: "none", boxSizing: "border-box",
                            width: isMobile ? "100%" : undefined,
                          }}
                          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
                          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
                        />
                      ) : value ? (
                        <a
                          href={value}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            flex: 1, fontFamily: "var(--font-roboto)", fontWeight: 400,
                            fontSize: 13, color: "var(--color-navy)", textDecoration: "none",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = "underline"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = "none"; }}
                        >
                          {value.length > 40 ? value.slice(0, 40) + "…" : value}
                        </a>
                      ) : (
                        <span style={{ flex: 1, fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-secondary)" }}>
                          Not added
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── ACTIVITY ───────────────────────────────────────────────── */}
            {activeTab === "activity" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                <div>
                  <SectionLabel>Task Summary</SectionLabel>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <StatCard label="To Do" count={taskCounts.todo} />
                    <StatCard label="In Progress" count={taskCounts.in_progress} />
                    <StatCard label="In Review" count={taskCounts.in_review} />
                    <StatCard label="Done" count={taskCounts.done} />
                  </div>
                </div>

                <div>
                  <SectionLabel>Recent Task Activity</SectionLabel>
                  {recentTasks.length === 0 ? (
                    <p style={{ fontFamily: "var(--font-roboto)", fontSize: 14, color: "var(--color-secondary)", margin: 0 }}>
                      No tasks assigned yet.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {recentTasks.map((task) => (
                        <div
                          key={task.id}
                          style={{
                            backgroundColor: "var(--color-surface)", borderRadius: 8, border: "1px solid var(--color-border)",
                            padding: "12px 16px", display: "flex", alignItems: "center",
                            gap: 12, flexWrap: "wrap",
                          }}
                        >
                          <span style={{
                            flex: 1, fontFamily: "var(--font-roboto)", fontWeight: 500,
                            fontSize: 13, color: "var(--color-body)", minWidth: 0,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {task.title}
                          </span>
                          <span style={{
                            padding: "3px 10px", borderRadius: 20,
                            backgroundColor: STATUS_COLORS[task.status] + "18",
                            color: STATUS_COLORS[task.status],
                            fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 11,
                            flexShrink: 0,
                          }}>
                            {STATUS_LABELS[task.status]}
                          </span>
                          {task.dueDate && (
                            <span style={{
                              fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 12,
                              color: "var(--color-secondary)", flexShrink: 0,
                            }}>
                              Due {new Date(task.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <SectionLabel>Literature Contributions</SectionLabel>
                  <p style={{ fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>
                    {litCount} {litCount === 1 ? "item" : "items"} added to the Lab Library
                  </p>
                </div>

                <div>
                  <SectionLabel>Journal</SectionLabel>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <p style={{ fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>
                      {journalStreak} journal {journalStreak === 1 ? "entry" : "entries"} this month
                    </p>
                    <Lock size={13} color="var(--color-secondary)" />
                    <span style={{ fontFamily: "var(--font-roboto)", fontSize: 12, color: "var(--color-secondary)" }}>
                      Only you can see this
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Lab settings moved to Settings page */}
            {false && isPi && (
              <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                <div>
                  <SectionLabel>Project Name</SectionLabel>
                  <FieldInput value={projectName} onChange={setProjectName} placeholder="Project name" />
                </div>

                <div>
                  <SectionLabel>Institution</SectionLabel>
                  <FieldInput value={projectInstitution} onChange={setProjectInstitution} placeholder="Institution name" />
                </div>

                <div>
                  <SectionLabel>Research Type</SectionLabel>
                  <FieldInput
                    value={researchType}
                    onChange={setResearchType}
                    placeholder="e.g. Trauma, Oncology, Veteran PTSD"
                  />
                </div>

                <div>
                  <SectionLabel>Research Participation</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {RESEARCH_PARTICIPATION_OPTIONS.map((opt) => (
                      <label
                        key={opt.value}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          fontFamily: "var(--font-roboto)", fontSize: 14, color: "var(--color-body)",
                          cursor: "pointer", minHeight: 44,
                        }}
                      >
                        <input
                          type="radio"
                          name="research_participation"
                          value={opt.value}
                          checked={researchParticipation === opt.value}
                          onChange={() => setResearchParticipation(opt.value)}
                          style={{ accentColor: "var(--color-navy)", width: 16, height: 16, flexShrink: 0 }}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                  <p style={{
                    fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 12,
                    color: "var(--color-secondary)", marginTop: 8,
                  }}>
                    This controls how your lab's anonymized data contributes to Canopy's research publications.
                  </p>
                </div>

                <div>
                  <SectionLabel>Journal Prompts</SectionLabel>
                  <button
                    onClick={() => setPromptModalOpen(true)}
                    style={{
                      height: 44, padding: "0 20px",
                      backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8,
                      fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13,
                      color: "var(--color-navy)", cursor: "pointer",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-navy-dim)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)"; }}
                  >
                    Manage prompts ({activePromptIds.length} active)
                  </button>
                </div>

                {/* ── Invite ───────────────────────────────────────────── */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <SectionLabel>Invite</SectionLabel>
                    <button
                      onClick={handleGenerateCode}
                      disabled={generatingCode}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        height: 36, padding: "0 14px",
                        backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8,
                        fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 12,
                        color: "var(--color-navy)", cursor: generatingCode ? "default" : "pointer",
                        opacity: generatingCode ? 0.6 : 1,
                      }}
                      onMouseEnter={(e) => { if (!generatingCode) (e.currentTarget as HTMLElement).style.borderColor = "var(--color-navy-dim)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)"; }}
                    >
                      <Plus size={12} />
                      Generate new code
                    </button>
                  </div>
                  {inviteCodes.length === 0 ? (
                    <p style={{ fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-secondary)" }}>
                      No invite codes yet. Generate one to invite researchers.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {inviteCodes.map((ic) => (
                        <div
                          key={ic.id}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "10px 14px", border: "1px solid var(--color-border)", borderRadius: 8,
                            backgroundColor: ic.used_by ? "var(--color-canvas)" : "var(--color-surface)",
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{
                              fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13,
                              color: ic.used_by ? "var(--color-secondary)" : "var(--color-navy)",
                              letterSpacing: "0.04em",
                            }}>
                              {ic.code}
                            </span>
                            <span style={{ fontFamily: "var(--font-roboto)", fontSize: 11, color: "var(--color-secondary)" }}>
                              {ic.used_by ? "Used" : "Available"}
                            </span>
                          </div>
                          {!ic.used_by && (
                            <button
                              onClick={() => handleCopyInvite(ic.id, ic.code)}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 5,
                                height: 32, padding: "0 12px",
                                backgroundColor: copiedCodeId === ic.id ? "rgba(46,125,82,0.08)" : "var(--color-surface)",
                                border: "1px solid var(--color-border)", borderRadius: 7,
                                fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 12,
                                color: copiedCodeId === ic.id ? "var(--color-success)" : "var(--color-navy)",
                                cursor: "pointer", transition: "background-color 150ms ease",
                              }}
                              onMouseEnter={(e) => { if (copiedCodeId !== ic.id) (e.currentTarget as HTMLElement).style.borderColor = "var(--color-navy-dim)"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border)"; }}
                            >
                              {copiedCodeId === ic.id
                                ? <><Check size={11} />Copied!</>
                                : <><Copy size={11} />Copy invite link</>}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleSaveLabSettings}
                  style={{
                    alignSelf: "flex-start", height: 44, padding: "0 24px",
                    backgroundColor: "var(--color-navy)", color: "#fff", border: "none",
                    borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 700,
                    fontSize: 13, cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy-hover)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy)"; }}
                >
                  Save lab settings
                </button>

                <div style={{
                  border: "1px solid var(--color-error)", borderRadius: 10, padding: 16, marginTop: 8,
                }}>
                  <p style={{
                    fontFamily: "var(--font-roboto)", fontWeight: 700, fontSize: 13,
                    color: "var(--color-error)", margin: "0 0 12px",
                  }}>
                    Danger Zone
                  </p>
                  <button
                    onClick={() => setArchiveModalOpen(true)}
                    style={{
                      height: 44, padding: "0 20px",
                      backgroundColor: "var(--color-surface)", border: "1px solid var(--color-error)",
                      borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600,
                      fontSize: 13, color: "var(--color-error)", cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(192,57,43,0.08)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface)";
                    }}
                  >
                    Archive project
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {promptModalOpen && (
        <PromptsModal
          activeIds={activePromptIds}
          onSave={handleSavePrompts}
          onClose={() => setPromptModalOpen(false)}
        />
      )}
      {archiveModalOpen && (
        <ArchiveModal onClose={() => setArchiveModalOpen(false)} />
      )}
    </div>
  );
}
