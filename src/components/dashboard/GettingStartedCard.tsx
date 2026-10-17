"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { UserRole } from "@/types";
import { DemoLcButton } from "@/components/lc/DemoLc";

interface Item { id: string; label: string; href: string; done: boolean }

const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  return n ?? 0;
};

/** What "set up" means for each role, checked against real data. */
async function loadItems(role: UserRole, projectId: string, userId: string, ledDepartmentIds: string[]): Promise<Item[]> {
  const head = { count: "exact" as const, head: true };
  if (role === "president") {
    const [deps, vps, exchanges, partners, goals, proj] = await Promise.all([
      count(supabase.from("departments").select("id", head).eq("project_id", projectId)),
      count(supabase.from("team_members").select("id", head).eq("project_id", projectId).eq("role", "vp")),
      count(supabase.from("exchanges").select("id", head).eq("project_id", projectId)),
      count(supabase.from("partners").select("id", head).eq("project_id", projectId)),
      count(supabase.from("goals").select("id", head).eq("project_id", projectId)),
      supabase.from("projects").select("mc_id").eq("id", projectId).maybeSingle(),
    ]);
    return [
      { id: "departments", label: "Create your departments", href: "/settings#departments", done: deps > 0 },
      { id: "vps", label: "Invite your VPs", href: "/settings", done: vps > 0 },
      { id: "import", label: "Import a tracker from Google Sheets", href: "/import", done: exchanges + partners > 0 },
      { id: "goals", label: "Set this term's goals", href: "/goals", done: goals > 0 },
      { id: "mc", label: "Link your LC to your MC", href: "/settings#national", done: Boolean(proj.data?.mc_id) },
    ];
  }
  if (role === "vp") {
    const [exchanges, partners, goals, events, slots, checkins] = await Promise.all([
      count(supabase.from("exchanges").select("id", head).eq("project_id", projectId)),
      count(supabase.from("partners").select("id", head).eq("project_id", projectId)),
      ledDepartmentIds.length ? count(supabase.from("goals").select("id", head).eq("project_id", projectId).in("department_id", ledDepartmentIds)) : Promise.resolve(0),
      count(supabase.from("lc_events").select("id", head).eq("project_id", projectId).eq("created_by", userId)),
      count(supabase.from("tabling_slots").select("id", head).eq("project_id", projectId).eq("created_by", userId)),
      count(supabase.from("checkins").select("id", head).eq("project_id", projectId).eq("user_id", userId)),
    ]);
    return [
      { id: "import", label: "Import your department's tracker", href: "/import", done: exchanges + partners > 0 },
      { id: "goals", label: "Set a goal for your department", href: "/goals", done: goals > 0 },
      { id: "plan", label: "Plan an event or a tabling shift", href: "/tabling", done: events + slots > 0 },
      { id: "checkin", label: "Do your first check-in", href: "/checkin", done: checkins > 0 },
    ];
  }
  const [checkins, signups, profile] = await Promise.all([
    count(supabase.from("checkins").select("id", head).eq("project_id", projectId).eq("user_id", userId)),
    count(supabase.from("tabling_signups").select("slot_id", head).eq("project_id", projectId).eq("user_id", userId)),
    supabase.from("user_profiles").select("avatar_url, bio").eq("id", userId).maybeSingle(),
  ]);
  return [
    { id: "checkin", label: "Do your first check-in", href: "/checkin", done: checkins > 0 },
    { id: "tabling", label: "Sign up for a tabling shift", href: "/tabling", done: signups > 0 },
    { id: "profile", label: "Add a photo or a short bio", href: "/profile", done: Boolean(profile.data?.avatar_url || profile.data?.bio) },
  ];
}

const dismissKey = (projectId: string) => `aiesec_getting_started_dismissed:${projectId}`;

/** Dashboard checklist; disappears when everything is done or it's dismissed. */
export default function GettingStartedCard({ role, projectId, userId, ledDepartmentIds }: {
  role: UserRole; projectId: string | null; userId: string | null; ledDepartmentIds: string[];
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined" || !projectId) return false;
    try { return localStorage.getItem(dismissKey(projectId)) === "1"; } catch { return false; }
  });
  const ledKey = ledDepartmentIds.join(",");

  useEffect(() => {
    if (!projectId || !userId || !isSupabaseConfigured || dismissed) return;
    let cancelled = false;
    loadItems(role, projectId, userId, ledKey ? ledKey.split(",") : [])
      .then((r) => { if (!cancelled) setItems(r); })
      .catch((e: unknown) => console.warn("[getting started]", e instanceof Error ? e.message : e));
    return () => { cancelled = true; };
  }, [role, projectId, userId, ledKey, dismissed]);

  if (dismissed || !items || items.every((i) => i.done) || !projectId) return null;
  const n = items.filter((i) => i.done).length;

  function dismiss() {
    try { localStorage.setItem(dismissKey(projectId!), "1"); } catch { /* storage blocked: hides for this visit */ }
    setDismissed(true);
  }

  return (
    <section aria-label="Getting started" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h2 style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--color-navy)", margin: 0 }}>Getting started · {n} of {items.length}</h2>
        <button type="button" onClick={dismiss} aria-label="Hide getting started" style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 4 }}>
          <X size={14} color="var(--color-secondary)" />
        </button>
      </header>
      <div role="progressbar" aria-label="Getting started progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={n}
        style={{ height: 4, borderRadius: 2, backgroundColor: "var(--color-dimmed-bg)", marginBottom: 10 }}>
        <div style={{ width: `${(n / items.length) * 100}%`, height: "100%", borderRadius: 2, backgroundColor: "var(--color-navy)" }} />
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
        {items.map((i) => (
          <li key={i.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            {i.done ? <CheckCircle2 size={15} color="var(--color-success, #00A86B)" aria-hidden="true" /> : <Circle size={15} color="var(--color-secondary)" aria-hidden="true" />}
            {i.done
              ? <span style={{ color: "var(--color-secondary)", textDecoration: "line-through" }}>{i.label}</span>
              : <Link href={i.href} style={{ color: "var(--color-navy)", fontWeight: 600, textDecoration: "none" }}>{i.label}</Link>}
          </li>
        ))}
      </ul>
      {role !== "member" && (
        <p style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--color-secondary)", margin: "10px 0 0" }}>
          Want to see how it looks with data first?
          <DemoLcButton variant="button" />
        </p>
      )}
    </section>
  );
}
