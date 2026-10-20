"use client";

import type { UserProfileRecord, ProjectRecord } from "@/types/database-records";

import { useState, useEffect, useCallback } from "react";
import { APP_NAME } from "@/lib/brand";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Copy, Check, RefreshCw, User, Lock, Bell, Building2, Clock, Monitor, Moon, Sun, Keyboard, BellOff, Plus, Pencil, Trash2, X, ChevronDown, Compass, Globe2, HeartPulse } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { showToast } from "@/components/ui/Toast";
import { useTheme } from "@/context/ThemeContext";
import type { WorkingHours, LabRole, PromptCategory } from "@/types";
import { WorkingHoursEditor, DEFAULT_WORKING_HOURS } from "@/components/ui/WorkingHoursEditor";
import { JOURNAL_PROMPTS, ACTIVE_PROMPT_IDS } from "@/lib/mock-data";
import { useProject } from "@/context/ProjectContext";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, toUserRole } from "@/lib/permissions";
import DepartmentsManager from "@/components/lc/DepartmentsManager";
import McLinkSettings from "@/components/lc/McLinkSettings";
import GoogleCalendarSettings from "@/components/scheduling/GoogleCalendarSettings";
import WellbeingSettings from "@/components/wellbeing/WellbeingSettings";
import CategoriesManager from "@/components/finance/CategoriesManager";
import type { UserRole } from "@/types";

const PROMPT_CATEGORY_LABELS: Record<PromptCategory, string> = {
  emotional_processing: "Emotional Processing",
  purpose_growth: "Purpose & Growth",
  team_support: "Team & Support",
  boundaries_workload: "Boundaries & Workload",
  looking_forward: "Looking Forward",
};

const sectionStyle: React.CSSProperties = {
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  overflow: "hidden",
  marginBottom: 16,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "16px 20px",
  borderBottom: "1px solid var(--color-border)",
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-roboto)",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--color-body)",
  marginBottom: 4,
  display: "block",
};

const readonlyInputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: 40,
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  padding: "0 12px",
  fontFamily: "var(--font-roboto)",
  fontSize: 14,
  color: "var(--color-body)",
  backgroundColor: "var(--color-canvas)",
  outline: "none",
  boxSizing: "border-box",
  cursor: "default",
};

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { activeScope, projectId: activeLcId, role: myRole } = useProject();
  const isPresident = myRole === "president";
  const [profile, setProfile] = useState<UserProfileRecord | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [inviteCodes, setInviteCodes] = useState<{ id: string; code: string; used_by: string | null; lab_role_id: string | null; invited_email: string | null; email_sent_at: string | null }[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [revealedCode, setRevealedCode] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [loading, setLoading] = useState(true);

  // Role titles management
  const [labRoles, setLabRoles] = useState<LabRole[]>([]);
  const [myLabRoleName, setMyLabRoleName] = useState<string | null>(null);
  const [newInviteRoleId, setNewInviteRoleId] = useState<string>("");
  // Email invite flow
  const [emailInviteInput, setEmailInviteInput] = useState("");
  const [emailInviteRoleId, setEmailInviteRoleId] = useState<string>("");
  const [emailInviteError, setEmailInviteError] = useState("");
  const [sendingEmailInvites, setSendingEmailInvites] = useState(false);
  const [copiedEmailCode, setCopiedEmailCode] = useState<string | null>(null);
  const [showAdvancedInvites, setShowAdvancedInvites] = useState(false);
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleLevel, setNewRoleLevel] = useState<Exclude<UserRole, "president">>("member");
  const [renamingRoleId, setRenamingRoleId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Notification preferences
  const [notifTaskAssigned, setNotifTaskAssigned] = useState(true);
  const [notifLabWin, setNotifLabWin] = useState(true);
  const [notifDigest, setNotifDigest] = useState(false);
  const [emailMode, setEmailMode] = useState<"all" | "digest" | "important">("all");
  const [isMobile, setIsMobile] = useState(false);

  // Working hours + timezone
  const [timezone, setTimezone] = useState("America/New_York");
  const [workingHours, setWorkingHours] = useState<WorkingHours>(DEFAULT_WORKING_HOURS);
  const [savingSchedule, setSavingSchedule] = useState(false);

  // LC settings (president only)
  const [projectName, setProjectName] = useState("");
  const [projectInstitution, setProjectInstitution] = useState("");
  const [lcCurrency, setLcCurrency] = useState("EUR");
  const [senderName, setSenderName] = useState("");
  const [termStart, setTermStart] = useState("");
  const [activePromptIds, setActivePromptIds] = useState<string[]>(ACTIVE_PROMPT_IDS);
  const [customPrompts, setCustomPrompts] = useState<{ id: string; text: string }[]>([]);
  const [customPromptInput, setCustomPromptInput] = useState("");
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [savingLabSettings, setSavingLabSettings] = useState(false);

  // DND / quiet hours
  const [dndEnabled, setDndEnabled]               = useState(false);
  const [quietHoursStart, setQuietHoursStart]     = useState("22:00");
  const [quietHoursEnd, setQuietHoursEnd]         = useState("08:00");
  const [savingDnd, setSavingDnd]                 = useState(false);

  useEffect(() => {
    function checkWidth() { setIsMobile(window.innerWidth < 600); }
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user ?? null;
        if (!user) { router.replace("/login"); return; }

        const { data: prof } = await supabase
          .from("user_profiles").select("*").eq("id", user.id).maybeSingle();
        setProfile(prof ? { ...prof, email: user.email } : { email: user.email });

        const membership = activeLcId ? { project_id: activeLcId } : null;

        if (membership?.project_id) {
          const { data: proj } = await supabase
            .from("projects").select("*").eq("id", membership.project_id).maybeSingle();
          setProject(proj);
          if (proj) {
            setProjectName((proj.name as string) ?? "");
            setProjectInstitution((proj.institution as string) ?? "");
            setSenderName((proj.email_sender_name as string | null) ?? "");
            setLcCurrency((proj.currency as string) ?? "EUR");
            setTermStart((proj.term_start_date as string) ?? "");
            const loadedIds = proj.active_prompt_ids as string[] | null | undefined;
            if (Array.isArray(loadedIds)) {
              // NULL/undefined = not yet set; keep defaults. [] = president chose none.
              setActivePromptIds(loadedIds);
            }
            if (proj.custom_prompts) setCustomPrompts(proj.custom_prompts as { id: string; text: string }[]);
          }

          // Load working hours + timezone
          const { data: userSettings } = await supabase
            .from("user_settings").select("*").eq("user_id", user.id).maybeSingle();
          if (userSettings) {
            setTimezone((userSettings.timezone as string) ?? "America/New_York");
            setWorkingHours((userSettings.working_hours as WorkingHours) ?? DEFAULT_WORKING_HOURS);
            setDndEnabled((userSettings.dnd_enabled as boolean) ?? false);
            setQuietHoursStart((userSettings.quiet_hours_start as string) ?? "22:00");
            setQuietHoursEnd((userSettings.quiet_hours_end as string) ?? "08:00");
            if (userSettings.notif_task_assigned != null) setNotifTaskAssigned(userSettings.notif_task_assigned as boolean);
            if (userSettings.notif_lab_win != null) setNotifLabWin(userSettings.notif_lab_win as boolean);
            if (userSettings.notif_digest != null) setNotifDigest(userSettings.notif_digest as boolean);
            if (userSettings.email_mode) setEmailMode(userSettings.email_mode as typeof emailMode);
          }

          // Fetch current user's role title in this LC for the Profile section
          const { data: memberRow } = await supabase
            .from("team_members")
            .select("lab_role_id")
            .eq("user_id", user.id)
            .eq("project_id", membership.project_id)
            .maybeSingle();
          if (memberRow?.lab_role_id) {
            const { data: roleRow } = await supabase
              .from("lab_roles")
              .select("name")
              .eq("id", memberRow.lab_role_id as string)
              .maybeSingle();
            if (roleRow?.name) setMyLabRoleName(roleRow.name as string);
          }

          if (isPresident) {
            const [{ data: codes }, { data: roles }] = await Promise.all([
              supabase
                .from("invite_codes")
                .select("id, code, used_by, lab_role_id, invited_email, email_sent_at")
                .eq("project_id", membership.project_id)
                .order("created_at", { ascending: false }),
              supabase
                .from("lab_roles")
                .select("id, name, permission_level, is_system, created_at")
                .eq("project_id", membership.project_id)
                .order("is_system", { ascending: false })
                .order("name"),
            ]);
            if (codes) setInviteCodes(codes as typeof inviteCodes);
            if (roles) {
              setLabRoles(roles.map((r: { id: string; name: string; permission_level: string; is_system: boolean; created_at: string }) => ({
                id: r.id,
                projectId: membership.project_id,
                name: r.name,
                permissionLevel: toUserRole(r.permission_level),
                isSystem: r.is_system,
                createdAt: r.created_at,
              })));
              // Default invite role to "Member" by name, fallback to first member-level role
              const defaultRole =
                roles.find((r: { name: string }) => r.name === "Member") ??
                roles.find((r: { permission_level: string }) => r.permission_level === "member");
              if (defaultRole) {
                setNewInviteRoleId(defaultRole.id);
                setEmailInviteRoleId(defaultRole.id);
              }
            }
          }
        }
      } catch (err) {
        console.error("[Settings] load error:", err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLcId, isPresident]);

  const handleCopyCode = useCallback(async (code: string) => {
    const link = `${window.location.origin}/login?invite=${code}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopiedCode(code);
    setTimeout(() => setCopiedCode((prev) => (prev === code ? null : prev)), 2000);
    showToast("Invite link copied!");
  }, []);

  const handleGenerateCode = useCallback(async () => {
    if (!project?.id) return;
    setGeneratingCode(true);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) { setGeneratingCode(false); return; }
    const code = "LC-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data } = await supabase
      .from("invite_codes")
      .insert({ code, project_id: project.id, created_by: user.id, lab_role_id: newInviteRoleId || null })
      .select("id, code, used_by, lab_role_id")
      .single();
    if (data) setInviteCodes((prev) => [data as (typeof inviteCodes)[0], ...prev]);
    setGeneratingCode(false);
  }, [project, newInviteRoleId]);

  const handleSaveLabSettings = useCallback(async () => {
    if (!project?.id) return;
    setSavingLabSettings(true);
    try {
      const { error } = await supabase.from("projects").update({
        name: projectName,
        institution: projectInstitution,
        currency: lcCurrency.trim().toUpperCase(),
        term_start_date: termStart || null,
        email_sender_name: senderName.trim() || null,
        active_prompt_ids: activePromptIds,
        custom_prompts: customPrompts,
      }).eq("id", project.id);
      if (error) throw new Error(error.message);
      showToast("LC settings saved.");
    } catch (e) {
      showToast("Failed to save: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setSavingLabSettings(false);
    }
  }, [project, projectName, projectInstitution, lcCurrency, senderName, termStart, activePromptIds, customPrompts]);

  const handleSendEmailInvites = useCallback(async () => {
    if (!project?.id) return;
    const rawEmails = emailInviteInput
      .split(/[\n,]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const valid = rawEmails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    const invalid = rawEmails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (invalid.length > 0) {
      setEmailInviteError(`Invalid email${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}`);
      return;
    }
    if (valid.length === 0) { setEmailInviteError("Enter at least one email address."); return; }
    setEmailInviteError("");
    setSendingEmailInvites(true);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) { setSendingEmailInvites(false); return; }

    const newCodes: (typeof inviteCodes)[0][] = [];
    for (const email of valid) {
      const code = "LC-" + Math.random().toString(36).substring(2, 8).toUpperCase();
      const { data: inserted, error } = await supabase.from("invite_codes").insert({
        code, project_id: project.id, created_by: user.id,
        invited_email: email,
        lab_role_id: emailInviteRoleId || null,
      }).select("id, code, used_by, lab_role_id, invited_email, email_sent_at").single();
      if (!error && inserted) newCodes.push(inserted as (typeof inviteCodes)[0]);
    }
    if (newCodes.length > 0) {
      setInviteCodes((prev) => [...newCodes, ...prev]);
      const token = session?.access_token;
      if (token) {
        fetch("/api/invite/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ inviteIds: newCodes.map(c => c.id) }),
        }).then(async (r) => {
          const data = await r.json().catch(() => ({})) as { ok: boolean; error?: string; results?: { id: string; ok: boolean }[] };
          if (!r.ok) {
            showToast(data.error ?? "Invites created but email delivery failed.", "error");
          } else if (data.ok || data.results?.some(res => res.ok)) {
            showToast("Invites sent!");
            const sentIds = new Set((data.results ?? []).filter(res => res.ok).map(res => res.id));
            const sentAt = new Date().toISOString();
            setInviteCodes(prev => prev.map(ic => sentIds.has(ic.id) ? { ...ic, email_sent_at: sentAt } : ic));
          } else {
            showToast(data.error ?? "Invites created but email delivery failed.", "error");
          }
        }).catch(() => showToast("Invites created but email delivery failed.", "error"));
      }
    }
    setEmailInviteInput("");
    setSendingEmailInvites(false);
  }, [project, emailInviteInput, emailInviteRoleId]);

  const handleCopyEmailCode = useCallback(async (code: string) => {
    const link = `${window.location.origin}/login?invite=${code}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopiedEmailCode(code);
    setTimeout(() => setCopiedEmailCode((prev) => (prev === code ? null : prev)), 2000);
  }, []);

  const handleRevokeInvite = useCallback(async (id: string) => {
    await supabase.from("invite_codes").delete().eq("id", id);
    setInviteCodes((prev) => prev.filter((ic) => ic.id !== id));
    showToast("Invite revoked.");
  }, []);

  const handlePasswordReset = useCallback(async () => {
    if (!profile?.email) return;
    if (!isSupabaseConfigured) {
      showToast("Password reset is not available in demo mode.");
      return;
    }
    await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: window.location.origin + "/reset-password",
    });
    showToast("Password reset email sent. Check your inbox.");
  }, [profile]);

  const handleSaveSchedule = useCallback(async () => {
    if (!isSupabaseConfigured) { showToast("Demo mode - settings not persisted."); return; }
    setSavingSchedule(true);
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) { setSavingSchedule(false); return; }
    const { error } = await supabase.from("user_settings").upsert(
      { user_id: userId, timezone, working_hours: workingHours, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    setSavingSchedule(false);
    if (error) { showToast("Failed to save. " + error.message); }
    else { showToast("Schedule settings saved."); }
  }, [timezone, workingHours]);

  const handleSaveDnd = useCallback(async () => {
    if (!isSupabaseConfigured) { showToast("Demo mode -- settings not persisted."); return; }
    setSavingDnd(true);
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) { setSavingDnd(false); return; }
    const { error } = await supabase.from("user_settings").upsert(
      { user_id: userId, dnd_enabled: dndEnabled, quiet_hours_start: quietHoursStart, quiet_hours_end: quietHoursEnd, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    setSavingDnd(false);
    if (error) { showToast("Failed to save. " + error.message); }
    else { showToast("Focus settings saved."); }
  }, [dndEnabled, quietHoursStart, quietHoursEnd]);

  const handleSaveNotifications = useCallback(async () => {
    if (!isSupabaseConfigured) { showToast("Demo mode - settings not persisted."); return; }
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    const { error } = await supabase.from("user_settings").upsert(
      { user_id: userId, notif_task_assigned: notifTaskAssigned, notif_lab_win: notifLabWin, notif_digest: notifDigest, email_mode: emailMode, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (error) showToast("Failed to save: " + error.message);
    else showToast("Notification preferences saved.");
  }, [notifTaskAssigned, notifLabWin, notifDigest, emailMode]);

  if (loading) return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px" }} className="space-y-6">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} style={{ borderRadius: 10, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", padding: "20px 24px" }}>
          <div style={{ height: 14, width: "30%", backgroundColor: "var(--color-border)", borderRadius: 4, marginBottom: 16 }} className="animate-pulse" />
          <div style={{ height: 11, width: "75%", backgroundColor: "var(--color-border)", borderRadius: 4, marginBottom: 10 }} className="animate-pulse" />
          <div style={{ height: 36, width: "55%", backgroundColor: "var(--color-border)", borderRadius: 6 }} className="animate-pulse" />
        </div>
      ))}
    </div>
  );

  return (
    <>
    <div style={{ maxWidth: 640, margin: "0 auto", padding: isMobile ? "16px" : "32px 20px", fontFamily: "var(--font-roboto)" }}>
      <h1 style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 22, color: "var(--color-navy)", margin: "0 0 24px" }}>
        Settings
      </h1>

      {/* Profile section */}
      <section style={sectionStyle} aria-labelledby="settings-profile-heading">
        <div style={sectionHeaderStyle}>
          <User size={16} color="var(--color-secondary)" />
          <h2 id="settings-profile-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
            Profile
          </h2>
        </div>
        <div style={{ padding: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Display name</label>
              <input readOnly value={profile?.name ?? ""} style={readonlyInputStyle} aria-label="Display name (read-only)" />
            </div>
            <div>
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 5 }}>
                Role <Lock size={10} color="var(--color-secondary)" style={{ opacity: 0.7 }} />
              </label>
              <input
                readOnly
                value={myLabRoleName ?? (myRole ? ROLE_DESCRIPTIONS[myRole] : "")}
                style={{ ...readonlyInputStyle, backgroundColor: "var(--color-canvas)", opacity: 0.75, cursor: "not-allowed" }}
                aria-label="Role (read-only)"
              />
              <p style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 4, marginBottom: 0 }}>
                {isPresident ? "You are the President (LCP) of this Local Committee." : "Ask your LCP to change your role or department."}
              </p>
            </div>
          </div>
          {profile?.bio && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Bio</label>
              <input readOnly value={profile.bio} style={readonlyInputStyle} aria-label="Bio (read-only)" />
            </div>
          )}
          <button
            onClick={() => router.push("/profile")}
            style={{ minHeight: 44, height: 38, padding: "0 16px", backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-btn-primary-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-btn-primary)"; }}
          >
            Edit profile
          </button>
        </div>
      </section>

      {/* Account section */}
      <section style={sectionStyle} aria-labelledby="settings-account-heading">
        <div style={sectionHeaderStyle}>
          <Lock size={16} color="var(--color-secondary)" />
          <h2 id="settings-account-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
            Account
          </h2>
        </div>
        <div style={{ padding: "20px" }}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Email</label>
            <input readOnly value={profile?.email ?? ""} style={readonlyInputStyle} aria-label="Email address (read-only)" />
          </div>
          <button
            onClick={handlePasswordReset}
            style={{ minHeight: 44, height: "auto", padding: "10px 16px", backgroundColor: "transparent", color: "var(--color-navy)", border: "1px solid var(--color-border)", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: isMobile ? "normal" : "nowrap" }}
          >
            Send password reset email
          </button>
        </div>
      </section>

      {/* LC & invites — president only, hidden in Personal workspace */}
      {isPresident && activeScope !== "personal" && (
        <section id="invite" style={sectionStyle} aria-labelledby="settings-invite-heading">
          <div style={sectionHeaderStyle}>
            <Building2 size={16} color="var(--color-secondary)" />
            <h2 id="settings-invite-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
              LC members &amp; invites
            </h2>
          </div>
          <div style={{ padding: "20px" }}>

            {/* Role management */}
            {labRoles.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <p style={{ ...labelStyle, marginBottom: 10 }}>Role titles</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {labRoles.map((role) => (
                    <div key={role.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {renamingRoleId === role.id ? (
                        <>
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === "Enter" && renameValue.trim()) {
                                await supabase.from("lab_roles").update({ name: renameValue.trim() }).eq("id", role.id);
                                setLabRoles((prev) => prev.map((r) => r.id === role.id ? { ...r, name: renameValue.trim() } : r));
                                setRenamingRoleId(null);
                              } else if (e.key === "Escape") {
                                setRenamingRoleId(null);
                              }
                            }}
                            style={{ flex: 1, height: 34, border: "1px solid var(--color-navy)", borderRadius: 6, padding: "0 10px", fontSize: 13, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-canvas)", color: "var(--color-body)", outline: "none" }}
                          />
                          <button
                            onClick={async () => {
                              if (!renameValue.trim()) return;
                              await supabase.from("lab_roles").update({ name: renameValue.trim() }).eq("id", role.id);
                              setLabRoles((prev) => prev.map((r) => r.id === role.id ? { ...r, name: renameValue.trim() } : r));
                              setRenamingRoleId(null);
                            }}
                            style={{ height: 34, padding: "0 12px", backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                          >Save</button>
                          <button
                            onClick={() => setRenamingRoleId(null)}
                            style={{ height: 34, width: 34, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", border: "1px solid var(--color-border)", borderRadius: 6, cursor: "pointer" }}
                          ><X size={13} color="var(--color-secondary)" /></button>
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontSize: 13, color: "var(--color-body)" }}>
                            {role.name}
                            <span style={{ marginLeft: 8, fontSize: 11, color: "var(--color-secondary)" }}>
                              ({ROLE_LABELS[role.permissionLevel]} access)
                            </span>
                          </span>
                          {!role.isSystem && (
                            <>
                              <button
                                onClick={() => { setRenamingRoleId(role.id); setRenameValue(role.name); }}
                                style={{ height: 30, width: 30, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", border: "1px solid var(--color-border)", borderRadius: 6, cursor: "pointer" }}
                                aria-label={`Rename role ${role.name}`}
                              ><Pencil size={12} color="var(--color-secondary)" /></button>
                              <button
                                onClick={async () => {
                                  await supabase.from("lab_roles").delete().eq("id", role.id);
                                  setLabRoles((prev) => prev.filter((r) => r.id !== role.id));
                                  if (newInviteRoleId === role.id) setNewInviteRoleId("");
                                }}
                                style={{ height: 30, width: 30, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", border: "1px solid var(--color-border)", borderRadius: 6, cursor: "pointer" }}
                                aria-label={`Delete role ${role.name}`}
                              ><Trash2 size={12} color="var(--color-secondary)" /></button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add custom role */}
                {addingRole ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <input
                      autoFocus
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      placeholder="Title (e.g. Team Leader)"
                      onKeyDown={async (e) => {
                        if (e.key === "Escape") { setAddingRole(false); setNewRoleName(""); }
                      }}
                      style={{ flex: 1, height: 34, border: "1px solid var(--color-border)", borderRadius: 6, padding: "0 10px", fontSize: 13, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-canvas)", color: "var(--color-body)", outline: "none" }}
                    />
                    <select
                      value={newRoleLevel}
                      onChange={(e) => setNewRoleLevel(e.target.value as Exclude<UserRole, "president">)}
                      aria-label="Access level for the new title"
                      style={{ height: 34, border: "1px solid var(--color-border)", borderRadius: 6, padding: "0 8px", fontSize: 13, backgroundColor: "var(--color-canvas)", color: "var(--color-body)" }}
                    >
                      <option value="member">Member access</option>
                      <option value="vp">VP access</option>
                    </select>
                    <button
                      onClick={async () => {
                        if (!newRoleName.trim() || !project?.id) return;
                        const { data: newRole } = await supabase
                          .from("lab_roles")
                          .insert({ project_id: project.id, name: newRoleName.trim(), permission_level: newRoleLevel, is_system: false })
                          .select("id, name, permission_level, is_system, created_at")
                          .single();
                        if (newRole) {
                          setLabRoles((prev) => [...prev, { id: newRole.id, projectId: project.id, name: newRole.name, permissionLevel: toUserRole(newRole.permission_level), isSystem: newRole.is_system, createdAt: newRole.created_at }]);
                        }
                        setAddingRole(false);
                        setNewRoleName("");
                      }}
                      style={{ height: 34, padding: "0 14px", backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    >Add</button>
                    <button
                      onClick={() => { setAddingRole(false); setNewRoleName(""); }}
                      style={{ height: 34, width: 34, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", border: "1px solid var(--color-border)", borderRadius: 6, cursor: "pointer" }}
                    ><X size={13} color="var(--color-secondary)" /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingRole(true)}
                    style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-navy)", backgroundColor: "transparent", border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-roboto)", fontWeight: 600 }}
                  >
                    <Plus size={13} />
                    Add custom title
                  </button>
                )}
              </div>
            )}

            {/* Email invite form */}
            <div style={{ marginBottom: 24 }}>
              <p style={{ ...labelStyle, marginBottom: 6 }}>Invite by email</p>
              <p style={{ fontSize: 12, color: "var(--color-secondary)", marginBottom: 12, marginTop: 0 }}>
                Enter one or more email addresses. Each person gets a unique invite link tied to their address.
              </p>
              <textarea
                value={emailInviteInput}
                onChange={(e) => { setEmailInviteInput(e.target.value); setEmailInviteError(""); }}
                placeholder={"new.member@aiesec.net\nanother@example.com"}
                rows={3}
                style={{
                  display: "block", width: "100%", padding: "10px 12px", boxSizing: "border-box",
                  fontSize: 13, fontFamily: "var(--font-roboto)", color: "var(--color-body)",
                  backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)",
                  borderRadius: 8, resize: "vertical", outline: "none", lineHeight: 1.5,
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
              />
              {emailInviteError && (
                <p style={{ fontSize: 12, color: "var(--color-error, #dc2626)", margin: "4px 0 0" }}>{emailInviteError}</p>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                {labRoles.length > 0 && (
                  <div style={{ position: "relative" }}>
                    <select
                      value={emailInviteRoleId}
                      onChange={(e) => setEmailInviteRoleId(e.target.value)}
                      style={{ height: 36, border: "1px solid var(--color-border)", borderRadius: 8, padding: "0 28px 0 12px", fontSize: 13, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-canvas)", color: "var(--color-body)", outline: "none", cursor: "pointer", appearance: "none" }}
                      aria-label="Role for email invites"
                    >
                      {labRoles.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={13} color="var(--color-secondary)" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                  </div>
                )}
                <button
                  onClick={handleSendEmailInvites}
                  disabled={sendingEmailInvites || !emailInviteInput.trim()}
                  style={{ minHeight: 36, height: 36, padding: "0 16px", display: "flex", alignItems: "center", gap: 6, backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, cursor: sendingEmailInvites || !emailInviteInput.trim() ? "default" : "pointer", opacity: sendingEmailInvites || !emailInviteInput.trim() ? 0.6 : 1 }}
                >
                  {sendingEmailInvites ? "Sending…" : "Send invites"}
                </button>
              </div>
            </div>

            {/* Pending invites list */}
            {inviteCodes.filter(ic => ic.invited_email).length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <p style={{ ...labelStyle, marginBottom: 10 }}>Pending invites</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {inviteCodes.filter(ic => ic.invited_email).map((ic) => {
                    const roleName = ic.lab_role_id ? labRoles.find((r) => r.id === ic.lab_role_id)?.name : null;
                    return (
                      <div key={ic.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, color: "var(--color-body)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ic.invited_email}</span>
                        {roleName && (
                          <span style={{ fontSize: 11, color: "var(--color-secondary)", border: "1px solid var(--color-border)", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>{roleName}</span>
                        )}
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: ic.used_by ? "var(--color-secondary)" : "#2E7D52" }} />
                          <span style={{ fontSize: 11, color: ic.used_by ? "var(--color-secondary)" : "#2E7D52" }}>{ic.used_by ? "Accepted" : "Pending"}</span>
                        </span>
                        <button
                          onClick={() => handleCopyEmailCode(ic.code)}
                          style={{ height: 30, padding: "0 10px", display: "flex", alignItems: "center", gap: 5, backgroundColor: "transparent", border: "1px solid var(--color-border)", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, color: copiedEmailCode === ic.code ? "#2E7D52" : "var(--color-navy)", flexShrink: 0, fontFamily: "var(--font-roboto)", whiteSpace: "nowrap" }}
                        >
                          {copiedEmailCode === ic.code ? <Check size={12} color="#2E7D52" /> : <Copy size={12} />}
                          {copiedEmailCode === ic.code ? "Copied" : "Copy link"}
                        </button>
                        {!ic.used_by && (
                          <button
                            onClick={() => handleRevokeInvite(ic.id)}
                            style={{ height: 30, width: 30, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", border: "1px solid var(--color-border)", borderRadius: 6, cursor: "pointer", flexShrink: 0 }}
                            aria-label={`Revoke invite for ${ic.invited_email}`}
                          >
                            <X size={12} color="var(--color-secondary)" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Advanced: generic invite codes */}
            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
              <button
                onClick={() => setShowAdvancedInvites(v => !v)}
                style={{ display: "flex", alignItems: "center", gap: 6, backgroundColor: "transparent", border: "none", cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", fontFamily: "var(--font-roboto)" }}
              >
                <ChevronDown size={13} style={{ transform: showAdvancedInvites ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
                Advanced
              </button>
              {showAdvancedInvites && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 12, color: "var(--color-secondary)", marginTop: 0, marginBottom: 12 }}>
                    Generic links let anyone who has the URL join your LC without email verification. Use with caution.
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {inviteCodes.filter(ic => !ic.invited_email).map((ic) => {
                      const fullLink = `${typeof window !== "undefined" ? window.location.origin : ""}/login?invite=${ic.code}`;
                      const isRevealed = revealedCode === ic.id;
                      const roleName = ic.lab_role_id ? labRoles.find((r) => r.id === ic.lab_role_id)?.name : null;
                      return (
                        <div key={ic.id} style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: 8 }}>
                          <input
                            readOnly
                            value={isRevealed ? fullLink : `${process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== "undefined" ? window.location.origin : "")}/login?invite=••••••••`}
                            style={{ ...readonlyInputStyle, flex: 1, fontFamily: "monospace", fontSize: 12 }}
                            aria-label={`Generic invite link ${ic.code}`}
                          />
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 84, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", borderRadius: 5, padding: "2px 8px", backgroundColor: roleName ? "rgba(2,99,196,0.08)" : "transparent", color: roleName ? "var(--color-navy)" : "var(--color-secondary)" }}>
                              {roleName ?? "No role"}
                            </span>
                            <button onClick={() => setRevealedCode(isRevealed ? null : ic.id)}
                              style={{ height: 34, padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", borderRadius: 7, cursor: "pointer", fontSize: 12, fontFamily: "var(--font-roboto)", fontWeight: 500, color: "var(--color-body)", whiteSpace: "nowrap" }}
                              aria-label={isRevealed ? "Hide invite link" : "Reveal invite link"}>
                              {isRevealed ? "Hide" : "Reveal"}
                            </button>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 52, whiteSpace: "nowrap" }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, backgroundColor: ic.used_by ? "var(--color-secondary)" : "#2E7D52" }} />
                              <span style={{ fontSize: 11, fontWeight: 500, color: ic.used_by ? "var(--color-secondary)" : "#2E7D52" }}>{ic.used_by ? "Used" : "Active"}</span>
                            </span>
                            <button onClick={() => handleCopyCode(ic.code)}
                              style={{ height: 34, width: 36, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", borderRadius: 7, cursor: "pointer", flexShrink: 0 }}
                              aria-label={`Copy invite link ${ic.code}`}>
                              {copiedCode === ic.code ? <Check size={13} color="#2E7D52" /> : <Copy size={13} color="var(--color-secondary)" />}
                            </button>
                            {!ic.used_by && (
                              <button onClick={() => handleRevokeInvite(ic.id)}
                                style={{ height: 34, width: 34, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", border: "1px solid var(--color-border)", borderRadius: 7, cursor: "pointer", flexShrink: 0 }}
                                aria-label={`Revoke invite ${ic.code}`}>
                                <X size={12} color="var(--color-secondary)" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {inviteCodes.filter(ic => !ic.invited_email).length === 0 && (
                      <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>No generic invite codes yet.</p>
                    )}
                  </div>
                  <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {labRoles.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "var(--color-secondary)", whiteSpace: "nowrap" }}>Role:</span>
                        <div style={{ position: "relative" }}>
                          <select value={newInviteRoleId} onChange={(e) => setNewInviteRoleId(e.target.value)}
                            style={{ height: 38, border: "1px solid var(--color-border)", borderRadius: 8, padding: "0 28px 0 12px", fontSize: 13, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-canvas)", color: "var(--color-body)", outline: "none", cursor: "pointer", appearance: "none" }}
                            aria-label="Role for new generic invite">
                            {labRoles.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                          <ChevronDown size={13} color="var(--color-secondary)" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                        </div>
                      </div>
                    )}
                    <button onClick={handleGenerateCode} disabled={generatingCode}
                      style={{ minHeight: 44, height: 38, padding: "0 16px", display: "flex", alignItems: "center", gap: 6, backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                      <RefreshCw size={13} />
                      {generatingCode ? "Generating…" : "Generate generic invite"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Departments — president only */}
      {isPresident && activeScope !== "personal" && (
        <section id="departments" style={sectionStyle} aria-labelledby="settings-departments-heading">
          <div style={sectionHeaderStyle}>
            <Building2 size={16} color="var(--color-secondary)" />
            <h2 id="settings-departments-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
              Departments
            </h2>
          </div>
          <div style={{ padding: "20px" }}>
            <DepartmentsManager />
          </div>
        </section>
      )}

      {/* National (MC) — president only */}
      {isPresident && activeScope !== "personal" && (
        <section id="national" style={sectionStyle} aria-labelledby="settings-national-heading">
          <div style={sectionHeaderStyle}>
            <Globe2 size={16} color="var(--color-secondary)" />
            <h2 id="settings-national-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
              National (MC)
            </h2>
          </div>
          <div style={{ padding: "20px" }}>
            <McLinkSettings />
          </div>
        </section>
      )}

      {/* Wellbeing — president only */}
      {isPresident && activeScope !== "personal" && activeLcId && (
        <section style={sectionStyle} aria-labelledby="settings-wellbeing-heading">
          <div style={sectionHeaderStyle}>
            <HeartPulse size={16} color="var(--color-secondary)" />
            <h2 id="settings-wellbeing-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
              Wellbeing &amp; privacy
            </h2>
          </div>
          <div style={{ padding: "20px" }}>
            <WellbeingSettings projectId={activeLcId} />
          </div>
        </section>
      )}

      {/* LC settings section (president only, hidden in Personal workspace) */}
      {isPresident && activeScope !== "personal" && (
        <section style={sectionStyle} aria-labelledby="settings-lc-heading">
          <div style={sectionHeaderStyle}>
            <Globe2 size={16} color="var(--color-secondary)" />
            <h2 id="settings-lc-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
              LC settings
            </h2>
          </div>
          <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label style={labelStyle}>Local Committee name</label>
              <input value={projectName} onChange={e => setProjectName(e.target.value)}
                placeholder="e.g. AIESEC in Lisbon"
                style={{ ...readonlyInputStyle, cursor: "text", backgroundColor: "var(--color-surface)" }} />
            </div>
            <div>
              <label style={labelStyle}>University or city</label>
              <input value={projectInstitution} onChange={e => setProjectInstitution(e.target.value)}
                placeholder="e.g. University of Lisbon"
                style={{ ...readonlyInputStyle, cursor: "text", backgroundColor: "var(--color-surface)" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
              <div>
                <label style={labelStyle} htmlFor="lc-currency">Currency</label>
                <input id="lc-currency" value={lcCurrency} maxLength={3} onChange={e => setLcCurrency(e.target.value.toUpperCase())}
                  placeholder="EUR" style={{ ...readonlyInputStyle, cursor: "text", backgroundColor: "var(--color-surface)" }} />
                <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "4px 0 0" }}>3-letter code used for new finance entries and claims.</p>
              </div>
              <div>
                <label style={labelStyle} htmlFor="lc-sender-name">Email sender name</label>
                <input id="lc-sender-name" value={senderName} maxLength={60} onChange={e => setSenderName(e.target.value)}
                  placeholder={projectName || "AIESEC at Northwestern"} style={{ ...readonlyInputStyle, cursor: "text", backgroundColor: "var(--color-surface)" }} />
                <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "4px 0 0" }}>Emails to members come from this name. Replies go to whoever sent them.</p>
              </div>
              <div>
                <label style={labelStyle} htmlFor="lc-term-start">Term starts on</label>
                <input id="lc-term-start" type="date" value={termStart} onChange={e => setTermStart(e.target.value)}
                  style={{ ...readonlyInputStyle, cursor: "text", backgroundColor: "var(--color-surface)" }} />
                <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "4px 0 0" }}>Used for &ldquo;this term&rdquo; totals in attendance and tabling. Empty = 1 February.</p>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Finance categories</label>
              {activeLcId && <CategoriesManager projectId={activeLcId} />}
            </div>
            <div>
              <label style={labelStyle}>Journal Prompts</label>
              <button
                onClick={() => setPromptModalOpen(true)}
                style={{ height: 40, padding: "0 18px", backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, color: "var(--color-navy)", cursor: "pointer" }}
              >
                Manage prompts ({(activePromptIds ?? []).length} active)
              </button>
            </div>
            <button onClick={handleSaveLabSettings} disabled={savingLabSettings}
              style={{ alignSelf: "flex-start", minHeight: 44, height: 40, padding: "0 22px", backgroundColor: savingLabSettings ? "var(--color-border)" : "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, cursor: savingLabSettings ? "default" : "pointer" }}>
              {savingLabSettings ? "Saving…" : "Save LC settings"}
            </button>
          </div>
        </section>
      )}

      {/* Time zone section — used for notification quiet hours */}
      <section style={sectionStyle} aria-labelledby="settings-schedule-heading">
        <div style={sectionHeaderStyle}>
          <Clock size={16} color="var(--color-secondary)" />
          <h2 id="settings-schedule-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
            Time zone &amp; working hours
          </h2>
        </div>
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 20 }}>
          <WorkingHoursEditor
            timezone={timezone}
            onTimezoneChange={setTimezone}
            workingHours={workingHours}
            onWorkingHoursChange={setWorkingHours}
          />
          <button onClick={handleSaveSchedule} disabled={savingSchedule}
            style={{ alignSelf: "flex-start", minHeight: 44, height: 38, padding: "0 20px", backgroundColor: savingSchedule ? "var(--color-border)" : "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, cursor: savingSchedule ? "default" : "pointer" }}>
            {savingSchedule ? "Saving…" : "Save time zone"}
          </button>
        </div>
      </section>

      {/* Appearance section */}
      <section style={sectionStyle} aria-labelledby="settings-appearance-heading">
        <div style={sectionHeaderStyle}>
          <Monitor size={16} color="var(--color-secondary)" />
          <h2 id="settings-appearance-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
            Appearance
          </h2>
        </div>
        <div style={{ padding: "20px" }}>
          <p style={{ ...labelStyle, marginBottom: 12 }}>Theme</p>
          <div role="group" aria-label="Theme" style={{ display: "flex", gap: 10 }}>
            {([
              { value: "light", icon: <Sun size={15} />, label: "Light" },
              { value: "dark",  icon: <Moon size={15} />, label: "Dark" },
              { value: "system", icon: <Monitor size={15} />, label: "System" },
            ] as { value: "light" | "dark" | "system"; icon: React.ReactNode; label: string }[]).map(({ value, icon, label }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                aria-pressed={theme === value}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "8px 16px", borderRadius: 8, cursor: "pointer",
                  fontSize: 13, fontWeight: 600,
                  border: `1.5px solid ${theme === value ? "var(--color-btn-primary)" : "var(--color-border)"}`,
                  backgroundColor: theme === value ? "var(--color-btn-primary)" : "transparent",
                  color: theme === value ? "#fff" : "var(--color-secondary)",
                  transition: "all 0.15s",
                  minHeight: 40,
                }}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Notifications section */}
      <section id="notifications" style={sectionStyle} aria-labelledby="settings-notif-heading">
        <div style={sectionHeaderStyle}>
          <Bell size={16} color="var(--color-secondary)" />
          <h2 id="settings-notif-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
            Notifications
          </h2>
        </div>
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", marginBottom: 6 }}>How much email?</legend>
            {([
              { v: "all", label: "Everything", description: "Reminders for tasks and check-ins, the Monday digest, plus everything below" },
              { v: "digest", label: "Monday digest only", description: "One email a week with your tasks, upcoming events and LC wins, plus the important ones" },
              { v: "important", label: "Only important", description: "Event invites and reminders, overdue tasks and announcements" },
            ] as const).map((o) => (
              <label key={o.v} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input type="radio" name="email-mode" value={o.v} checked={emailMode === o.v} onChange={() => setEmailMode(o.v)} style={{ accentColor: "var(--color-navy)", marginTop: 3 }} />
                <span><span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", display: "block" }}>{o.label}</span><span style={{ fontSize: 12, color: "var(--color-secondary)" }}>{o.description}</span></span>
              </label>
            ))}
            <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>Event reminders, overdue tasks and announcements always come through.</p>
          </fieldset>
          {[
            { id: "notif-task", label: "Task assignments", description: "When someone assigns a task to you", value: notifTaskAssigned, set: setNotifTaskAssigned },
            { id: "notif-win", label: "LC wins", description: "When someone posts a win", value: notifLabWin, set: setNotifLabWin },
          ].map(({ id, label, description, value, set }) => (
            <label key={id} htmlFor={id} style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer", minHeight: 44 }}>
              <input
                type="checkbox"
                id={id}
                checked={value}
                onChange={(e) => set(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--color-navy)", cursor: "pointer" }}
              />
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", display: "block" }}>{label}</span>
                <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>{description}</span>
              </div>
            </label>
          ))}
          <button onClick={handleSaveNotifications}
            style={{ alignSelf: "flex-start", marginTop: 4, minHeight: 44, height: 38, padding: "0 20px", backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
            Save notification preferences
          </button>
        </div>
      </section>

      {/* Google Calendar — everyone */}
      <section id="google-calendar" aria-label="Google Calendar settings" style={{ marginBottom: 24 }}>
        <GoogleCalendarSettings />
      </section>

      {/* Focus / DND section */}
      <section style={sectionStyle} aria-labelledby="settings-focus-heading">
        <div style={sectionHeaderStyle}>
          <BellOff size={16} color="var(--color-secondary)" />
          <h2 id="settings-focus-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
            Focus &amp; Quiet Hours
          </h2>
        </div>
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div>
              <p style={{ ...labelStyle, marginBottom: 3 }}>Enable quiet hours</p>
              <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
                Suppress notification badges and chat unread counts during the hours you set below.
              </p>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>{dndEnabled ? "On" : "Off"}</span>
              <input type="checkbox" checked={dndEnabled} onChange={e => setDndEnabled(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--color-navy)", cursor: "pointer" }} />
            </label>
          </div>
          {dndEnabled && (
            <div>
              <span style={labelStyle}>Quiet hours window</span>
              <p style={{ fontSize: 12, color: "var(--color-secondary)", marginTop: 0, marginBottom: 10 }}>
                Spans midnight if end is earlier than start (e.g. 22:00 to 08:00).
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="time" value={quietHoursStart} onChange={e => setQuietHoursStart(e.target.value)}
                  style={{ height: 36, border: "1px solid var(--color-border)", borderRadius: 7, padding: "0 10px", fontSize: 13, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-surface-2)", color: "var(--color-body)", outline: "none" }} />
                <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>to</span>
                <input type="time" value={quietHoursEnd} onChange={e => setQuietHoursEnd(e.target.value)}
                  style={{ height: 36, border: "1px solid var(--color-border)", borderRadius: 7, padding: "0 10px", fontSize: 13, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-surface-2)", color: "var(--color-body)", outline: "none" }} />
              </div>
            </div>
          )}
          <button onClick={handleSaveDnd} disabled={savingDnd}
            style={{ alignSelf: "flex-start", minHeight: 44, height: 38, padding: "0 20px", backgroundColor: savingDnd ? "var(--color-border)" : "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, cursor: savingDnd ? "default" : "pointer" }}>
            {savingDnd ? "Saving…" : "Save focus settings"}
          </button>
        </div>
      </section>

      {/* Keyboard shortcuts section */}
      <section style={sectionStyle} aria-labelledby="settings-shortcuts-heading">
        <div style={sectionHeaderStyle}>
          <Keyboard size={16} color="var(--color-secondary)" />
          <h2 id="settings-shortcuts-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
            Keyboard Shortcuts
          </h2>
        </div>
        <div style={{ padding: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: "0 0 3px" }}>View all shortcuts</p>
            <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>See every keyboard shortcut available in {APP_NAME}. You can also press <kbd style={{ fontSize: 11, fontWeight: 700, padding: "1px 5px", borderRadius: 4, border: "1px solid var(--color-border)", backgroundColor: "var(--color-canvas)", color: "var(--color-secondary)" }}>?</kbd> anywhere.</p>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("app:show-shortcuts"))}
            style={{ fontSize: 12, fontWeight: 700, padding: "8px 18px", borderRadius: 8, backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", cursor: "pointer", minHeight: 40, flexShrink: 0 }}
          >
            View shortcuts
          </button>
        </div>
      </section>

      {/* Tour section */}
      <section style={sectionStyle} aria-labelledby="settings-tour-heading">
        <div style={sectionHeaderStyle}>
          <Compass size={16} color="var(--color-secondary)" />
          <h2 id="settings-tour-heading" style={{ fontFamily: "var(--font-lora)", fontWeight: 500, fontSize: 15, color: "var(--color-body)", margin: 0 }}>
            Welcome Tour
          </h2>
        </div>
        <div style={{ padding: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: "0 0 3px" }}>Show me around again</p>
            <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>Re-open the onboarding tour from the beginning.</p>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("app:show-onboarding"))}
            style={{ fontSize: 12, fontWeight: 700, padding: "8px 18px", borderRadius: 8, backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", cursor: "pointer", minHeight: 40, flexShrink: 0 }}
          >
            Start tour
          </button>
        </div>
      </section>
    </div>

    {promptModalOpen && createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
        style={{ backgroundColor: "rgba(2,99,196,0.35)" }}
        onClick={() => setPromptModalOpen(false)}>
        <div style={{ backgroundColor: "var(--color-surface)", maxWidth: 560, width: "100%", borderRadius: 10, border: "1px solid var(--color-border)", boxShadow: "0 8px 32px rgba(2,99,196,0.14)", maxHeight: "85vh", display: "flex", flexDirection: "column" }}
          onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
          <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
            <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "var(--color-navy)", margin: 0 }}>Manage Journal Prompts</h2>
            <p style={{ fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-secondary)", marginTop: 4 }}>Select which prompts are available to your team.</p>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: "16px 24px" }}>
            {Array.from(new Set(JOURNAL_PROMPTS.map(p => p.category))).map(cat => (
              <div key={cat} style={{ marginBottom: 20 }}>
                <p style={{ fontFamily: "var(--font-roboto)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 8 }}>
                  {PROMPT_CATEGORY_LABELS[cat]}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {JOURNAL_PROMPTS.filter(p => p.category === cat).map(prompt => {
                    const active = (activePromptIds ?? []).includes(prompt.id);
                    return (
                      <button key={prompt.id}
                        onClick={() => setActivePromptIds(prev => prev.includes(prompt.id) ? prev.filter(x => x !== prompt.id) : [...prev, prompt.id])}
                        style={{ textAlign: "left", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-body)", backgroundColor: active ? "rgba(2,99,196,0.04)" : "var(--color-surface)", border: active ? "1px solid var(--color-navy)" : "1px solid var(--color-border)", transition: "border-color 120ms ease" }}>
                        {prompt.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Custom prompts */}
            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
              <p style={{ fontFamily: "var(--font-roboto)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 8 }}>
                Custom Prompts
              </p>
              {customPrompts.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                  {customPrompts.map((cp) => (
                    <div key={cp.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", borderRadius: 8, backgroundColor: "rgba(2,99,196,0.04)", border: "1px solid var(--color-navy)" }}>
                      <span style={{ flex: 1, fontSize: 13, color: "var(--color-body)", fontFamily: "var(--font-roboto)" }}>{cp.text}</span>
                      <button
                        onClick={() => setCustomPrompts(prev => prev.filter(p => p.id !== cp.id))}
                        style={{ flexShrink: 0, height: 24, width: 24, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", border: "none", cursor: "pointer", borderRadius: 4 }}
                        aria-label="Remove custom prompt"
                      >
                        <X size={13} color="var(--color-secondary)" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={customPromptInput}
                  onChange={(e) => setCustomPromptInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customPromptInput.trim()) {
                      setCustomPrompts(prev => [...prev, { id: `cp-${Date.now()}`, text: customPromptInput.trim() }]);
                      setCustomPromptInput("");
                    }
                  }}
                  placeholder="Type a custom prompt and press Enter or Add"
                  style={{ flex: 1, height: 38, border: "1px solid var(--color-border)", borderRadius: 8, padding: "0 12px", fontSize: 13, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-canvas)", color: "var(--color-body)", outline: "none", boxSizing: "border-box" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
                />
                <button
                  onClick={() => {
                    if (!customPromptInput.trim()) return;
                    setCustomPrompts(prev => [...prev, { id: `cp-${Date.now()}`, text: customPromptInput.trim() }]);
                    setCustomPromptInput("");
                  }}
                  style={{ height: 38, padding: "0 14px", backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                >
                  Add
                </button>
              </div>
              <p style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 6 }}>
                Custom prompts appear alongside presets for all team members.
              </p>
            </div>
          </div>
          <div style={{ padding: "16px 24px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
            <button onClick={() => { setPromptModalOpen(false); handleSaveLabSettings(); }}
              style={{ height: 44, padding: "0 24px", backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Done
            </button>
            <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>Saves along with the other LC settings</span>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}
