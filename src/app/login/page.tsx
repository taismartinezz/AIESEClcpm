"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import CanopyLogo from "@/components/ui/CanopyLogo";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { loadGoogleIdentity, createNonce, renderGisButton, type GoogleCredentialResponse } from "@/lib/googleIdentity";
import { getPostAuthDestination } from "@/lib/postAuthRedirect";

// When set, Google sign-in uses Google's own button (as an invisible overlay) + an
// ID token, so the consent screen names our domain instead of the Supabase project URL.
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

// ── Provider icons ────────────────────────────────────────────────────────────

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
        fill="var(--color-body)"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M11.4 2H2v9.4h9.4V2z"       fill="#F25022"/>
      <path d="M22 2h-9.4v9.4H22V2z"        fill="#7FBA00"/>
      <path d="M11.4 12.6H2V22h9.4v-9.4z"   fill="#00A4EF"/>
      <path d="M22 12.6h-9.4V22H22v-9.4z"   fill="#FFB900"/>
    </svg>
  );
}


// ── Auth button ───────────────────────────────────────────────────────────────

function AuthButton({
  icon,
  label,
  ariaLabel,
  onClick,
  muted = false,
  dashed = false,
  loading = false,
  disabled = false,
  forceHovered = false,
}: {
  icon: React.ReactNode;
  label: string;
  ariaLabel: string;
  onClick: () => void;
  muted?: boolean;
  dashed?: boolean;
  loading?: boolean;
  disabled?: boolean;
  forceHovered?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const isDisabled = disabled || loading;
  const showHover = (hovered || forceHovered) && !isDisabled;

  return (
    <button
      type="button"
      onClick={isDisabled ? undefined : onClick}
      aria-label={ariaLabel}
      aria-busy={loading}
      disabled={isDisabled}
      onMouseEnter={() => { if (!isDisabled) setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        height: 48,
        minHeight: 48,
        backgroundColor: "var(--color-surface)",
        border: `1px ${dashed ? "dashed" : "solid"} ${showHover ? "var(--color-navy-dim)" : "var(--color-border)"}`,
        borderRadius: 8,
        cursor: isDisabled ? "not-allowed" : "pointer",
        fontFamily: "var(--font-roboto)",
        fontWeight: 600,
        fontSize: 14,
        color: isDisabled ? "var(--color-secondary)" : muted ? "var(--color-secondary)" : "var(--color-body)",
        opacity: disabled && !loading ? 0.5 : 1,
        boxShadow: showHover ? "0 2px 8px rgba(27,46,75,0.08)" : "none",
        transition: "border-color 150ms ease, box-shadow 150ms ease, opacity 150ms ease",
        position: "relative",
        padding: 0,
      }}
    >
      {/* Icon or spinner - pinned 24px from left edge */}
      <span
        style={{
          position: "absolute",
          left: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        {loading ? (
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="9" r="7" fill="none" stroke="var(--color-border)" strokeWidth="2" />
            <path d="M9 2a7 7 0 0 1 7 7" fill="none" stroke="var(--color-secondary)" strokeWidth="2" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" from="0 9 9" to="360 9 9" dur="0.8s" repeatCount="indefinite" />
            </path>
          </svg>
        ) : icon}
      </span>
      {/* Label - centered in the full button width */}
      <span style={{ flex: 1, textAlign: "center" }}>
        {loading ? `Connecting…` : label}
      </span>
    </button>
  );
}


// ── Project invite resolution ─────────────────────────────────────────────────
// Called after any successful sign-in. Reads the pending token from localStorage,
// looks it up in sub_project_invite_codes, and if email matches creates the
// sub_project_members row WITHOUT adding a team_members row (external access only).

async function resolveProjectInvite(userId: string, userEmail: string) {
  if (typeof window === "undefined") return;
  const token = localStorage.getItem("pendingProjectInviteToken");
  if (!token) return;

  const { data: invite } = await supabase
    .from("sub_project_invite_codes")
    .select("id, sub_project_id, invited_email, invited_by, status")
    .eq("token", token)
    .eq("status", "pending")
    .maybeSingle();

  if (!invite || invite.invited_email.toLowerCase() !== userEmail.toLowerCase()) {
    localStorage.removeItem("pendingProjectInviteToken");
    return;
  }

  // Insert sub_project membership (ON CONFLICT DO NOTHING - idempotent)
  await supabase.from("sub_project_members").upsert(
    {
      sub_project_id: invite.sub_project_id as string,
      user_id: userId,
      joined_at: new Date().toISOString(),
      invited_by: invite.invited_by as string,
    },
    { onConflict: "sub_project_id,user_id", ignoreDuplicates: true }
  );

  // Mark invite accepted
  await supabase.from("sub_project_invite_codes").update({
    status: "accepted",
    used_by: userId,
    used_at: new Date().toISOString(),
  }).eq("id", invite.id as string);

  // Land user in this project's scope on next load
  localStorage.setItem("canopy_active_sub_project", invite.sub_project_id as string);
  localStorage.setItem("canopy_scope_mode", "project");
  localStorage.removeItem("pendingProjectInviteToken");
}

// ── Login page ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("mode") === "signup"
        ? "signup"
        : "signin";
    }
    return "signin";
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [formError, setFormError] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [oAuthLoading, setOAuthLoading] = useState<string | null>(null);
  const [oAuthError, setOAuthError] = useState<string | null>(null);
  const hasFetched = useRef(false);

  // GIS invisible-overlay state
  const [gisReady, setGisReady] = useState(false);
  const [googleButtonHovered, setGoogleButtonHovered] = useState(false);
  const googleWrapperRef = useRef<HTMLDivElement>(null);
  const gisContainerRef = useRef<HTMLDivElement>(null);

  // Enabled OAuth providers (comma-separated, e.g. "google,github"). If unset, all three show.
  const enabledProviders: Set<string> = new Set(
    (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "google,microsoft,github")
      .toLowerCase().split(",").map(s => s.trim()).filter(Boolean)
  );

  // Already authed? Route to correct destination.
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    // Surface OAuth errors forwarded from /auth/callback
    const params = new URLSearchParams(window.location.search);

    // Session-expired redirect from AppShell
    if (params.get("reason") === "session_expired") {
      setOAuthError("Your session expired. Please sign in again.");
    }

    const errorCode = params.get("error");
    const errorDesc = params.get("error_description") ?? "";
    if (errorCode) {
      const providerDisabled =
        errorDesc.includes("provider is not enabled") ||
        errorDesc.includes("Unsupported provider") ||
        errorCode === "provider_disabled";
      setOAuthError(
        providerDisabled
          ? "That sign-in method isn't available right now. Use email or try another provider."
          : "Sign-in failed. Please try again or use email."
      );
    }

    // Capture lab and project invite codes from URL before any redirect
    const inviteParam = params.get("invite");
    if (inviteParam) localStorage.setItem("pendingInviteCode", inviteParam);
    const projectInviteParam = params.get("project_invite");
    if (projectInviteParam) localStorage.setItem("pendingProjectInviteToken", projectInviteParam);

    if (!isSupabaseConfigured) {
      if (localStorage.getItem("canopy_authed") === "true") router.replace("/");
      else setChecking(false);
      return;
    }
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { setChecking(false); return; }
      try {
        const { data: member, error: memberError } = await supabase
          .from("team_members").select("id").eq("user_id", session.user.id).maybeSingle();
        if (memberError) { setChecking(false); return; }
        if (member) {
          // Normal lab member - resolve any pending project invite then go home
          await resolveProjectInvite(session.user.id, session.user.email ?? "");
          router.replace("/");
        } else {
          // No lab membership - check if they have a profile (external member or returning user)
          const { data: profile } = await supabase
            .from("user_profiles").select("id").eq("id", session.user.id).maybeSingle();
          if (profile) {
            await resolveProjectInvite(session.user.id, session.user.email ?? "");
            router.replace("/");
          } else {
            router.replace("/onboarding");
          }
        }
      } catch {
        setChecking(false);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEmailAuth = useCallback(async () => {
    if (mode === "signup" && !name.trim()) { setNameError("Please enter your full name."); return; }
    if (!email.includes("@")) { setEmailError("Please enter a valid email address."); return; }
    if (password.length < 6) { setPasswordError("Password must be at least 6 characters."); return; }
    setNameError("");
    setEmailError("");
    setPasswordError("");
    setFormError("");
    setLoading(true);

    if (!isSupabaseConfigured) {
      setLoading(false);
      localStorage.setItem("canopy_authed", "true");
      if (mode === "signup" && name.trim()) localStorage.setItem("canopy_signup_name", name.trim());
      router.push(localStorage.getItem("canopy_project") ? "/" : "/onboarding");
      return;
    }

    try {
      const { error: authError } = mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (authError) { setFormError(authError.message); setLoading(false); return; }

      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) { setFormError("Sign-in succeeded but session has no user."); setLoading(false); return; }

      if (mode === "signup") {
        if (name.trim()) localStorage.setItem("canopy_signup_name", name.trim());
        router.push("/onboarding");
        return;
      }

      const { data: member, error: memberError } = await supabase
        .from("team_members").select("id").eq("user_id", user.id).maybeSingle();
      if (memberError) { setLoading(false); return; }
      if (member) {
        await resolveProjectInvite(user.id, user.email ?? "");
        router.push("/");
      } else {
        const { data: profile } = await supabase
          .from("user_profiles").select("id").eq("id", user.id).maybeSingle();
        if (profile) {
          await resolveProjectInvite(user.id, user.email ?? "");
          router.push("/");
        } else {
          router.push("/onboarding");
        }
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setLoading(false);
    }
  }, [email, password, mode, router]);

  const handleForgotPassword = useCallback(async () => {
    if (!forgotEmail.includes("@")) { setForgotError("Please enter a valid email address."); return; }
    setForgotLoading(true);
    setForgotError("");
    if (isSupabaseConfigured) {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: (typeof window !== "undefined" ? window.location.origin : "") + "/reset-password",
      });
      if (resetError) { setForgotError(resetError.message); setForgotLoading(false); return; }
    }
    setForgotSent(true);
    setForgotLoading(false);
  }, [forgotEmail]);

  const handleOAuth = useCallback(async (provider: "github" | "google" | "azure") => {
    setOAuthLoading(provider);
    setOAuthError(null);
    if (isSupabaseConfigured) {
      localStorage.removeItem("canopy_user");
      localStorage.removeItem("canopy_project");
      localStorage.removeItem("canopy_authed");
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (error) {
        // Provider disabled, network error, or misconfiguration - surface it immediately
        console.error("[Auth] signInWithOAuth error:", error);
        const isProviderError =
          error.message.toLowerCase().includes("provider") ||
          error.message.toLowerCase().includes("not enabled") ||
          error.message.toLowerCase().includes("unsupported");
        setOAuthError(
          isProviderError
            ? "That sign-in method isn't available right now. Use email or try another provider."
            : `Sign-in failed: ${error.message}`
        );
        setOAuthLoading(null);
        return;
      }
      // signInWithOAuth redirects the browser on success, so code after here only
      // runs if the redirect stalls (popup blocked, slow network, etc.).
      // Reset the stuck button after 5 s so the user isn't left with "Connecting…".
      setTimeout(() => {
        setOAuthLoading((cur) => (cur === provider ? null : cur));
        setOAuthError((cur) => cur ?? "Redirect didn't happen. Please try again or use email.");
      }, 5000);
      return;
    }
    localStorage.setItem("canopy_authed", "true");
    router.push(localStorage.getItem("canopy_project") ? "/" : "/onboarding");
  }, [router]);

  // ── Google Identity Services invisible overlay (ID-token flow) ─────────────
  // Our AuthButton stays visible ("Continue with Google"); the GIS button iframe
  // sits on top at near-zero opacity and intercepts clicks.
  const useGoogleIdToken =
    !!GOOGLE_CLIENT_ID && isSupabaseConfigured && enabledProviders.has("google");

  useEffect(() => {
    if (checking || !useGoogleIdToken) return;
    let cancelled = false;
    let observer: ResizeObserver | null = null;

    (async () => {
      try {
        const [gis, [rawNonce, hashedNonce]] = await Promise.all([loadGoogleIdentity(), createNonce()]);
        if (cancelled || !gisContainerRef.current || !googleWrapperRef.current) return;

        gis.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: hashedNonce,
          ux_mode: "popup",
          use_fedcm_for_prompt: true,
          auto_select: false,
          cancel_on_tap_outside: false,
          callback: async ({ credential }: GoogleCredentialResponse) => {
            setOAuthLoading("google");
            setOAuthError(null);
            localStorage.removeItem("canopy_user");
            localStorage.removeItem("canopy_project");
            localStorage.removeItem("canopy_authed");
            try {
              const { data, error } = await supabase.auth.signInWithIdToken({
                provider: "google",
                token: credential,
                nonce: rawNonce,
              });
              if (error || !data.user) {
                console.error("[Auth] signInWithIdToken error:", error);
                setOAuthError("Sign-in failed. Please try again or use email.");
                setOAuthLoading(null);
                return;
              }
              router.replace(await getPostAuthDestination(data.user.id));
            } catch (err: unknown) {
              console.error("[Auth] signInWithIdToken threw:", err);
              setOAuthError("Sign-in failed. Please try again or use email.");
              setOAuthLoading(null);
            }
          },
        });

        const container = gisContainerRef.current;
        const wrapper = googleWrapperRef.current;
        renderGisButton(gis, container, wrapper.offsetWidth || 400);
        setGisReady(true);

        // Keep the overlay sized to our button
        observer = new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect.width;
          if (width && !cancelled) renderGisButton(gis, container, width);
        });
        observer.observe(wrapper);
      } catch (err) {
        // Script blocked or offline: our button keeps using the redirect flow.
        console.warn("[Auth] Google Identity Services unavailable, using redirect flow:", err);
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [checking, useGoogleIdToken, router]);


  if (checking) return null;

  return (
    <div
      style={{
        minHeight: "100dvh",
        backgroundColor: "var(--color-canvas)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        fontFamily: "var(--font-roboto)",
      }}
    >
      <h1 style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
        {mode === "signin" ? "Sign in to Canopy" : "Create your Canopy account"}
      </h1>

      {/* ── Card ── */}
      <div
        style={{
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          maxWidth: 480,
          width: "100%",
          paddingTop: 48,
          paddingBottom: 48,
          paddingLeft: 40,
          paddingRight: 40,
          boxShadow: "0 4px 24px rgba(27,46,75,0.08)",
        }}
      >
        {/* Logo + wordmark */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <CanopyLogo size={40} />
          <span
            aria-hidden="true"
            style={{
              fontFamily: "var(--font-lora)",
              fontWeight: 700,
              fontSize: 22,
              color: "var(--color-navy)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Canopy
          </span>
        </div>

        {/* Tagline */}
        <p
          style={{
            fontFamily: "var(--font-roboto)",
            fontSize: 14,
            color: "var(--color-secondary)",
            textAlign: "center",
            maxWidth: 300,
            lineHeight: 1.6,
            margin: "16px auto 0",
          }}
        >
          Only for researchers.
        </p>

        {/* Divider */}
        <div
          style={{
            height: 1,
            backgroundColor: "var(--color-border)",
            margin: "28px 0",
          }}
          role="separator"
        />

        {/* Mode heading */}
        <p
          style={{
            fontFamily: "var(--font-lora)",
            fontWeight: 600,
            fontSize: 15,
            color: "var(--color-navy)",
            textAlign: "center",
            margin: "0 0 16px",
          }}
        >
          {mode === "signin" ? "Sign in" : "Create your account"}
        </p>

        {/* OAuth error banner */}
        {oAuthError && (
          <div
            role="alert"
            style={{
              marginBottom: 12,
              padding: "10px 14px",
              backgroundColor: "rgba(185,28,28,0.06)",
              border: "1px solid rgba(185,28,28,0.18)",
              borderRadius: 8,
              fontFamily: "var(--font-roboto)",
              fontSize: 13,
              color: "var(--color-error)",
              lineHeight: 1.5,
            }}
          >
            {oAuthError}
          </div>
        )}

        {/* Auth buttons -- only renders providers listed in NEXT_PUBLIC_AUTH_PROVIDERS */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {enabledProviders.has("google") && (
            // Wrapper: our button is visible; GIS iframe sits on top at near-zero opacity.
            // The iframe intercepts clicks for the ID-token flow.
            // Keyboard fallback: AuthButton remains focusable and Enter/Space use redirect flow.
            <div
              ref={googleWrapperRef}
              style={{ position: "relative" }}
              onMouseEnter={() => setGoogleButtonHovered(true)}
              onMouseLeave={() => setGoogleButtonHovered(false)}
            >
              <AuthButton
                icon={<GoogleIcon />}
                label="Continue with Google"
                ariaLabel="Sign in with Google"
                loading={oAuthLoading === "google"}
                disabled={oAuthLoading !== null && oAuthLoading !== "google"}
                forceHovered={googleButtonHovered && oAuthLoading === null}
                onClick={() => handleOAuth("google")}
              />
              {/* GIS overlay -- kept mounted so the rendered iframe survives; hidden until ready */}
              {useGoogleIdToken && (
                <div
                  ref={gisContainerRef}
                  aria-hidden="true"
                  data-testid="google-signin-button"
                  style={{
                    position: "absolute",
                    inset: 0,
                    overflow: "hidden",
                    opacity: 0.01,
                    zIndex: 1,
                    display: gisReady ? "block" : "none",
                    pointerEvents: oAuthLoading !== null ? "none" : "auto",
                  }}
                />
              )}
            </div>
          )}

          {enabledProviders.has("microsoft") && (
            <AuthButton
              icon={<MicrosoftIcon />}
              label="Continue with Microsoft"
              ariaLabel="Sign in with Microsoft"
              loading={oAuthLoading === "azure"}
              disabled={oAuthLoading !== null && oAuthLoading !== "azure"}
              onClick={() => handleOAuth("azure")}
            />
          )}

          {enabledProviders.has("github") && (
            <AuthButton
              icon={<GitHubIcon />}
              label="Continue with GitHub"
              ariaLabel="Sign in with GitHub"
              loading={oAuthLoading === "github"}
              disabled={oAuthLoading !== null && oAuthLoading !== "github"}
              onClick={() => handleOAuth("github")}
            />
          )}
        </div>

        {/* Or divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 24,
            marginBottom: 24,
          }}
        >
          <div style={{ flex: 1, height: 1, backgroundColor: "var(--color-border)" }} />
          <span
            style={{
              fontFamily: "var(--font-roboto)",
              fontWeight: 400,
              fontSize: 12,
              color: "var(--color-secondary)",
            }}
          >
            or
          </span>
          <div style={{ flex: 1, height: 1, backgroundColor: "var(--color-border)" }} />
        </div>

        {/* Email form */}
        <form
          onSubmit={(e) => { e.preventDefault(); handleEmailAuth(); }}
          noValidate
        >
        {mode === "signup" && (
          <>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(""); setFormError(""); }}
              placeholder="Full name"
              autoComplete="name"
              aria-label="Full name"
              style={{
                display: "block",
                width: "100%",
                height: 44,
                border: `1px solid ${nameError ? "var(--color-error)" : "var(--color-border)"}`,
                borderRadius: 8,
                padding: "0 14px",
                fontFamily: "var(--font-roboto)",
                fontWeight: 400,
                fontSize: 14,
                color: "var(--color-body)",
                backgroundColor: "var(--color-canvas)",
                outline: "none",
                boxSizing: "border-box",
                marginBottom: nameError ? 0 : 10,
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = nameError ? "var(--color-error)" : "var(--color-navy)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = nameError ? "var(--color-error)" : "var(--color-border)"; }}
            />
            {nameError && (
              <p role="alert" style={{ fontFamily: "var(--font-roboto)", fontSize: 12, color: "var(--color-error)", margin: "4px 0 10px" }}>
                {nameError}
              </p>
            )}
          </>
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setEmailError(""); }}
          placeholder="Email"
          autoComplete="email"
          aria-label="Email"
          style={{
            display: "block",
            width: "100%",
            height: 44,
            border: `1px solid ${emailError ? "var(--color-error)" : "var(--color-border)"}`,
            borderRadius: 8,
            padding: "0 14px",
            fontFamily: "var(--font-roboto)",
            fontWeight: 400,
            fontSize: 14,
            color: "var(--color-body)",
            backgroundColor: "var(--color-canvas)",
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = emailError ? "var(--color-error)" : "var(--color-navy)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = emailError ? "var(--color-error)" : "var(--color-border)"; }}
        />
        {emailError && (
          <p role="alert" style={{ fontFamily: "var(--font-roboto)", fontSize: 12, color: "var(--color-error)", margin: "4px 0 0" }}>
            {emailError}
          </p>
        )}
        <div style={{ position: "relative", marginTop: 10 }}>
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setPasswordError(""); }}
            placeholder="Password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            aria-label="Password"
            style={{
              display: "block",
              width: "100%",
              height: 44,
              border: `1px solid ${passwordError ? "var(--color-error)" : "var(--color-border)"}`,
              borderRadius: 8,
              padding: "0 44px 0 14px",
              fontFamily: "var(--font-roboto)",
              fontWeight: 400,
              fontSize: 14,
              color: "var(--color-body)",
              backgroundColor: "var(--color-canvas)",
              outline: "none",
              boxSizing: "border-box",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = passwordError ? "var(--color-error)" : "var(--color-navy)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = passwordError ? "var(--color-error)" : "var(--color-border)"; }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", padding: 4,
              display: "flex", alignItems: "center", color: "var(--color-secondary)",
            }}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {passwordError && (
          <p role="alert" style={{ fontFamily: "var(--font-roboto)", fontSize: 12, color: "var(--color-error)", margin: "4px 0 0" }}>
            {passwordError}
          </p>
        )}
        {!passwordError && mode === "signup" && (
          <p style={{ fontFamily: "var(--font-roboto)", fontSize: 12, color: "var(--color-secondary)", margin: "4px 0 0", lineHeight: 1.5 }}>
            Use a unique password. Your account protects sensitive research data.
          </p>
        )}

        {/* Forgot password - sign-in only */}
        {mode === "signin" && !forgotOpen && (
          <div style={{ textAlign: "right", marginTop: 6 }}>
            <button
              type="button"
              onClick={() => { setForgotOpen(true); setForgotEmail(email); setForgotSent(false); setForgotError(""); setEmailError(""); setPasswordError(""); setFormError(""); }}
              style={{ background: "none", border: "none", padding: 0, fontFamily: "var(--font-roboto)", fontSize: 12, color: "var(--color-navy)", cursor: "pointer", textDecoration: "underline" }}
            >
              Forgot password?
            </button>
          </div>
        )}

        {/* Inline forgot-password form */}
        {forgotOpen && (
          <div style={{ marginTop: 12, padding: "14px 16px", backgroundColor: "var(--color-canvas)", borderRadius: 8, border: "1px solid var(--color-border)" }}>
            {forgotSent ? (
              <p style={{ fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-success)", margin: 0 }}>
                Check your email for a password reset link.
              </p>
            ) : (
              <>
                <p style={{ fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-body)", margin: "0 0 10px" }}>
                  Enter your email and we&apos;ll send a reset link.
                </p>
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => { setForgotEmail(e.target.value); setForgotError(""); }}
                  placeholder="Your email"
                  aria-label="Email for password reset"
                  style={{ display: "block", width: "100%", height: 40, border: `1px solid ${forgotError ? "var(--color-error)" : "var(--color-border)"}`, borderRadius: 8, padding: "0 12px", fontFamily: "var(--font-roboto)", fontSize: 13, color: "var(--color-body)", backgroundColor: "var(--color-canvas)", outline: "none", boxSizing: "border-box", marginBottom: forgotError ? 4 : 8 }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = forgotError ? "var(--color-error)" : "var(--color-navy)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = forgotError ? "var(--color-error)" : "var(--color-border)"; }}
                />
                {forgotError && (
                  <p role="alert" style={{ fontFamily: "var(--font-roboto)", fontSize: 12, color: "var(--color-error)", margin: "0 0 8px" }}>
                    {forgotError}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={forgotLoading}
                    style={{ flex: 1, height: 38, backgroundColor: "var(--color-navy)", color: "#fff", border: "none", borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                  >
                    {forgotLoading ? "Sending…" : "Send reset link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setForgotOpen(false); setForgotError(""); setFormError(""); }}
                    style={{ height: 38, padding: "0 14px", backgroundColor: "transparent", color: "var(--color-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontFamily: "var(--font-roboto)", fontSize: 13, cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!forgotOpen && (
          <button
            type="submit"
            disabled={loading}
            style={{
              display: "block",
              width: "100%",
              height: 44,
              minHeight: 44,
              backgroundColor: loading ? "var(--color-navy-dim)" : "var(--color-navy)",
              color: "var(--color-surface)",
              border: "none",
              borderRadius: 8,
              fontFamily: "var(--font-roboto)",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading ? "not-allowed" : "pointer",
              marginTop: 12,
              transition: "background-color 150ms ease",
            }}
            onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLElement).style.backgroundColor = "#2E4A6F"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = loading ? "var(--color-navy-dim)" : "var(--color-navy)"; }}
            aria-busy={loading}
          >
            {loading ? "Please wait…" : mode === "signin" ? "Continue with email" : "Create account"}
          </button>
        )}

        {formError && (
          <p
            role="alert"
            style={{
              fontFamily: "var(--font-roboto)",
              fontWeight: 400,
              fontSize: 12,
              color: "var(--color-error)",
              margin: "8px 0 0",
            }}
          >
            {formError}
          </p>
        )}
        </form>

        <p
          style={{
            fontFamily: "var(--font-roboto)",
            fontWeight: 400,
            fontSize: 12,
            color: "var(--color-secondary)",
            textAlign: "center",
            margin: "12px 0 0",
          }}
        >
          {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
          <a
            href={mode === "signin" ? "/login?mode=signup" : "/login"}
            onClick={(e) => { e.preventDefault(); setMode(mode === "signin" ? "signup" : "signin"); setEmailError(""); setPasswordError(""); setFormError(""); setForgotOpen(false); }}
            style={{ color: "var(--color-navy)", textDecoration: "underline" }}
          >
            {mode === "signin" ? "Sign up" : "Sign in"}
          </a>
        </p>
      </div>

      {/* Footer */}
      <p
        style={{
          fontFamily: "var(--font-roboto)",
          fontSize: 12,
          color: "var(--color-secondary)",
          textAlign: "center",
          marginTop: 20,
        }}
      >
        By signing in, you agree to Canopy&apos;s{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-navy)", textDecoration: "underline" }}>
          privacy-first principles
        </a>
        .
      </p>

    </div>
  );
}
