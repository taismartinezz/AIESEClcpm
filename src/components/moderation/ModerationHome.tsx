"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { isAppModerator } from "@/lib/postAuthRedirect";
import BrandLogo from "@/components/ui/BrandLogo";
import FeatureRequests from "@/components/helper/FeatureRequests";

/**
 * The moderators' home: outside the LC shell, so a moderator needs no LC, MC
 * or EXPA connection. One who is also in an LC or an MC can open it from here.
 */
export default function ModerationHome() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasLc, setHasLc] = useState(false);
  const [hasMc, setHasMc] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) { router.replace("/"); return; }
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/moderators"); return; }
      if (!(await isAppModerator())) { router.replace("/"); return; }
      const [lc, mc] = await Promise.all([
        supabase.from("team_members").select("project_id").eq("user_id", session.user.id).limit(1).maybeSingle(),
        supabase.from("mc_members").select("mc_id").eq("user_id", session.user.id).limit(1).maybeSingle(),
      ]);
      setHasLc(Boolean(lc.data));
      setHasMc(Boolean(mc.data));
      setReady(true);
    });
  }, [router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/moderators");
  }

  const link: React.CSSProperties = { fontSize: 13, color: "var(--color-navy, #0263C4)", fontWeight: 600, textDecoration: "none" };

  return (
    <div style={{ minHeight: "100dvh", backgroundColor: "var(--color-canvas, #F6F8FC)", fontFamily: "var(--font-roboto)" }}>
      <header style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px clamp(16px, 3vw, 28px)",
        borderBottom: "1px solid var(--color-border, #DDE1E7)", backgroundColor: "var(--color-surface, #fff)",
      }}>
        <BrandLogo size={28} />
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, flex: 1, color: "var(--color-body)" }}>Moderation</h1>
        {ready && hasLc && <Link href="/" style={link}>Open your LC</Link>}
        {ready && hasMc && <Link href="/mc" style={link}>Open your MC</Link>}
        <button type="button" onClick={signOut} style={{ ...link, background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 400 }}>
          Sign out
        </button>
      </header>
      <main style={{ padding: "16px clamp(16px, 3vw, 28px)", maxWidth: 1000 }}>
        {ready
          ? <FeatureRequests />
          : <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg, #EEF1F5)" }} />}
      </main>
    </div>
  );
}
