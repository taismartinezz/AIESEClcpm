"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Users, BookOpen, Check, X, Search, ChevronDown } from "lucide-react";
import CanopyLogo from "@/components/ui/CanopyLogo";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { ACTIVE_LC_STORAGE_KEY } from "@/context/ProjectContext";
import { searchInstitutions, type InstitutionResult } from "@/lib/institutions";
import { WorkingHoursEditor, DEFAULT_WORKING_HOURS } from "@/components/ui/WorkingHoursEditor";
import type { WorkingHours, PromptCategory } from "@/types";
import { JOURNAL_PROMPTS, ACTIVE_PROMPT_IDS } from "@/lib/mock-data";

// ── Types ──────────────────────────────────────────────────────────────────────

type Role = "president" | "member";

// ── Constants ─────────────────────────────────────────────────────────────────

const PROMPT_CATEGORY_LABELS: Record<PromptCategory, string> = {
  emotional_processing: "Emotional Processing",
  research_reflection: "Research Reflection",
  team_support: "Team & Support",
  boundaries_workload: "Boundaries & Workload",
  looking_forward: "Looking Forward",
};

const CREATE_STEPS = 6;
const JOIN_STEPS = 5;


// ── Shared styles ─────────────────────────────────────────────────────────────

function inputStyle(large: boolean): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    height: large ? 52 : 44,
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    padding: "0 14px",
    fontFamily: "var(--font-roboto)",
    fontWeight: 400,
    fontSize: large ? 15 : 14,
    color: "var(--color-body)",
    outline: "none",
    boxSizing: "border-box",
    backgroundColor: "var(--color-surface)",
  };
}

// Keep the static constant for uses that don't have access to isLarge
const INPUT_STYLE: React.CSSProperties = inputStyle(false);

const PAGE_WRAP: React.CSSProperties = {
  minHeight: "100dvh",
  backgroundColor: "var(--color-canvas)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px 16px",
  fontFamily: "var(--font-roboto)",
};

function cardStyle(large: boolean): React.CSSProperties {
  return {
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: large ? 14 : 10,
    maxWidth: large ? 720 : 580,
    width: "100%",
    padding: large ? "56px 56px 60px" : "40px 40px 44px",
    boxShadow: "0 4px 24px rgba(27,46,75,0.08)",
  };
}

// Keep static constant for non-large default uses
const CARD_STYLE: React.CSSProperties = cardStyle(false);

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={1}
      aria-valuemax={total}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 32,
      }}
    >
      {Array.from({ length: total }).map((_, i) => {
        const num = i + 1;
        const done = num < current;
        const active = num === current;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 && (
              <div style={{ width: 44, height: 1, backgroundColor: "var(--color-border)" }} />
            )}
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: done || active ? "var(--color-navy)" : "var(--color-surface)",
                border: done || active ? "none" : "1px solid var(--color-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {done && <Check size={6} color="#fff" strokeWidth={3} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "var(--font-roboto)",
        fontWeight: 600,
        fontSize: 13,
        color: "var(--color-navy)",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
        marginBottom: 20,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.7"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
    >
      ← Back
    </button>
  );
}

function NavButton({
  onClick,
  disabled,
  style: extraStyle,
  large,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  large?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        height: large ? 52 : 44,
        backgroundColor: disabled ? "var(--color-border)" : "var(--color-navy)",
        color: "#fff",
        border: "none",
        borderRadius: 8,
        fontFamily: "var(--font-roboto)",
        fontWeight: 700,
        fontSize: large ? 15 : 14,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background-color 150ms ease",
        marginTop: large ? 28 : 24,
        ...extraStyle,
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy-hover)";
      }}
      onMouseLeave={(e) => {
        if (!disabled) (e.currentTarget as HTMLElement).style.backgroundColor = disabled ? "var(--color-border)" : "var(--color-navy)";
      }}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-roboto)",
        fontWeight: 600,
        fontSize: 13,
        color: "var(--color-body)",
        margin: "0 0 6px",
      }}
    >
      {children}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  onKeyDown,
  large,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  large?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputStyle(large ?? false)}
      onKeyDown={onKeyDown}
      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
    />
  );
}

function SectionTitle({ title, subtitle, large }: { title: string; subtitle?: string; large?: boolean }) {
  return (
    <div style={{ marginBottom: large ? 28 : 24 }}>
      <h2
        style={{
          fontFamily: "var(--font-lora)",
          fontWeight: 700,
          fontSize: large ? 26 : 20,
          color: "var(--color-navy)",
          margin: 0,
          lineHeight: 1.25,
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          style={{
            fontFamily: "var(--font-roboto)",
            fontWeight: 400,
            fontSize: large ? 14 : 13,
            color: "var(--color-secondary)",
            marginTop: 6,
            marginBottom: 0,
            lineHeight: 1.5,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ── Wellbeing preview (shared) ────────────────────────────────────────────────

const SAMPLE_QUESTIONS = [
  "How supported do you feel by your team this week?",
  "How manageable is your workload right now?",
  "How connected do you feel to the purpose of your research?",
];

function WellbeingPreview({ role }: { role: "president" | "member" }) {
  const [sample, setSample] = useState<Record<number, number>>({});
  return (
    <div>
      {role === "president" ? (
        <p style={{ fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-secondary)", margin: "0 0 20px", lineHeight: 1.6 }}>
          Your team completes a brief weekly check-in. You'll see aggregated scores, never individual responses.
          Canopy only surfaces results when enough team members have responded, so every voice stays protected.
        </p>
      ) : (
        <p style={{ fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-secondary)", margin: "0 0 20px", lineHeight: 1.6 }}>
          Each week, Canopy sends a short 3-question check-in. Your responses are private. Only aggregated team insights are visible to your PI.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {SAMPLE_QUESTIONS.map((q, i) => (
          <div key={i} style={{ padding: "14px 16px", backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", borderRadius: 8 }}>
            <p style={{ fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-body)", margin: "0 0 10px", lineHeight: 1.4 }}>{q}</p>
            <div style={{ display: "flex", gap: 8 }}>
              {[1,2,3,4,5].map((v) => (
                <button
                  key={v}
                  onClick={() => setSample((prev) => ({ ...prev, [i]: v }))}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 6,
                    border: `1.5px solid ${sample[i] === v ? "var(--color-navy)" : "var(--color-border)"}`,
                    backgroundColor: sample[i] === v ? "var(--color-navy)" : "var(--color-surface)",
                    color: sample[i] === v ? "#fff" : "var(--color-secondary)",
                    fontFamily: "var(--font-roboto)",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "all 120ms ease",
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>Not at all</span>
              <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>Very much</span>
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontFamily: "var(--font-roboto)", fontSize: 11, color: "var(--color-secondary)", margin: "14px 0 0", textAlign: "center" }}>
        ↑ Try it out. This is just a preview, nothing is recorded.
      </p>
    </div>
  );
}

// ── Supabase sync ─────────────────────────────────────────────────────────────
// Creating an LC: insert the project (DB triggers seed the President/VP/Member
// roles and the default departments), then join it as president.
// Joining an LC: save the profile, then call join_lc_with_code(), which checks the
// code server-side and assigns the invite's role — never a client-chosen one.

async function syncOnboardingToSupabase({
  projectName, institution,
  userName, userRole, inviteCode, enteredInviteCode, bio, inviteEmails,
  timezone, workingHours,
  activePromptIds, customPrompts,
}: {
  projectName: string; institution: string;
  userName: string; userRole: "president" | "member"; inviteCode?: string;
  enteredInviteCode?: string; bio?: string;
  inviteEmails?: { email: string; code: string; roleName?: string }[];
  timezone?: string; workingHours?: Record<string, { start: string; end: string } | null>;
  activePromptIds?: string[]; customPrompts?: { id: string; text: string }[];
}): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) return null;

    const nameParts = userName.trim().split(/\s+/).filter(Boolean);
    const avatarInitials = nameParts.length === 0 ? "??"
      : nameParts.length === 1 ? nameParts[0][0].toUpperCase()
      : (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();

    // 1. Profile first — joining an LC requires it to exist.
    const profilePayload: Record<string, string> = {
      id: user.id, name: userName, avatar_initials: avatarInitials, avatar_color: "#B4D4E3",
    };
    if (bio) profilePayload.bio = bio;
    if (userRole === "president" && institution) profilePayload.institution = institution;
    const { error: profileError } = await supabase
      .from("user_profiles")
      .upsert(profilePayload, { onConflict: "id" });
    if (profileError) return `Profile save failed: ${profileError.message}`;

    let projectId: string;

    if (userRole === "president") {
      const { data: created, error: createErr } = await supabase
        .from("projects")
        .insert({
          name: projectName, institution, owner_id: user.id,
          active_prompt_ids: activePromptIds ?? ACTIVE_PROMPT_IDS,
          custom_prompts: customPrompts ?? [],
        })
        .select("id")
        .single();
      if (createErr || !created) return `Creating the Local Committee failed: ${createErr?.message ?? "unknown error"}`;
      projectId = created.id as string;

      const { data: allRoles, error: rolesErr } = await supabase
        .from("lab_roles").select("id, name, permission_level").eq("project_id", projectId);
      if (rolesErr) return `Loading LC roles failed: ${rolesErr.message}`;
      const roleIdByLevel: Record<string, string> = {};
      const roleIdByName: Record<string, string> = {};
      for (const r of allRoles ?? []) {
        const row = r as { id: string; name: string; permission_level: string };
        if (!roleIdByLevel[row.permission_level]) roleIdByLevel[row.permission_level] = row.id;
        roleIdByName[row.name] = row.id;
      }

      const { error: memberErr } = await supabase
        .from("team_members")
        .insert({ project_id: projectId, user_id: user.id, role: "president", lab_role_id: roleIdByName["President"] ?? null });
      if (memberErr && memberErr.code !== "23505") return `Joining your new LC failed: ${memberErr.message}`;

      // Generic shareable code (joins as Member)
      if (inviteCode) {
        const { error: codeErr } = await supabase.from("invite_codes").insert({
          code: inviteCode, project_id: projectId, created_by: user.id,
          lab_role_id: roleIdByName["Member"] ?? roleIdByLevel["member"] ?? null,
        });
        if (codeErr) console.error("[Sync] generic invite_code insert error:", codeErr.message, codeErr.code);
      }
      // One personal code per invited email, with the role picked for that person
      for (const { email, code, roleName } of inviteEmails ?? []) {
        const resolvedRoleId = (roleName ? roleIdByName[roleName] : null) ?? roleIdByLevel["member"] ?? null;
        const { error: emailCodeErr } = await supabase.from("invite_codes").insert({
          code, project_id: projectId, created_by: user.id, invited_email: email,
          lab_role_id: resolvedRoleId,
        });
        if (emailCodeErr) console.error("[Sync] invite_code insert error:", emailCodeErr.message, emailCodeErr.code);
      }
    } else if (enteredInviteCode) {
      const { data: joined, error: joinErr } = await supabase
        .rpc("join_lc_with_code", { p_code: enteredInviteCode.trim().toUpperCase() });
      if (joinErr || !joined) {
        return `That invite code didn't work: ${joinErr?.message ?? "unknown error"}. Ask your LCP for a new link.`;
      }
      projectId = joined as string;
      if (typeof window !== "undefined") localStorage.removeItem("pendingInviteCode");
    } else {
      return "No invite code provided. Ask your LCP for an invite link.";
    }

    // Open the app on the LC that was just created or joined.
    try { localStorage.setItem(ACTIVE_LC_STORAGE_KEY, projectId); } catch { /* ignore */ }

    // Save timezone + working hours if provided
    if (timezone) {
      await supabase.from("user_settings").upsert(
        { user_id: user.id, timezone, working_hours: workingHours ?? null, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    }

    return null;
  } catch (err) {
    console.error("[syncOnboardingToSupabase] unexpected error:", err instanceof Error ? err.message : String(err));
    return `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [role, setRole] = useState<Role | null>(null);

  // Create-LC step 2
  const [piProjectName, setPiProjectName] = useState("");
  const [piInstitution, setPiInstitution] = useState("");
  const [piUserName, setPiUserName] = useState("");
  const [piRoleTitle, setPiRoleTitle] = useState("");

  // Join-LC step 2
  const [inviteCode, setInviteCode] = useState("");
  const [resUserName, setResUserName] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  // Timezone state (auto-detect)
  const [piTimezone, setPiTimezone] = useState<string>(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"; } catch { return "America/New_York"; }
  });
  const [piWorkingHours, setPiWorkingHours] = useState<WorkingHours>(DEFAULT_WORKING_HOURS);
  const [resTimezone, setResTimezone] = useState<string>(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"; } catch { return "America/New_York"; }
  });
  const [resWorkingHours, setResWorkingHours] = useState<WorkingHours>(DEFAULT_WORKING_HOURS);

  // University search (create-LC step 2)
  const [institutionQuery, setInstitutionQuery] = useState("");
  const [institutionResults, setInstitutionResults] = useState<InstitutionResult[]>([]);
  const [institutionOpen, setInstitutionOpen] = useState(false);
  const institutionRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create-LC step 4 - invite team
  const [emailInput, setEmailInput] = useState("");
  const [emailInputError, setEmailInputError] = useState("");
  const [inviteEmails, setInviteEmails] = useState<string[]>([]);
  const [emailCodes, setEmailCodes] = useState<Record<string, string>>({});
  const [emailRoles, setEmailRoles] = useState<Record<string, string>>({});
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [revealLink, setRevealLink] = useState(false);
  const [piShowAdvancedInvites, setPiShowAdvancedInvites] = useState(false);

  // Create-LC step 5 - journal prompts
  const [piActivePromptIds, setPiActivePromptIds] = useState<string[]>(ACTIVE_PROMPT_IDS);
  const [piCustomPrompts, setPiCustomPrompts] = useState<{ id: string; text: string }[]>([]);
  const [piPromptInput, setPiPromptInput] = useState("");

  // Join-LC step 3 - profile
  const [profileName, setProfileName] = useState("");
  const [profileBio, setProfileBio] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const checked = useRef(false);

  // Responsive breakpoint — true on screens ≥ 960px
  const [isLarge, setIsLarge] = useState(() => typeof window !== "undefined" && window.innerWidth >= 960);
  useEffect(() => {
    function check() { setIsLarge(window.innerWidth >= 960); }
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Guard: session check runs FIRST - nothing renders until this resolves
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;

    async function init() {
      if (!isSupabaseConfigured) {
        if (!localStorage.getItem("canopy_authed")) { router.replace("/login"); return; }
        const pendingInvite = localStorage.getItem("pendingInviteCode");
        if (pendingInvite) setInviteCode(pendingInvite);
        if (localStorage.getItem("canopy_project")) { router.replace("/"); return; }
        const signupName = localStorage.getItem("canopy_signup_name") ?? "";
        if (signupName) {
          setPiUserName(signupName);
          setResUserName(signupName);
          localStorage.removeItem("canopy_signup_name");
        }
        setSessionReady(true);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }

      // Pre-fill invite code if the member arrived via an invite link
      const pendingInvite = localStorage.getItem("pendingInviteCode");
      if (pendingInvite) {
        setInviteCode(pendingInvite);
        // Auto-detect the join path — skip the choice screen
        setRole("member");
        setStep(2);
      }

      // Pre-fill name from sign-up form, or from the existing profile when an
      // existing user is creating/joining another LC (/onboarding?add=1).
      const { data: existingProfile } = await supabase
        .from("user_profiles").select("name").eq("id", session.user.id).maybeSingle();
      const signupName = localStorage.getItem("canopy_signup_name") ?? (existingProfile?.name as string | undefined) ?? "";
      if (signupName) {
        setPiUserName(signupName);
        setResUserName(signupName);
        localStorage.removeItem("canopy_signup_name");
      }

      setSessionReady(true);
    }

    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fill profile name when entering join step 3
  useEffect(() => {
    if (step === 3 && role === "member" && resUserName && !profileName) {
      setProfileName(resUserName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, role]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleStep1Continue() {
    if (!role) return;
    setStep(2);
  }

  function handlePiStep2Continue() {
    setStep(3); // → timezone step
  }

  function handleJoinStep2Continue() {
    if (inviteCode.trim().length >= 6) {
      setIsJoining(true);
      setTimeout(() => { setIsJoining(false); setStep(3); }, 1500);
    }
  }

  const handleAddEmail = useCallback(() => {
    const trimmed = emailInput.trim();
    if (!trimmed) { setEmailInputError("Please enter an email address."); return; }
    if (!trimmed.includes("@")) { setEmailInputError("Please enter a valid email address."); return; }
    if (inviteEmails.includes(trimmed)) { setEmailInputError("This email has already been added."); return; }
    setEmailInputError("");
    const code = "LC-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    setInviteEmails((prev) => [...prev, trimmed]);
    setEmailCodes((prev) => ({ ...prev, [trimmed]: code }));
    setEmailRoles((prev) => ({ ...prev, [trimmed]: "Member" }));
    setEmailInput("");
  }, [emailInput, inviteEmails]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/login?invite=${generatedCode}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [generatedCode]);

  const handleCopyEmailLink = useCallback(async (email: string) => {
    const code = emailCodes[email];
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/login?invite=${code}`);
      setCopiedEmail(email);
      setTimeout(() => setCopiedEmail(null), 2000);
    } catch { /* ignore */ }
  }, [emailCodes]);

  async function completeOnboarding() {
    if (submitting || !role) return;
    setSubmitting(true);

    const usedInvite = inviteCode.length >= 6;

    let projectName: string;
    let institution: string;
    let userName: string;
    let userRole: "president" | "member";
    let userRoleTitle: string | undefined;

    if (role === "president") {
      projectName   = piProjectName;
      institution   = piInstitution;
      userName      = piUserName;
      userRole      = "president";
      userRoleTitle = piRoleTitle || undefined;
    } else {
      projectName   = "Local Committee";
      institution   = "";
      userName      = profileName || resUserName;
      userRole      = "member";
      userRoleTitle = undefined;
    }

    localStorage.setItem(
      "canopy_project",
      JSON.stringify({
        id: crypto.randomUUID(),
        name: projectName,
        institution,
        createdAt: new Date().toISOString(),
      }),
    );

    const nameParts = userName.trim().split(/\s+/).filter(Boolean);
    const avatarInitials =
      nameParts.length === 0
        ? "??"
        : nameParts.length === 1
          ? nameParts[0][0].toUpperCase()
          : (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();

    localStorage.setItem(
      "canopy_user",
      JSON.stringify({
        id: crypto.randomUUID(),
        name: userName,
        role: userRole,
        roleTitle: userRoleTitle,
        institution: institution || undefined,
        avatarInitials,
      }),
    );

    if (role === "president" && generatedCode) {
      localStorage.setItem("canopy_invite_code", generatedCode);
    }

    if (role === "president" && inviteEmails.length > 0) {
      localStorage.setItem(
        "canopy_email_invites",
        JSON.stringify(inviteEmails.map((email) => ({ email, code: emailCodes[email] }))),
      );
    }

    // Await Supabase sync so the profile row exists before AppShell loads
    if (isSupabaseConfigured) {
      const syncErr = await syncOnboardingToSupabase({
        projectName, institution,
        userName, userRole,
        inviteCode: role === "president" ? generatedCode : undefined,
        enteredInviteCode: role === "member" && inviteCode.length >= 6 ? inviteCode : undefined,
        bio: role === "member" ? profileBio : undefined,
        inviteEmails: role === "president"
          ? inviteEmails.map((email) => ({ email, code: emailCodes[email], roleName: emailRoles[email] ?? "Member" }))
          : undefined,
        timezone: role === "president" ? piTimezone : resTimezone,
        workingHours: role === "president" ? piWorkingHours : resWorkingHours,
        activePromptIds: role === "president" ? piActivePromptIds : undefined,
        customPrompts: role === "president" ? piCustomPrompts : undefined,
      });
      if (syncErr) {
        setSyncError(syncErr);
        setSubmitting(false);
        return;
      }

      // Fire invite emails after creating an LC (best-effort)
      if (role === "president" && inviteEmails.length > 0) {
        const { data: { session: piSession } } = await supabase.auth.getSession();
        if (piSession?.access_token) {
          // Fetch the invite_codes we just created to get their IDs
          const { data: createdCodes } = await supabase
            .from("invite_codes")
            .select("id, invited_email")
            .eq("created_by", piSession.user.id)
            .not("invited_email", "is", null)
            .in("invited_email", inviteEmails)
            .is("used_by", null);
          if (createdCodes && createdCodes.length > 0) {
            fetch("/api/invite/send", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${piSession.access_token}` },
              body: JSON.stringify({ inviteIds: createdCodes.map((c) => c.id) }),
            }).catch(() => {});
          }
        }
      }

      // After account is created, resolve any pending project invite.
      // External invitees get sub_project_members access only - no team_members row added here.
      const pendingToken = localStorage.getItem("pendingProjectInviteToken");
      if (pendingToken) {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (user) {
          const { data: invite } = await supabase
            .from("sub_project_invite_codes")
            .select("id, sub_project_id, invited_email, invited_by, status")
            .eq("token", pendingToken)
            .eq("status", "pending")
            .maybeSingle();
          if (invite && (invite.invited_email as string).toLowerCase() === (user.email ?? "").toLowerCase()) {
            await supabase.from("sub_project_members").upsert(
              {
                sub_project_id: invite.sub_project_id as string,
                user_id: user.id,
                joined_at: new Date().toISOString(),
                invited_by: invite.invited_by as string,
              },
              { onConflict: "sub_project_id,user_id", ignoreDuplicates: true }
            );
            await supabase.from("sub_project_invite_codes").update({
              status: "accepted", used_by: user.id, used_at: new Date().toISOString(),
            }).eq("id", invite.id as string);
            localStorage.setItem("canopy_active_sub_project", invite.sub_project_id as string);
            localStorage.setItem("canopy_scope_mode", "project");
          }
          localStorage.removeItem("pendingProjectInviteToken");
        }
      }
    }

    router.push("/profile");
  }

  if (!sessionReady) return null;

  // ── Step 1: Role selection ─────────────────────────────────────────────────

  if (step === 1) {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <StepDots current={1} total={role === "president" ? CREATE_STEPS : JOIN_STEPS} />

          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <CanopyLogo size={32} />
          </div>

          <h1
            style={{
              fontFamily: "var(--font-lora)",
              fontWeight: 700,
              fontSize: isLarge ? 30 : 22,
              color: "var(--color-navy)",
              textAlign: "center",
              margin: "16px 0 8px",
            }}
          >
            Welcome to Canopy
          </h1>
          <p
            style={{
              fontFamily: "var(--font-roboto)",
              fontWeight: 400,
              fontSize: isLarge ? 15 : 14,
              color: "var(--color-secondary)",
              textAlign: "center",
              margin: "0 0 32px",
            }}
          >
            How are you using Canopy?
          </p>

          {/* Role cards */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {(["president", "member"] as Role[]).map((r) => {
              const selected = role === r;
              return (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  style={{
                    flex: "1 1 200px",
                    minHeight: 140,
                    padding: 24,
                    backgroundColor: selected ? "var(--color-navy-dim)" : "var(--color-surface)",
                    border: `${selected ? 2 : 1}px solid ${selected ? "var(--color-navy)" : "var(--color-border)"}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    transition: "border-color 150ms ease, background-color 150ms ease",
                  }}
                >
                  {r === "president" ? (
                    <Users size={28} color="var(--color-navy)" />
                  ) : (
                    <BookOpen size={28} color="var(--color-navy)" />
                  )}
                  <span
                    style={{
                      fontFamily: "var(--font-lora)",
                      fontWeight: 600,
                      fontSize: 15,
                      color: "var(--color-navy)",
                      display: "block",
                      marginTop: 12,
                    }}
                  >
                    {r === "president" ? "Create a Local Committee" : "Join an LC"}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-roboto)",
                      fontWeight: 400,
                      fontSize: 13,
                      color: "var(--color-secondary)",
                      lineHeight: 1.5,
                      display: "block",
                      marginTop: 6,
                    }}
                  >
                    {r === "president"
                      ? "I'm the LCP (or setting things up for them) and want a workspace for our LC."
                      : "I've got an invite link or code from my LCP."}
                  </span>
                </button>
              );
            })}
          </div>

          <NavButton large={isLarge} onClick={handleStep1Continue} disabled={!role}>
            Continue
          </NavButton>
        </div>
      </div>
    );
  }

  // ── Step 2A: President creates the LC ────────────────────────────────────────────

  if (step === 2 && role === "president") {
    const canContinue =
      piProjectName.trim().length > 0 &&
      piInstitution.trim().length > 0 &&
      piUserName.trim().length > 0;

    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(1)} />
          <StepDots current={2} total={CREATE_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Set up your Local Committee"
            subtitle="You can change these later in Settings."
          />

          <Field label="Local Committee name">
            <TextInput large={isLarge} value={piProjectName} onChange={setPiProjectName} placeholder="e.g. AIESEC in Lisbon" />
          </Field>

          {/* Institution search */}
          <Field label="University">
            <div ref={institutionRef} style={{ position: "relative" }}>
              <div style={{ position: "relative" }}>
                <Search size={14} color="var(--color-secondary)" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                <input
                  type="text"
                  value={institutionQuery || piInstitution}
                  onChange={(e) => {
                    const v = e.target.value;
                    setInstitutionQuery(v);
                    setPiInstitution(v);
                    setInstitutionOpen(true);
                    if (searchTimeout.current) clearTimeout(searchTimeout.current);
                    searchTimeout.current = setTimeout(async () => {
                      const results = await searchInstitutions(v);
                      setInstitutionResults(results);
                    }, 300);
                  }}
                  onFocus={() => { if (piInstitution) setInstitutionOpen(true); }}
                  placeholder="Search your university"
                  style={{ ...inputStyle(isLarge), paddingLeft: 34 }}
                  onBlur={() => setTimeout(() => setInstitutionOpen(false), 150)}
                />
              </div>
              {institutionOpen && institutionResults.length > 0 && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
                  backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8,
                  boxShadow: "0 4px 16px rgba(27,46,75,0.1)", maxHeight: 200, overflowY: "auto",
                }}>
                  {institutionResults.map((r) => (
                    <button
                      key={r.key}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setPiInstitution(r.name);
                        setInstitutionQuery("");
                        setInstitutionOpen(false);
                        setInstitutionResults([]);
                      }}
                      style={{
                        display: "flex", flexDirection: "column", width: "100%", padding: "10px 14px",
                        border: "none", backgroundColor: "transparent", textAlign: "left", cursor: "pointer",
                        borderBottom: "1px solid var(--color-border)",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-canvas)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                    >
                      <span style={{ fontSize: 13, color: "var(--color-body)", fontFamily: "var(--font-roboto)" }}>{r.name}</span>
                      <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{r.country}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <Field label="Your name">
            <TextInput large={isLarge} value={piUserName} onChange={setPiUserName} placeholder="Full name" />
          </Field>

          <NavButton large={isLarge} onClick={handlePiStep2Continue} disabled={!canContinue}>
            Continue
          </NavButton>
        </div>
      </div>
    );
  }

  // ── Step 3A: President time zone ────────────────────────────────────────────────────

  if (step === 3 && role === "president") {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(2)} />
          <StepDots current={3} total={CREATE_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Your schedule"
            subtitle="Canopy uses this for meeting suggestions and your weekly digest."
          />
          <WorkingHoursEditor
            timezone={piTimezone}
            onTimezoneChange={setPiTimezone}
            workingHours={piWorkingHours}
            onWorkingHoursChange={setPiWorkingHours}
            showDetectedBanner
          />
          <NavButton large={isLarge} onClick={() => setStep(4)}>
            Continue
          </NavButton>
        </div>
      </div>
    );
  }

  // ── Step 2B: Member enters invite code ─────────────────────────────────

  if (step === 2 && role === "member") {
    const inviteValid = inviteCode.trim().length >= 6;
    const autoFilled = inviteCode.trim().length >= 6 && typeof localStorage !== "undefined" && !!localStorage.getItem("pendingInviteCode");

    if (isJoining) {
      return (
        <div style={PAGE_WRAP}>
          <div style={{ ...cardStyle(isLarge), textAlign: "center", padding: isLarge ? "72px 56px" : "56px 40px" }}>
            <CanopyLogo size={28} />
            <p style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 18, color: "var(--color-navy)", marginTop: 20, marginBottom: 0 }}>
              Joined! Setting up your workspace...
            </p>
          </div>
        </div>
      );
    }

    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(1)} />
          <StepDots current={2} total={JOIN_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Join your LC"
            subtitle={autoFilled ? "Your invite code is ready. Just confirm below." : "Enter the invite code or paste the invite link your LCP shared with you."}
          />

          <Field label="Invite code">
            <TextInput
              large={isLarge}
              value={inviteCode}
              onChange={setInviteCode}
              placeholder="e.g. CANOPY-XXXX"
            />
          </Field>

          {!autoFilled && (
            <p style={{ fontFamily: "var(--font-roboto)", fontSize: 12, color: "var(--color-secondary)", margin: "-8px 0 0" }}>
              Don&apos;t have a code? Ask your LCP to share an invite link from Settings.
            </p>
          )}

          <NavButton large={isLarge} onClick={handleJoinStep2Continue} disabled={!inviteValid}>
            Continue
          </NavButton>
        </div>
      </div>
    );
  }

  // ── Step 4A: President invites the team ───────────────────────────────────────────────

  if (step === 4 && role === "president") {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(3)} />
          <StepDots current={4} total={CREATE_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Invite your executive board and members"
            subtitle="Add email addresses below. Each person gets a unique invite link tied to their address."
          />

          {/* Email add row */}
          <div style={{ marginBottom: emailInputError ? 4 : 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); setEmailInputError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddEmail(); } }}
                placeholder="Add email"
                aria-label="Add team member email"
                style={{ ...inputStyle(isLarge), flex: 1, borderColor: emailInputError ? "#C0392B" : "var(--color-border)" }}
                onFocus={(e) => { e.currentTarget.style.borderColor = emailInputError ? "#C0392B" : "var(--color-navy)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = emailInputError ? "#C0392B" : "var(--color-border)"; }}
              />
              <button
                onClick={handleAddEmail}
                style={{
                  height: 44,
                  padding: "0 16px",
                  backgroundColor: "var(--color-navy)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontFamily: "var(--font-roboto)",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-navy)"; }}
              >
                Add
              </button>
            </div>
            {emailInputError && (
              <p role="alert" style={{ fontFamily: "var(--font-roboto)", fontSize: 12, color: "#C0392B", margin: "4px 0 8px" }}>
                {emailInputError}
              </p>
            )}
          </div>

          {/* Email chips */}
          {inviteEmails.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              {inviteEmails.map((email) => (
                <div
                  key={email}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    backgroundColor: "var(--color-navy-dim)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontFamily: "var(--font-roboto)",
                    fontSize: 13,
                    color: "var(--color-body)",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {email}
                  </span>
                  {/* Role picker for each invite */}
                  <select
                    value={emailRoles[email] ?? "Member"}
                    onChange={(e) => setEmailRoles((prev) => ({ ...prev, [email]: e.target.value }))}
                    style={{ fontSize: 11, border: "1px solid var(--color-border)", borderRadius: 5, padding: "2px 4px", backgroundColor: "var(--color-surface)", fontFamily: "var(--font-roboto)", cursor: "pointer", flexShrink: 0 }}
                    aria-label={`Role for ${email}`}
                  >
                    <option value="Member">Member</option>
                    <option value="VP">VP</option>
                  </select>
                  <button
                    onClick={() => handleCopyEmailLink(email)}
                    aria-label={`Copy invite link for ${email}`}
                    style={{
                      flexShrink: 0,
                      background: "none",
                      border: "1px solid var(--color-border)",
                      borderRadius: 6,
                      cursor: "pointer",
                      padding: "2px 8px",
                      fontFamily: "var(--font-roboto)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: copiedEmail === email ? "#2E7D52" : "var(--color-navy)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {copiedEmail === email ? "Copied!" : "Copy link"}
                  </button>
                  <button
                    onClick={() => {
                      setInviteEmails((prev) => prev.filter((e) => e !== email));
                      setEmailCodes((prev) => { const next = { ...prev }; delete next[email]; return next; });
                      setEmailRoles((prev) => { const next = { ...prev }; delete next[email]; return next; });
                    }}
                    aria-label={`Remove ${email}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      color: "var(--color-secondary)",
                      minWidth: 16,
                      minHeight: 16,
                      flexShrink: 0,
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Advanced: generic invite link */}
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 14, marginTop: 8 }}>
            <button
              onClick={() => setPiShowAdvancedInvites(v => !v)}
              style={{ display: "flex", alignItems: "center", gap: 6, backgroundColor: "transparent", border: "none", cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", fontFamily: "var(--font-roboto)" }}
            >
              <ChevronDown size={13} style={{ transform: piShowAdvancedInvites ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
              Advanced
            </button>
            {piShowAdvancedInvites && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 12, color: "var(--color-secondary)", marginTop: 0, marginBottom: 10 }}>
                  This generic link lets anyone who has it join your LC as a Member. Use with caution.
                </p>
                <button
                  onClick={handleCopyLink}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    width: "100%", minHeight: 40, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13,
                    color: copied ? "#2E7D52" : "var(--color-navy)", background: "none",
                    border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 16px", cursor: "pointer",
                    transition: "color 150ms ease, border-color 150ms ease",
                  }}
                >
                  {copied ? "Copied!" : "Copy generic invite link"}
                </button>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4 }}>
                  <p style={{ fontFamily: "var(--font-roboto)", fontSize: 11, color: "var(--color-secondary)", margin: 0, letterSpacing: revealLink ? 0 : "0.05em" }}>
                    {revealLink
                      ? (typeof window !== "undefined" ? `${window.location.origin}/login?invite=${generatedCode}` : `/login?invite=${generatedCode}`)
                      : `${process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== "undefined" ? window.location.origin : "canopyteams.tech")}/login?invite=••••••••`}
                  </p>
                  <button type="button" onClick={() => setRevealLink(v => !v)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-roboto)", fontSize: 11, color: "var(--color-navy)", textDecoration: "underline", padding: 0 }}>
                    {revealLink ? "Hide" : "Reveal"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <NavButton large={isLarge} onClick={() => setStep(5)}>
            Continue
          </NavButton>

          <button
            onClick={() => setStep(5)}
            style={{ display: "block", width: "100%", textAlign: "center", fontFamily: "var(--font-roboto)", fontWeight: 400, fontSize: 13, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer", marginTop: 12, padding: 0, minHeight: 36 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = "underline"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = "none"; }}
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  // ── Step 5A: President picks journal prompts ─────────────────────────────────────────────

  if (step === 5 && role === "president") {
    return (
      <div style={PAGE_WRAP}>
        <div style={{ ...cardStyle(isLarge), maxHeight: "90dvh", display: "flex", flexDirection: "column" }}>
          <div style={{ flexShrink: 0 }}>
            <BackButton onClick={() => setStep(4)} />
            <StepDots current={5} total={CREATE_STEPS} />
            <SectionTitle
              large={isLarge}
              title="Journal prompts"
              subtitle="Choose which prompts appear for your team's weekly journals. You can change this in Settings at any time."
            />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {Array.from(new Set(JOURNAL_PROMPTS.map(p => p.category))).map(cat => (
              <div key={cat} style={{ marginBottom: 18 }}>
                <p style={{ fontFamily: "var(--font-roboto)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 8 }}>
                  {PROMPT_CATEGORY_LABELS[cat]}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {JOURNAL_PROMPTS.filter(p => p.category === cat).map(prompt => {
                    const active = piActivePromptIds.includes(prompt.id);
                    return (
                      <button key={prompt.id}
                        onClick={() => setPiActivePromptIds(prev => prev.includes(prompt.id) ? prev.filter(x => x !== prompt.id) : [...prev, prompt.id])}
                        style={{ textAlign: "left", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-body)", backgroundColor: active ? "rgba(27,46,75,0.04)" : "var(--color-surface)", border: active ? "1px solid var(--color-navy)" : "1px solid var(--color-border)", transition: "border-color 120ms ease" }}>
                        {prompt.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {/* Custom prompts */}
            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 14, marginBottom: 4 }}>
              <p style={{ fontFamily: "var(--font-roboto)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", marginBottom: 8 }}>
                Custom Prompts
              </p>
              {piCustomPrompts.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                  {piCustomPrompts.map(cp => (
                    <div key={cp.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", borderRadius: 8, backgroundColor: "rgba(27,46,75,0.04)", border: "1px solid var(--color-navy)" }}>
                      <span style={{ flex: 1, fontSize: 13, color: "var(--color-body)", fontFamily: "var(--font-roboto)" }}>{cp.text}</span>
                      <button onClick={() => setPiCustomPrompts(prev => prev.filter(p => p.id !== cp.id))}
                        style={{ flexShrink: 0, height: 24, width: 24, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", border: "none", cursor: "pointer" }}
                        aria-label="Remove custom prompt">
                        <X size={13} color="var(--color-secondary)" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input value={piPromptInput} onChange={e => setPiPromptInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && piPromptInput.trim()) {
                      setPiCustomPrompts(prev => [...prev, { id: `cp-${Date.now()}`, text: piPromptInput.trim() }]);
                      setPiPromptInput("");
                    }
                  }}
                  placeholder="Add a custom prompt and press Enter or Add"
                  style={{ ...inputStyle(isLarge), flex: 1, height: isLarge ? 48 : 40 }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
                />
                <button
                  onClick={() => {
                    if (!piPromptInput.trim()) return;
                    setPiCustomPrompts(prev => [...prev, { id: `cp-${Date.now()}`, text: piPromptInput.trim() }]);
                    setPiPromptInput("");
                  }}
                  style={{ height: 40, padding: "0 14px", backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 600, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>
                  Add
                </button>
              </div>
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <NavButton large={isLarge} onClick={() => setStep(6)}>
              Continue
            </NavButton>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 6A: President wellbeing preview ──────────────────────────────────────────

  if (step === 6 && role === "president") {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(5)} />
          <StepDots current={6} total={CREATE_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Team wellbeing check-ins"
            subtitle="Here's what your team will see each week."
          />
          <WellbeingPreview role="president" />
          <NavButton large={isLarge} onClick={completeOnboarding} disabled={submitting}>
            {submitting ? "Setting up your workspace…" : "Go to my workspace"}
          </NavButton>
          {syncError && (
            <p role="alert" style={{ fontFamily: "var(--font-roboto)", fontSize: 13, color: "#C0392B", marginTop: 10, textAlign: "center" }}>
              {syncError}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Member step 3: profile ────────────────────────────────────────────

  if (step === 3 && role === "member") {
    const canContinue = profileName.trim().length > 0;

    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(2)} />
          <StepDots current={3} total={JOIN_STEPS} />
          <SectionTitle large={isLarge} title="Set up your profile" />

          <Field label="Full name">
            <TextInput large={isLarge} value={profileName} onChange={setProfileName} placeholder="Full name" />
          </Field>

          <div style={{ marginBottom: 16 }}>
            <FieldLabel>Bio (optional)</FieldLabel>
            <textarea
              value={profileBio}
              onChange={(e) => setProfileBio(e.target.value)}
              rows={3}
              placeholder="Tell your LC a bit about yourself and what you do in AIESEC."
              style={{
                display: "block",
                width: "100%",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                padding: "10px 14px",
                fontFamily: "var(--font-roboto)",
                fontWeight: 400,
                fontSize: 14,
                color: "var(--color-body)",
                outline: "none",
                boxSizing: "border-box",
                resize: "vertical",
                minHeight: 88,
                lineHeight: 1.5,
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            />
          </div>

          <NavButton large={isLarge} onClick={() => setStep(4)} disabled={!canContinue}>
            Continue
          </NavButton>
        </div>
      </div>
    );
  }

  // ── Member step 4: time zone ───────────────────────────────────────────

  if (step === 4 && role === "member") {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(3)} />
          <StepDots current={4} total={JOIN_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Your schedule"
            subtitle="Canopy uses this for meeting suggestions and your weekly digest."
          />
          <WorkingHoursEditor
            timezone={resTimezone}
            onTimezoneChange={setResTimezone}
            workingHours={resWorkingHours}
            onWorkingHoursChange={setResWorkingHours}
            showDetectedBanner
          />
          <NavButton large={isLarge} onClick={() => setStep(5)}>
            Continue
          </NavButton>
        </div>
      </div>
    );
  }

  // ── Member step 5: wellbeing preview ──────────────────────────────────

  if (step === 5 && role === "member") {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(4)} />
          <StepDots current={5} total={JOIN_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Weekly check-ins"
            subtitle="A quick preview of what to expect each week."
          />
          <WellbeingPreview role="member" />
          <NavButton large={isLarge} onClick={completeOnboarding} disabled={submitting}>
            {submitting ? "Setting up your workspace…" : "Go to my workspace"}
          </NavButton>
          {syncError && (
            <p role="alert" style={{ fontFamily: "var(--font-roboto)", fontSize: 13, color: "#C0392B", marginTop: 10, textAlign: "center" }}>
              {syncError}
            </p>
          )}
        </div>
      </div>
    );
  }

  return null;
}
