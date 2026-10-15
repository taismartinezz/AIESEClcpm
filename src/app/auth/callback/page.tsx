"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { getPostAuthDestination } from "@/lib/postAuthRedirect";

// After Google OAuth, Supabase redirects here with ?code=... (PKCE flow).
// We exchange the code for a session, store Google tokens for Calendar/Gmail,
// then route to dashboard or onboarding.

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    const oauthErrorDesc = url.searchParams.get("error_description") ?? "";

    // Supabase / Google sends ?error=... when the provider is disabled or the user cancels.
    // Forward the description so the login page can show a specific message.
    if (oauthError || !code) {
      const params = new URLSearchParams({ error: oauthError ?? "oauth_failed" });
      if (oauthErrorDesc) params.set("error_description", oauthErrorDesc);
      router.replace(`/login?${params.toString()}`);
      return;
    }

    // Safe `next` param -- only accept relative paths to prevent open redirects
    const rawNext = url.searchParams.get("next") ?? "/";
    const safeNext = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

    (async () => {
      const { data, error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exchErr || !data.session) {
        const params = new URLSearchParams({ error: "session_failed" });
        if (exchErr?.message) params.set("error_description", exchErr.message);
        router.replace(`/login?${params.toString()}`);
        return;
      }

      const { session } = data;
      const user = session.user;

      // Persist Google tokens so Calendar/Gmail API routes can use them
      if (session.provider_token && isSupabaseConfigured) {
        const expiresAt = session.expires_at
          ? new Date(session.expires_at * 1000).toISOString()
          : null;
        await supabase.from("user_profiles").update({
          google_access_token: session.provider_token,
          google_refresh_token: session.provider_refresh_token ?? null,
          google_token_expiry: expiresAt,
        }).eq("id", user.id);
      }

      // Honor `next` if provided; otherwise route by lab membership
      if (safeNext !== "/") {
        router.replace(safeNext);
        return;
      }
      router.replace(await getPostAuthDestination(user.id));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--color-canvas)",
        fontFamily: "var(--font-roboto)",
        fontSize: 14,
        color: "var(--color-secondary)",
      }}
    >
      Signing you in&hellip;
    </div>
  );
}
