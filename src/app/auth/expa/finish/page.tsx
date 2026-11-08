"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getPostAuthDestination } from "@/lib/postAuthRedirect";

// Last step of "Continue with EXPA": /auth/expa/callback sends the browser here
// with a one-time sign-in token in the fragment (#token_hash=…). Trade it for a
// session, then go to the dashboard or onboarding.
export default function ExpaFinishPage() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, "", window.location.pathname);   // the token is single-use; don't keep it around
    const tokenHash = params.get("token_hash");
    const fail = (description: string) =>
      router.replace(`/login?${new URLSearchParams({ error: "expa", error_description: description })}`);
    if (!tokenHash) { fail("The sign-in link was incomplete. Try Continue with EXPA again."); return; }

    (async () => {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      if (error || !data.user) { fail(error?.message ?? "Couldn't finish signing in."); return; }
      const destination = await getPostAuthDestination(data.user.id);
      const name = params.get("name");
      if (destination === "/onboarding" && name) {
        try { localStorage.setItem("aiesec_signup_name", name); } catch { /* storage blocked */ }
      }
      router.replace(destination);
    })();
  }, [router]);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--color-canvas)", fontFamily: "var(--font-roboto)", fontSize: 14, color: "var(--color-secondary)" }}>
      Signing you in with EXPA&hellip;
    </div>
  );
}
