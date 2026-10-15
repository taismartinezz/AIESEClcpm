"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import { computeInitials } from "@/lib/utils";
import Avatar from "@/components/ui/Avatar";
import type { SubProject } from "@/types";

interface LabMember {
  userId: string;
  name: string;
  avatarColor: string;
  avatarInitials: string;
  avatarUrl?: string;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  border: "1px solid var(--color-border)",
  borderRadius: 7,
  padding: "0 10px",
  fontSize: 13,
  fontFamily: "var(--font-roboto)",
  backgroundColor: "var(--color-canvas)",
  color: "var(--color-body)",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--color-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 6,
  display: "block",
};

const MATERIAL_COLORS = [
  "#4285F4", "#EA4335", "#34A853", "#FBBC05",
  "#FF6D00", "#9C27B0", "#00BCD4", "#795548",
];

export default function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const { projectId, addSubProject, setActiveSubProject, subProjects } = useProject();
  const [name, setName]             = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const [labRoster, setLabRoster]   = useState<LabMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!projectId) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      const userId = session?.user?.id;
      supabase
        .from("team_members")
        .select("user_id, user_profiles(name, avatar_color, avatar_initials, avatar_url)")
        .eq("project_id", projectId)
        .then(({ data }) => {
          if (!data) return;
          setLabRoster(
            data
              .filter((r) => r.user_id !== userId)
              .map((r) => {
                const p = Array.isArray(r.user_profiles) ? r.user_profiles[0] : r.user_profiles;
                const profile = p as Record<string, string> | null;
                const name = profile?.name ?? "Unknown";
                return {
                  userId: r.user_id as string,
                  name,
                  avatarColor: profile?.avatar_color ?? "#B4D4E3",
                  avatarInitials: computeInitials(name) || (profile?.avatar_initials ?? "??"),
                  avatarUrl: profile?.avatar_url ?? undefined,
                };
              })
          );
        });
    });
  }, [projectId]);

  async function handleSubmit() {
    if (!name.trim()) { setError("Project name is required."); return; }
    if (!projectId) { setError("No lab context found. Please refresh."); return; }
    setError("");
    setSaving(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;

      // Pick a color not yet used by existing projects; cycle if all taken
      const usedColors = new Set(subProjects.map((sp) => sp.color).filter(Boolean));
      const color = MATERIAL_COLORS.find((c) => !usedColors.has(c))
        ?? MATERIAL_COLORS[subProjects.length % MATERIAL_COLORS.length];

      // Insert sub-project row
      const { data, error: insertError } = await supabase
        .from("sub_projects")
        .insert({
          project_id:  projectId,
          name:        name.trim(),
          description: description.trim() || null,
          created_by:  userId,
          archived:    false,
          color,
        })
        .select()
        .single();

      if (insertError) {
        console.error("[CreateProjectModal] insert error:", insertError);
        setError("Failed to create project. Please try again.");
        setSaving(false);
        return;
      }

      // Add creator to sub_project_members
      if (userId) {
        const { error: memberError } = await supabase
          .from("sub_project_members")
          .insert({ sub_project_id: data.id, user_id: userId });
        if (memberError) {
          console.error("[CreateProjectModal] sub_project_members insert error:", memberError);
        }
      }

      // Add selected lab members (fire-and-forget - never blocks project creation)
      if (selectedMembers.size > 0 && userId) {
        const rows = [...selectedMembers].map((uid) => ({
          sub_project_id: data.id,
          user_id: uid,
          invited_by: userId,
        }));
        supabase.from("sub_project_members").insert(rows).then(({ error: batchErr }) => {
          if (batchErr) console.error("[CreateProjectModal] batch member insert error:", batchErr);
        });
      }

      // Optimistically update context - no re-fetch needed
      const newSp: SubProject = {
        id:          data.id          as string,
        projectId:   data.project_id  as string,
        name:        data.name        as string,
        description: (data.description as string | null) ?? undefined,
        createdBy:   (data.created_by  as string | null) ?? undefined,
        createdAt:   data.created_at  as string,
        archived:    false,
        color,
      };
      addSubProject(newSp);
      setActiveSubProject(newSp.id);
      onClose();
    } catch (err) {
      console.error("[CreateProjectModal] unexpected error:", err);
      setError("Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: "rgba(27,46,75,0.35)" }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "var(--color-surface)",
          maxWidth: 440,
          width: "100%",
          borderRadius: 10,
          padding: 28,
          boxShadow: "0 8px 40px rgba(27,46,75,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2
            style={{
              fontFamily: "var(--font-lora)",
              fontWeight: 600,
              fontSize: 16,
              color: "var(--color-navy)",
              margin: 0,
            }}
          >
            New project
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-lg hover:bg-[rgba(27,46,75,0.06)] transition-colors"
            style={{ width: 36, height: 36 }}
            aria-label="Close"
          >
            <X size={16} color="var(--color-secondary)" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label style={labelStyle}>Project name *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              placeholder="e.g. Phase 2 Interviews"
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            />
            {error && (
              <p style={{ fontSize: 12, color: "var(--color-error)", marginTop: 4 }}>{error}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              rows={3}
              style={{
                ...inputStyle,
                height: "auto",
                padding: "8px 10px",
                resize: "vertical",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            />
          </div>

          {/* People */}
          {labRoster.length > 0 && (
            <div>
              <label style={labelStyle}>Add people <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
              <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {labRoster.map((member) => {
                  const checked = selectedMembers.has(member.userId);
                  return (
                    <label
                      key={member.userId}
                      className="flex items-center gap-2.5 cursor-pointer rounded-lg hover:bg-[rgba(27,46,75,0.04)]"
                      style={{ padding: "6px 8px" }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedMembers((prev) => {
                            const next = new Set(prev);
                            if (checked) next.delete(member.userId); else next.add(member.userId);
                            return next;
                          })
                        }
                        style={{ width: 14, height: 14, accentColor: "var(--color-navy)", flexShrink: 0 }}
                      />
                      <Avatar
                        user={{ name: member.name, avatarColor: member.avatarColor, avatarInitials: member.avatarInitials, avatarUrl: member.avatarUrl }}
                        size={22}
                      />
                      <span style={{ fontSize: 13, color: "var(--color-body)" }}>{member.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--color-body)",
              border: "1px solid var(--color-border)",
              borderRadius: 7,
              padding: "8px 16px",
              backgroundColor: "transparent",
              cursor: "pointer",
              minHeight: 44,
              fontFamily: "var(--font-roboto)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
              backgroundColor: "var(--color-navy)",
              border: "none",
              borderRadius: 7,
              padding: "8px 20px",
              cursor: saving ? "default" : "pointer",
              minHeight: 44,
              fontFamily: "var(--font-roboto)",
              opacity: saving ? 0.7 : 1,
            }}
            onMouseEnter={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy)"; }}
          >
            {saving ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}
