"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Users, BookOpen, Check, X, Search, ChevronDown, Calendar } from "lucide-react";
import CanopyLogo from "@/components/ui/CanopyLogo";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { searchInstitutions, type InstitutionResult } from "@/lib/institutions";
import { WorkingHoursEditor, DEFAULT_WORKING_HOURS } from "@/components/ui/WorkingHoursEditor";
import type { WorkingHours, PromptCategory } from "@/types";
import { JOURNAL_PROMPTS, ACTIVE_PROMPT_IDS } from "@/lib/mock-data";

// ── Types ──────────────────────────────────────────────────────────────────────

type Role = "pi" | "researcher";

// ── Constants ─────────────────────────────────────────────────────────────────

const PROMPT_CATEGORY_LABELS: Record<PromptCategory, string> = {
  emotional_processing: "Emotional Processing",
  research_reflection: "Research Reflection",
  team_support: "Team & Support",
  boundaries_workload: "Boundaries & Workload",
  looking_forward: "Looking Forward",
};

const RESEARCH_PARTICIPATION_OPTIONS = [
  { value: "both_publications", label: "Participate in both publications", description: "Share anonymized task and journal patterns for well-being and team collaboration research." },
  { value: "wellbeing_only", label: "Well-being research only", description: "Share data only for the researcher well-being study." },
  { value: "private", label: "Keep data private", description: "Your lab's data is never included in any publication." },
];

const PI_STEPS = 7;
const RESEARCHER_STEPS = 5;


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

// ── PI project form (shared between PI step 2 and researcher create path) ──────

function ProjectForm({
  projectName, setProjectName,
  institution, setInstitution,
  userName, setUserName,
  showResearchType, researchType, setResearchType,
  roleTitle, setRoleTitle,
  showName = true,
  large,
}: {
  projectName: string; setProjectName: (v: string) => void;
  institution: string; setInstitution: (v: string) => void;
  userName: string; setUserName: (v: string) => void;
  showResearchType: boolean; researchType?: string; setResearchType?: (v: string) => void;
  roleTitle?: string; setRoleTitle?: (v: string) => void;
  showName?: boolean;
  large?: boolean;
}) {
  return (
    <>
      <Field label="Lab name">
        <TextInput large={large} value={projectName} onChange={setProjectName} placeholder="e.g. Moral Injury & Resilience Lab" />
      </Field>

      <Field label="Institution">
        <TextInput large={large} value={institution} onChange={setInstitution} placeholder="e.g. Your university or research center" />
      </Field>

      {showResearchType && setResearchType && (
        <Field label="Research type">
          <TextInput
            large={large}
            value={researchType ?? ""}
            onChange={setResearchType}
            placeholder="e.g. Moral injury in military veterans"
          />
        </Field>
      )}

      {showName && (
        <Field label="Your name">
          <TextInput large={large} value={userName} onChange={setUserName} placeholder="Full name" />
        </Field>
      )}

      {setRoleTitle !== undefined && (
        <Field label="Your role title (optional)">
          <TextInput large={large} value={roleTitle ?? ""} onChange={setRoleTitle} placeholder="e.g. Associate Professor, Lab Director" />
        </Field>
      )}
    </>
  );
}

// ── Wellbeing preview (shared) ────────────────────────────────────────────────

const SAMPLE_QUESTIONS = [
  "How supported do you feel by your team this week?",
  "How manageable is your workload right now?",
  "How connected do you feel to the purpose of your research?",
];

function WellbeingPreview({ role }: { role: "pi" | "researcher" }) {
  const [sample, setSample] = useState<Record<number, number>>({});
  return (
    <div>
      {role === "pi" ? (
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

// ── Supabase sync (fire-and-forget) ───────────────────────────────────────────

async function syncOnboardingToSupabase({
  projectName, institution, researchType,
  userName, userRole, inviteCode, enteredInviteCode, bio, department, inviteEmails,
  timezone, workingHours,
  researchParticipation, activePromptIds, customPrompts,
}: {
  projectName: string; institution: string; researchType: string;
  userName: string; userRole: "pi" | "researcher"; inviteCode?: string;
  enteredInviteCode?: string; bio?: string; department?: string;
  inviteEmails?: { email: string; code: string; roleName?: string }[];
  timezone?: string; workingHours?: Record<string, { start: string; end: string } | null>;
  researchParticipation?: string; activePromptIds?: string[]; customPrompts?: { id: string; text: string }[];
}): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) return null;

    const nameParts = userName.trim().split(/\s+/).filter(Boolean);
    const avatarInitials = nameParts.length === 0 ? "??"
      : nameParts.length === 1 ? nameParts[0][0].toUpperCase()
      : (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();

    let projectId: string;
    let resolvedInstitution = institution;

    let labRoleId: string | null = null;

    if (userRole === "pi") {
      const { data: existing } = await supabase
        .from("projects")
        .select("id")
        .eq("owner_id", user.id)
        .maybeSingle();

      if (existing) {
        projectId = existing.id as string;
      } else {
        const { data: created, error: createErr } = await supabase
          .from("projects")
          .insert({
            name: projectName, institution, research_type: researchType, owner_id: user.id,
            research_participation: researchParticipation ?? "private",
            active_prompt_ids: activePromptIds ?? ACTIVE_PROMPT_IDS,
            custom_prompts: customPrompts ?? [],
          })
          .select("id")
          .single();
        if (createErr || !created) return `Project creation failed: ${createErr?.message ?? "unknown error"}`;
        projectId = created.id as string;

        // Seed built-in roles for new lab
        await supabase.from("lab_roles").insert([
          { project_id: projectId, name: "PI",                     permission_level: "pi",         is_system: true },
          { project_id: projectId, name: "Co-PI",                  permission_level: "pi",         is_system: true },
          { project_id: projectId, name: "Postdoc",                permission_level: "researcher", is_system: true },
          { project_id: projectId, name: "PhD Student",            permission_level: "researcher", is_system: true },
          { project_id: projectId, name: "Master's Student",       permission_level: "researcher", is_system: true },
          { project_id: projectId, name: "Undergraduate Researcher", permission_level: "researcher", is_system: true },
          { project_id: projectId, name: "Lab Manager",            permission_level: "researcher", is_system: true },
          { project_id: projectId, name: "Researcher",             permission_level: "researcher", is_system: true },
        ]);
      }

      // Get all lab_roles to resolve permission_level/name → id
      const { data: allRoles } = await supabase
        .from("lab_roles").select("id, name, permission_level").eq("project_id", projectId);
      const roleIdByLevel: Record<string, string> = {};
      const roleIdByName: Record<string, string> = {};
      for (const r of allRoles ?? []) {
        const row = r as { id: string; name: string; permission_level: string };
        if (!roleIdByLevel[row.permission_level]) roleIdByLevel[row.permission_level] = row.id;
        roleIdByName[row.name] = row.id;
      }
      labRoleId = roleIdByName["PI"] ?? roleIdByLevel["pi"] ?? null;

      // Save the generic shareable code
      if (inviteCode) {
        const { error: codeErr } = await supabase.from("invite_codes").insert({
          code: inviteCode, project_id: projectId, created_by: user.id,
          lab_role_id: roleIdByLevel["researcher"] ?? null,
        });
        if (codeErr) console.error("[Sync] generic invite_code insert error:", codeErr.message, codeErr.code);
      }
      // Save one unique code per invited email (resolved by roleName)
      if (inviteEmails && inviteEmails.length > 0) {
        for (const { email, code, roleName } of inviteEmails) {
          const resolvedRoleId = (roleName ? roleIdByName[roleName] : null) ?? roleIdByLevel["researcher"] ?? null;
          const { error: emailCodeErr } = await supabase.from("invite_codes").insert({
            code, project_id: projectId, created_by: user.id, invited_email: email,
            lab_role_id: resolvedRoleId,
          });
          if (emailCodeErr) console.error("[Sync] invite_code insert error:", emailCodeErr.message, emailCodeErr.code);
        }
      }
    } else if (enteredInviteCode) {
      // Look up the project linked to the invite code via SECURITY DEFINER RPC
      // (direct table SELECT is restricted to lab members; researchers use this RPC
      // before they are members, so the RLS bypass is intentional here)
      const normalizedCode = enteredInviteCode.trim().toUpperCase();
      type InviteLookup = { project_id: string; invited_email: string | null; used_by: string | null; used_at: string | null; lab_role_id: string | null };
      const { data: inviteData, error: inviteErr } = await supabase
        .rpc("claim_invite_code_lookup", { p_code: normalizedCode })
        .maybeSingle() as { data: InviteLookup | null; error: { message: string } | null };

      if (inviteErr || !inviteData?.project_id) {
        return `Invalid invite code. Please check the code and try again.${inviteErr ? ` (${inviteErr.message})` : ""}`;
      }

      if (inviteData.used_by) {
        return "This invite link has already been used. Ask your PI to send a new one from Lab Settings.";
      }

      projectId = inviteData.project_id;
      labRoleId = inviteData.lab_role_id;

      // Mark code as used
      await supabase.from("invite_codes").update({
        used_by: user.id, used_at: new Date().toISOString(),
      }).eq("code", normalizedCode);

      // Clear the pending invite from localStorage
      if (typeof window !== "undefined") localStorage.removeItem("pendingInviteCode");
    } else {
      return "No invite code provided. Please ask your PI for a lab invite link.";
    }

    const profilePayload = {
      id: user.id, name: userName, role: userRole,
      institution: resolvedInstitution ?? "", avatar_initials: avatarInitials,
      project_id: projectId,
      bio: bio ?? "",
      department: department ?? "",
      avatar_color: "#B4D4E3",
    };
    const { error: profileError } = await supabase
      .from("user_profiles")
      .insert(profilePayload)
      .select()
      .maybeSingle()
      .then(async (res) => {
        if (res.error?.code === "23505") {
          return supabase.from("user_profiles").update(profilePayload).eq("id", user.id);
        }
        return res;
      });
    if (profileError) return `Profile save failed: ${profileError.message}`;

    const { error: memberErr } = await supabase
      .from("team_members")
      .insert({ project_id: projectId, user_id: user.id, role: userRole, lab_role_id: labRoleId })
      .select();
    if (memberErr && memberErr.code !== "23505") return `Team membership save failed: ${memberErr.message}`;

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

  // PI step 2
  const [piProjectName, setPiProjectName] = useState("");
  const [piInstitution, setPiInstitution] = useState("");
  const [piResearchType, setPiResearchType] = useState("");
  const [piUserName, setPiUserName] = useState("");
  const [piRoleTitle, setPiRoleTitle] = useState("");

  // Researcher step 2
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

  // Institution search (PI step 2)
  const [institutionQuery, setInstitutionQuery] = useState("");
  const [institutionResults, setInstitutionResults] = useState<InstitutionResult[]>([]);
  const [institutionOpen, setInstitutionOpen] = useState(false);
  const institutionRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // PI step 4 - research participation
  const [piResearchParticipation, setPiResearchParticipation] = useState("private");

  // PI step 5 - invite team
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

  // PI step 6 - journal prompts
  const [piActivePromptIds, setPiActivePromptIds] = useState<string[]>(ACTIVE_PROMPT_IDS);
  const [piCustomPrompts, setPiCustomPrompts] = useState<{ id: string; text: string }[]>([]);
  const [piPromptInput, setPiPromptInput] = useState("");

  // Researcher step 3 - profile
  const [profileName, setProfileName] = useState("");
  const [profileDept, setProfileDept] = useState("");
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

      // Pre-fill invite code if researcher arrived via an invite link
      const pendingInvite = localStorage.getItem("pendingInviteCode");
      if (pendingInvite) {
        setInviteCode(pendingInvite);
        // Auto-detect researcher path — skip role selection
        setRole("researcher");
        setStep(2);
      }

      // Pre-fill name from sign-up form
      const signupName = localStorage.getItem("canopy_signup_name") ?? "";
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

  // Pre-fill profile name when entering researcher step 3
  useEffect(() => {
    if (step === 3 && role === "researcher" && resUserName && !profileName) {
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

  function handleResearcherStep2Continue() {
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
    const code = "CANOPY-" + Math.random().toString(36).substring(2, 6).toUpperCase();
    setInviteEmails((prev) => [...prev, trimmed]);
    setEmailCodes((prev) => ({ ...prev, [trimmed]: code }));
    setEmailRoles((prev) => ({ ...prev, [trimmed]: "researcher" }));
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
    let researchType: string;
    let userName: string;
    let userRole: "pi" | "researcher";
    let userRoleTitle: string | undefined;

    if (role === "pi") {
      projectName   = piProjectName;
      institution   = piInstitution;
      researchType  = piResearchType;
      userName      = piUserName;
      userRole      = "pi";
      userRoleTitle = piRoleTitle || undefined;
    } else {
      projectName   = "Lab Workspace";
      institution   = "";
      researchType  = "";
      userName      = profileName || resUserName;
      userRole      = "researcher";
      userRoleTitle = undefined;
    }

    localStorage.setItem(
      "canopy_project",
      JSON.stringify({
        id: crypto.randomUUID(),
        name: projectName,
        institution,
        researchType,
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

    if (role === "pi" && generatedCode) {
      localStorage.setItem("canopy_invite_code", generatedCode);
    }

    if (role === "pi" && inviteEmails.length > 0) {
      localStorage.setItem(
        "canopy_email_invites",
        JSON.stringify(inviteEmails.map((email) => ({ email, code: emailCodes[email] }))),
      );
    }

    // Await Supabase sync so the profile row exists before AppShell loads
    if (isSupabaseConfigured) {
      const syncErr = await syncOnboardingToSupabase({
        projectName, institution, researchType,
        userName, userRole,
        inviteCode: role === "pi" ? generatedCode : undefined,
        enteredInviteCode: role === "researcher" && inviteCode.length >= 6 ? inviteCode : undefined,
        bio: role === "researcher" ? profileBio : undefined,
        department: role === "researcher" ? profileDept : undefined,
        inviteEmails: role === "pi"
          ? inviteEmails.map((email) => ({ email, code: emailCodes[email], roleName: emailRoles[email] ?? "Researcher" }))
          : undefined,
        timezone: role === "pi" ? piTimezone : resTimezone,
        workingHours: role === "pi" ? piWorkingHours : resWorkingHours,
        researchParticipation: role === "pi" ? piResearchParticipation : undefined,
        activePromptIds: role === "pi" ? piActivePromptIds : undefined,
        customPrompts: role === "pi" ? piCustomPrompts : undefined,
      });
      if (syncErr) {
        setSyncError(syncErr);
        setSubmitting(false);
        return;
      }

      // Fire invite emails for PI onboarding (fire-and-forget — emails are best-effort)
      if (role === "pi" && inviteEmails.length > 0) {
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
          <StepDots current={1} total={role === "pi" ? PI_STEPS : RESEARCHER_STEPS} />

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
            {(["pi", "researcher"] as Role[]).map((r) => {
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
                  {r === "pi" ? (
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
                    {r === "pi" ? "I'm a PI / Lab Director" : "I'm a Researcher"}
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
                    {r === "pi"
                      ? "I manage a research team and want to set up a lab workspace."
                      : "I've been invited to join a lab by my PI."}
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

  // ── Step 2A: PI creates project ────────────────────────────────────────────

  if (step === 2 && role === "pi") {
    const canContinue =
      piProjectName.trim().length > 0 &&
      piInstitution.trim().length > 0 &&
      piResearchType.length > 0 &&
      piUserName.trim().length > 0;

    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(1)} />
          <StepDots current={2} total={PI_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Set up your lab workspace"
            subtitle="You can change these later in Lab Settings."
          />

          <Field label="Lab name">
            <TextInput large={isLarge} value={piProjectName} onChange={setPiProjectName} placeholder="e.g. Moral Injury & Resilience Lab" />
          </Field>

          {/* Institution search */}
          <Field label="Institution">
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
                  placeholder="Search your university or research center"
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

          <Field label="Research area">
            <TextInput large={isLarge} value={piResearchType} onChange={setPiResearchType} placeholder="e.g. Moral injury in military veterans" />
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

  // ── Step 3A: PI timezone ────────────────────────────────────────────────────

  if (step === 3 && role === "pi") {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(2)} />
          <StepDots current={3} total={PI_STEPS} />
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

  // ── Step 4A: PI research participation ─────────────────────────────────────

  if (step === 4 && role === "pi") {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(3)} />
          <StepDots current={4} total={PI_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Research participation"
            subtitle="Canopy runs two research studies on researcher well-being and lab team dynamics. You decide how your lab's data is used."
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
            {RESEARCH_PARTICIPATION_OPTIONS.map(opt => (
              <label
                key={opt.value}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 16px",
                  borderRadius: 8, cursor: "pointer",
                  border: `${piResearchParticipation === opt.value ? 2 : 1}px solid ${piResearchParticipation === opt.value ? "var(--color-navy)" : "var(--color-border)"}`,
                  backgroundColor: piResearchParticipation === opt.value ? "rgba(27,46,75,0.03)" : "var(--color-surface)",
                  transition: "border-color 120ms ease",
                }}
                onClick={() => setPiResearchParticipation(opt.value)}
              >
                <input
                  type="radio"
                  name="onboarding_research_participation"
                  value={opt.value}
                  checked={piResearchParticipation === opt.value}
                  onChange={() => setPiResearchParticipation(opt.value)}
                  style={{ marginTop: 2, accentColor: "var(--color-navy)", width: 16, height: 16, flexShrink: 0, cursor: "pointer" }}
                />
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", fontFamily: "var(--font-roboto)", display: "block" }}>{opt.label}</span>
                  <span style={{ fontSize: 12, color: "var(--color-secondary)", fontFamily: "var(--font-roboto)", lineHeight: 1.5, display: "block", marginTop: 2 }}>{opt.description}</span>
                </div>
              </label>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "4px 0 0", lineHeight: 1.5 }}>
            All data is anonymized before analysis. You can change this at any time in Lab Settings.
          </p>
          <NavButton large={isLarge} onClick={() => {
            const code = "CANOPY-" + Math.random().toString(36).substring(2, 6).toUpperCase();
            setGeneratedCode(code);
            setStep(5);
          }}>
            Continue
          </NavButton>
        </div>
      </div>
    );
  }

  // ── Step 2B: Researcher enters invite code ─────────────────────────────────

  if (step === 2 && role === "researcher") {
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
          <StepDots current={2} total={RESEARCHER_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Join your lab"
            subtitle={autoFilled ? "Your invite code is ready. Just confirm below." : "Enter the invite code or paste the invite link your PI shared with you."}
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
              Don&apos;t have a code? Ask your PI to share an invite link from their Lab Settings.
            </p>
          )}

          <NavButton large={isLarge} onClick={handleResearcherStep2Continue} disabled={!inviteValid}>
            Continue
          </NavButton>
        </div>
      </div>
    );
  }

  // ── Step 5A: PI invites team ───────────────────────────────────────────────

  if (step === 5 && role === "pi") {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(4)} />
          <StepDots current={5} total={PI_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Invite researchers to your lab"
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
                    value={emailRoles[email] ?? "Researcher"}
                    onChange={(e) => setEmailRoles((prev) => ({ ...prev, [email]: e.target.value }))}
                    style={{ fontSize: 11, border: "1px solid var(--color-border)", borderRadius: 5, padding: "2px 4px", backgroundColor: "var(--color-surface)", fontFamily: "var(--font-roboto)", cursor: "pointer", flexShrink: 0 }}
                    aria-label={`Role for ${email}`}
                  >
                    <option value="PI">PI</option>
                    <option value="Co-PI">Co-PI</option>
                    <option value="Postdoc">Postdoc</option>
                    <option value="PhD Student">PhD Student</option>
                    <option value="Master's Student">Master&apos;s Student</option>
                    <option value="Undergraduate Researcher">Undergrad Researcher</option>
                    <option value="Lab Manager">Lab Manager</option>
                    <option value="Researcher">Researcher</option>
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
                  This generic link lets anyone who has it join your lab. Use with caution.
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

          <NavButton large={isLarge} onClick={() => setStep(6)}>
            Continue
          </NavButton>

          <button
            onClick={() => setStep(6)}
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

  // ── Step 6A: PI journal prompts ─────────────────────────────────────────────

  if (step === 6 && role === "pi") {
    return (
      <div style={PAGE_WRAP}>
        <div style={{ ...cardStyle(isLarge), maxHeight: "90dvh", display: "flex", flexDirection: "column" }}>
          <div style={{ flexShrink: 0 }}>
            <BackButton onClick={() => setStep(5)} />
            <StepDots current={6} total={PI_STEPS} />
            <SectionTitle
              large={isLarge}
              title="Journal prompts"
              subtitle="Choose which prompts appear for your team's weekly journals. You can change this in Lab Settings at any time."
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
            <NavButton large={isLarge} onClick={() => setStep(7)}>
              Continue
            </NavButton>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 7A: PI wellbeing preview ──────────────────────────────────────────

  if (step === 7 && role === "pi") {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(6)} />
          <StepDots current={7} total={PI_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Team wellbeing check-ins"
            subtitle="Here's what your team will see each week."
          />
          <WellbeingPreview role="pi" />
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

  // ── Researcher step 3: profile ────────────────────────────────────────────

  if (step === 3 && role === "researcher") {
    const canContinue = profileName.trim().length > 0;

    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(2)} />
          <StepDots current={3} total={RESEARCHER_STEPS} />
          <SectionTitle large={isLarge} title="Set up your profile" />

          <Field label="Full name">
            <TextInput large={isLarge} value={profileName} onChange={setProfileName} placeholder="Full name" />
          </Field>

          <Field label="Department / Program (optional)">
            <TextInput
              large={isLarge}
              value={profileDept}
              onChange={setProfileDept}
              placeholder="e.g. Psychology, Epidemiology"
            />
          </Field>

          <div style={{ marginBottom: 16 }}>
            <FieldLabel>Bio (optional)</FieldLabel>
            <textarea
              value={profileBio}
              onChange={(e) => setProfileBio(e.target.value)}
              rows={3}
              placeholder="Tell your team a bit about your research background."
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

  // ── Researcher step 4: timezone ───────────────────────────────────────────

  if (step === 4 && role === "researcher") {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(3)} />
          <StepDots current={4} total={RESEARCHER_STEPS} />
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

  // ── Researcher step 5: wellbeing preview ──────────────────────────────────

  if (step === 5 && role === "researcher") {
    return (
      <div style={PAGE_WRAP}>
        <div style={cardStyle(isLarge)}>
          <BackButton onClick={() => setStep(4)} />
          <StepDots current={5} total={RESEARCHER_STEPS} />
          <SectionTitle
            large={isLarge}
            title="Weekly check-ins"
            subtitle="A quick preview of what to expect each week."
          />
          <WellbeingPreview role="researcher" />
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
