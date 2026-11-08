"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogOut } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { ACTIVE_LC_STORAGE_KEY } from "@/context/ProjectContext";
import BrandLogo from "@/components/ui/BrandLogo";
import { APP_NAME } from "@/lib/brand";

/**
 * The national (MC) space: its own header, none of the LC pages. MC members
 * aren't in any LC through the MC, so the LC sidebar, workspace switcher and
 * dashboard mean nothing to them. People who are also in an LC get a link back;
 * the others a way to join or create one.
 */
export default function McShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(!isSupabaseConfigured);
  const [inAnLc, setInAnLc] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/login"); return; }
      const { data } = await supabase.from("team_members").select("project_id").eq("user_id", session.user.id).limit(1);
      if (cancelled) return;
      const member = (data ?? []).length > 0;
      // Someone only on the MC: forget any LC this browser remembered from before.
      if (!member) {
        try { [ACTIVE_LC_STORAGE_KEY, "aiesec_project"].forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
      }
      setInAnLc(member);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function signOut() {
    await supabase.auth.signOut();
    try { ["aiesec_authed", "aiesec_project", "aiesec_user", ACTIVE_LC_STORAGE_KEY].forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
    router.replace("/login");
  }

  const link: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 10px", borderRadius: 7,
    fontSize: 13, fontWeight: 600, color: "var(--color-navy)", background: "none", border: "1px solid var(--color-border)", cursor: "pointer", textDecoration: "none",
  };

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--color-canvas)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px clamp(16px, 3vw, 28px)", borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)" }}>
        <Link href="/mc" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", flex: 1, minWidth: 0 }}>
          <BrandLogo size={24} />
          <span style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 17, color: "var(--color-navy)" }}>{APP_NAME}</span>
          <span style={{ fontSize: 13, color: "var(--color-secondary)", whiteSpace: "nowrap" }}>· National</span>
        </Link>
        {ready && (inAnLc
          ? <Link href="/" style={link}><ArrowLeft size={14} aria-hidden="true" /> Your LC</Link>
          : <Link href="/onboarding" style={link}>Join or create an LC</Link>)}
        <button type="button" onClick={signOut} style={link}><LogOut size={14} aria-hidden="true" /> Sign out</button>
      </header>
      <main className="flex-1 overflow-auto">{ready ? children : null}</main>
    </div>
  );
}
