"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getPostAuthDestination } from "@/lib/postAuthRedirect";
import { finishGoogleCalendarConnect } from "@/lib/google-calendar";

// After OAuth sign-in, Supabase redirects here with ?code=... (PKCE flow).
// We exchange the code for a session (saving Google Calendar tokens server-side
// when this was a calendar connection), then route to dashboard or onboarding.

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    const oauthErrorDesc = url.searchParams.get("error_description") ?? "";

    // The auth provider sends ?error=... when the provider is disabled or the user cancels.
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

      const user = data.session.user;
      // A "Connect Google Calendar" round trip: hand the Google tokens to the server.
      await finishGoogleCalendarConnect(data.session).catch((e) => console.error("[Google Calendar]", e));

      // Honor `next` if provided; otherwise route by LC membership
      if (safeNext !== "/") {
        router.replace(safeNext);
        return;
      }
      const destination = await getPostAuthDestination(user.id);
      // New account from Google: start onboarding with the name Google gave us.
      const googleName = (user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined;
      if (destination === "/onboarding" && googleName) {
        try { localStorage.setItem("aiesec_signup_name", googleName); } catch { /* storage blocked */ }
      }
      router.replace(destination);
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
