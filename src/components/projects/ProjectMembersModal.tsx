"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Trash2, Copy, Check, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { computeInitials } from "@/lib/utils";
import Avatar from "@/components/ui/Avatar";
import { showToast } from "@/components/ui/Toast";

// Fire-and-forget - never throws, never blocks invite creation.
// The copy-link is the guaranteed delivery path; email is best-effort.
function sendInviteEmail(payload: {
  to: string; token: string; inviterName: string; projectName: string;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  fetch(`${supabaseUrl}/functions/v1/send-invite-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${anonKey}`,
    },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((d) => { if (!d.sent) console.info("[invite-email] not sent:", d.reason); })
    .catch((e) => console.warn("[invite-email] edge function unreachable:", e));
}

interface ProjectMember {
  userId: string;
  name: string;
  avatarColor: string;
  avatarInitials: string;
  avatarUrl?: string;
  isLabMember: boolean;
  joinedAt: string;
}

interface PendingInvite {
  id: string;
  invitedEmail: string;
  token: string;
  createdAt: string;
}

const inputStyle: React.CSSProperties = {
  width: "100%", height: 38,
  border: "1px solid var(--color-border)", borderRadius: 7,
  padding: "0 10px", fontSize: 13,
  fontFamily: "var(--font-roboto)",
  backgroundColor: "var(--color-canvas)", color: "var(--color-body)",
  outline: "none", boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700,
  color: "var(--color-secondary)",
  textTransform: "uppercase", letterSpacing: "0.05em",
  marginBottom: 6, display: "block",
};

export default function ProjectMembersModal({
  subProjectId,
  subProjectName,
  labProjectId,
  currentUserId,
  canManage,
  onClose,
}: {
  subProjectId: string;
  subProjectName: string;
  labProjectId: string;
  currentUserId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [labMembersToAdd, setLabMembersToAdd] = useState<ProjectMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailInput, setEmailInput] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const [addError, setAddError] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim());

  const load = useCallback(async () => {
    setLoading(true);

    const [{ data: memberRows }, { data: labRows }] = await Promise.all([
      supabase
        .from("sub_project_members")
        .select("user_id, joined_at, user_profiles(name, avatar_color, avatar_initials, avatar_url)")
        .eq("sub_project_id", subProjectId),
      supabase
        .from("team_members")
        .select("user_id, user_profiles(name, avatar_color, avatar_initials, avatar_url)")
        .eq("project_id", labProjectId),
    ]);

    const labMemberIds = new Set((labRows ?? []).map((r) => r.user_id as string));
    const currentMemberIds = new Set((memberRows ?? []).map((r) => r.user_id as string));

    if (memberRows) {
      setMembers(
        memberRows.map((row) => {
          const p = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
          const profile = p as Record<string, string> | null;
          const name = profile?.name ?? "Unknown";
          return {
            userId: row.user_id as string,
            name,
            avatarColor: profile?.avatar_color ?? "#B4D4E3",
            avatarInitials: computeInitials(name) || (profile?.avatar_initials ?? "??"),
            avatarUrl: profile?.avatar_url ?? undefined,
            isLabMember: labMemberIds.has(row.user_id as string),
            joinedAt: row.joined_at as string,
          };
        })
      );
    }

    // Build list of lab members not yet in this project (for quick-add picker)
    if (labRows) {
      setLabMembersToAdd(
        labRows
          .filter((r) => !currentMemberIds.has(r.user_id as string))
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
              isLabMember: true,
              joinedAt: "",
            };
          })
      );
    }

    if (canManage) {
      const { data: inviteRows } = await supabase
        .from("sub_project_invite_codes")
        .select("id, invited_email, token, created_at")
        .eq("sub_project_id", subProjectId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (inviteRows) {
        setPendingInvites(
          inviteRows.map((r) => ({
            id: r.id as string,
            invitedEmail: r.invited_email as string,
            token: r.token as string,
            createdAt: r.created_at as string,
          }))
        );
      }
    }

    setLoading(false);
  }, [subProjectId, labProjectId, canManage]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleAdd() {
    const email = emailInput.trim().toLowerCase();
    if (!email || !email.includes("@")) { setAddError("Enter a valid email address."); return; }
    setAddError("");
    setAdding(true);

    // Check if email belongs to an existing lab member (can add directly)
    const { data: labUserId } = await supabase.rpc("find_team_member_id_by_email", {
      p_project_id: labProjectId,
      p_email: email,
    });

    if (labUserId) {
      if (members.some((m) => m.userId === labUserId)) {
        setAddError("This person is already a project member.");
        setAdding(false);
        return;
      }
      const { error } = await supabase.from("sub_project_members").insert({
        sub_project_id: subProjectId,
        user_id: labUserId,
        joined_at: new Date().toISOString(),
        invited_by: currentUserId,
      });
      if (error) {
        setAddError("Failed to add member.");
      } else {
        showToast("Member added.", "success");
        setEmailInput("");
        await load();
      }
    } else {
      // Not a lab member - create a pending invite
      if (pendingInvites.some((i) => i.invitedEmail.toLowerCase() === email)) {
        setAddError("An invite is already pending for this email.");
        setAdding(false);
        return;
      }
      if (members.some((m) => m.name.toLowerCase() === email)) {
        setAddError("This person is already a project member.");
        setAdding(false);
        return;
      }
      const token = "PROJ-" + crypto.randomUUID().replace(/-/g, "").substring(0, 8).toUpperCase();
      const { error } = await supabase.from("sub_project_invite_codes").insert({
        token,
        sub_project_id: subProjectId,
        invited_email: email,
        invited_by: currentUserId,
        status: "pending",
      });
      if (error) {
        setAddError("Failed to create invite.");
      } else {
        // Copy-link is the guaranteed fallback - fire email best-effort, never block on it.
        const inviterName = members.find((m) => m.userId === currentUserId)?.name ?? "A collaborator";
        sendInviteEmail({ to: email, token, inviterName, projectName: subProjectName });

        showToast("Invite created. Copy the link below to share.", "success");
        setEmailInput("");
        await load();
      }
    }

    setAdding(false);
  }

  async function addLabMember(userId: string) {
    setAddingUserId(userId);
    const { error } = await supabase.from("sub_project_members").insert({
      sub_project_id: subProjectId,
      user_id: userId,
      joined_at: new Date().toISOString(),
      invited_by: currentUserId,
    });
    if (error) {
      showToast("Failed to add member.", "error");
    } else {
      showToast("Member added.", "success");
      await load();
    }
    setAddingUserId(null);
  }

  async function handleRemove(userId: string) {
    const { error } = await supabase
      .from("sub_project_members")
      .delete()
      .eq("sub_project_id", subProjectId)
      .eq("user_id", userId);
    if (error) {
      showToast("Failed to remove member.", "error");
    } else {
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    }
  }

  async function handleCancelInvite(inviteId: string) {
    await supabase
      .from("sub_project_invite_codes")
      .update({ status: "expired" })
      .eq("id", inviteId);
    setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
  }

  function copyInviteLink(token: string) {
    const link = `${window.location.origin}/login?project_invite=${token}`;
    navigator.clipboard.writeText(link).catch(() => {});
    setCopiedToken(token);
    setTimeout(() => setCopiedToken((prev) => (prev === token ? null : prev)), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: "rgba(27,46,75,0.35)" }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "var(--color-surface)", maxWidth: 520, width: "100%",
          borderRadius: 10, padding: 28,
          boxShadow: "0 8px 40px rgba(27,46,75,0.18)",
          maxHeight: "85dvh", overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "var(--color-navy)", margin: 0 }}>
              Project members
            </h2>
            <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "2px 0 0" }}>
              {subProjectName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-lg hover:bg-[rgba(27,46,75,0.06)] transition-colors"
            style={{ width: 36, height: 36, border: "none", background: "none", cursor: "pointer" }}
            aria-label="Close"
          >
            <X size={16} color="var(--color-secondary)" />
          </button>
        </div>

        {loading ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>Loading…</p>
        ) : (
          <div className="space-y-5">

            {/* Lab members not yet in this project - PI/creator only */}
            {canManage && labMembersToAdd.length > 0 && (
              <div>
                <label style={labelStyle}>Lab members ({labMembersToAdd.length} available to add)</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {labMembersToAdd.map((m) => (
                    <div
                      key={m.userId}
                      className="flex items-center justify-between"
                      style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)" }}
                    >
                      <div className="flex items-center gap-2.5">
                        <Avatar user={{ name: m.name, avatarColor: m.avatarColor, avatarInitials: m.avatarInitials, avatarUrl: m.avatarUrl }} size={26} />
                        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-body)" }}>{m.name}</span>
                      </div>
                      <button
                        onClick={() => addLabMember(m.userId)}
                        disabled={addingUserId === m.userId}
                        style={{
                          height: 30, padding: "0 12px",
                          backgroundColor: "var(--color-navy)", color: "#fff",
                          border: "none", borderRadius: 6,
                          fontSize: 12, fontWeight: 600, cursor: "pointer",
                          opacity: addingUserId === m.userId ? 0.6 : 1,
                          fontFamily: "var(--font-roboto)",
                        }}
                      >
                        {addingUserId === m.userId ? "Adding…" : "Add"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add-by-email - PI/creator only (for external / non-lab collaborators) */}
            {canManage && (
              <div>
                <label style={labelStyle}>Add external collaborator by email</label>
                <div className="flex gap-2">
                  <input
                    value={emailInput}
                    onChange={(e) => { setEmailInput(e.target.value); setAddError(""); if (!e.target.value) setEmailTouched(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                    onBlur={() => setEmailTouched(true)}
                    placeholder="colleague@university.edu"
                    type="email"
                    style={{ ...inputStyle, flex: 1 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
                  />
                  <button
                    onClick={handleAdd}
                    disabled={adding || (emailInput.trim().length > 0 && !emailValid)}
                    className="flex items-center gap-1.5 shrink-0"
                    style={{
                      height: 38, padding: "0 14px",
                      backgroundColor: "var(--color-navy)", color: "#fff",
                      border: "none", borderRadius: 7,
                      fontSize: 13, fontWeight: 600,
                      cursor: (adding || (emailInput.trim().length > 0 && !emailValid)) ? "default" : "pointer",
                      opacity: (adding || (emailInput.trim().length > 0 && !emailValid)) ? 0.5 : 1,
                      fontFamily: "var(--font-roboto)",
                    }}
                  >
                    <UserPlus size={13} />
                    {adding ? "Adding…" : "Add"}
                  </button>
                </div>
                {addError && (
                  <p style={{ fontSize: 12, color: "var(--color-error)", marginTop: 4 }}>{addError}</p>
                )}
                {!addError && emailTouched && emailInput.trim().length > 0 && !emailValid && (
                  <p style={{ fontSize: 12, color: "var(--color-error)", marginTop: 4 }}>Enter a valid email address.</p>
                )}
                <p style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 5 }}>
                  Lab members are added immediately. External collaborators receive an invite link.
                </p>
              </div>
            )}

            {/* Current members */}
            <div>
              <label style={labelStyle}>
                Members ({members.length})
              </label>
              {members.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>No members yet.</p>
              ) : (
                <div className="space-y-2">
                  {members.map((m) => (
                    <div
                      key={m.userId}
                      className="flex items-center justify-between"
                      style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)" }}
                    >
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          user={{ name: m.name, avatarColor: m.avatarColor, avatarInitials: m.avatarInitials, avatarUrl: m.avatarUrl }}
                          size={28}
                        />
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>
                            {m.name}
                          </p>
                          <span
                            style={{
                              fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                              color: m.isLabMember ? "var(--color-navy)" : "#2E7D52",
                              backgroundColor: m.isLabMember ? "rgba(27,46,75,0.08)" : "rgba(46,125,82,0.1)",
                              padding: "1px 6px", borderRadius: 4,
                            }}
                          >
                            {m.isLabMember ? "Lab" : "External"}
                          </span>
                        </div>
                      </div>
                      {canManage && m.userId !== currentUserId && (
                        <button
                          onClick={() => handleRemove(m.userId)}
                          className="flex items-center justify-center rounded hover:bg-[rgba(27,46,75,0.06)] transition-colors"
                          style={{ width: 30, height: 30, border: "none", background: "none", cursor: "pointer" }}
                          aria-label={`Remove ${m.name}`}
                          title="Remove member"
                        >
                          <Trash2 size={13} color="var(--color-secondary)" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pending invites - PI/creator only */}
            {canManage && pendingInvites.length > 0 && (
              <div>
                <label style={labelStyle}>Pending invites ({pendingInvites.length})</label>
                <div className="space-y-2">
                  {pendingInvites.map((inv) => (
                    <div
                      key={inv.id}
                      style={{
                        padding: "10px 12px", borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        backgroundColor: "var(--color-canvas)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>
                            {inv.invitedEmail}
                          </p>
                          <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>
                            Pending invite
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => copyInviteLink(inv.token)}
                            className="flex items-center gap-1.5"
                            style={{
                              height: 30, padding: "0 10px",
                              backgroundColor: copiedToken === inv.token ? "rgba(46,125,82,0.08)" : "#fff",
                              border: "1px solid var(--color-border)", borderRadius: 6,
                              fontSize: 11, fontWeight: 600, cursor: "pointer",
                              color: copiedToken === inv.token ? "#2E7D52" : "var(--color-navy)",
                              fontFamily: "var(--font-roboto)",
                            }}
                          >
                            {copiedToken === inv.token
                              ? <><Check size={10} /> Copied!</>
                              : <><Copy size={10} /> Copy link</>}
                          </button>
                          <button
                            onClick={() => handleCancelInvite(inv.id)}
                            className="flex items-center justify-center rounded hover:bg-[rgba(27,46,75,0.06)] transition-colors"
                            style={{ width: 30, height: 30, border: "none", background: "none", cursor: "pointer" }}
                            aria-label="Cancel invite"
                            title="Cancel invite"
                          >
                            <X size={12} color="var(--color-secondary)" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
