"use client";

import { useEffect, useState } from "react";
import { Globe2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { PRODUCTS } from "@/lib/products";
import { pace, PACE_LABEL, termProgress } from "@/lib/mcPace";
import { formatDay } from "@/lib/dates";
import type { Department, UserRole } from "@/types";

interface Message { id: string; kind: "announcement" | "nudge"; body: string; created_at: string }
interface TargetRow { product: string; metric: "approved" | "realized"; target: number; actual: number }

/**
 * What the LC's MC sent: announcements and nudges for everyone in the LC, and
 * the national targets with pace for the LCP and VPs (VPs: their products,
 * whose exchanges they can see). Hidden when the LC isn't linked to an MC.
 */
export default function NationalCard({ projectId, role, departments, ledDepartmentIds }: {
  projectId: string | null; role: UserRole; departments: Department[]; ledDepartmentIds: string[];
}) {
  const [mc, setMc] = useState<{ id: string; name: string; termStart: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const exec = role === "president" || role === "vp";
  const ledKey = ledDepartmentIds.join(",");

  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      // Missing before migration 20261108008, or not linked: the card stays hidden.
      const { data: nat, error } = await supabase.rpc("lc_national", { p_project_id: projectId });
      const row = !error && Array.isArray(nat) ? (nat[0] as { mc_id: string; mc_name: string; term_start: string } | undefined) : undefined;
      if (!row) { if (!cancelled) setMc(null); return; }
      const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const [msgs, tgt, ex] = await Promise.all([
        supabase.from("mc_messages").select("id, kind, body, created_at, project_id").eq("mc_id", row.mc_id)
          .gte("created_at", since).order("created_at", { ascending: false }).limit(10),
        exec ? supabase.from("mc_lc_targets").select("product, metric, target").eq("project_id", projectId).eq("mc_id", row.mc_id).eq("term_start", row.term_start)
             : Promise.resolve({ data: [], error: null }),
        exec ? supabase.from("exchanges").select("product, approved_at, realized_at").eq("project_id", projectId)
             : Promise.resolve({ data: [], error: null }),
      ]);
      if (cancelled) return;
      // Messages for every linked LC, or for this one (someone in two LCs sees each LC's own).
      setMessages(((msgs.data ?? []) as (Message & { project_id: string | null })[])
        .filter((m) => m.project_id === null || m.project_id === projectId).slice(0, 3));
      const mine = role === "president" ? null
        : new Set(departments.filter((d) => ledKey.split(",").includes(d.id)).flatMap((d) => d.products));
      const exchanges = (ex.data ?? []) as { product: string; approved_at: string | null; realized_at: string | null }[];
      const count = (product: string, metric: "approved" | "realized") =>
        exchanges.filter((e) => e.product === product && (e[`${metric}_at`] ?? "") >= row.term_start).length;
      setTargets(((tgt.data ?? []) as { product: string; metric: "approved" | "realized"; target: number }[])
        .filter((t) => !mine || mine.has(t.product))
        .map((t) => ({ ...t, actual: count(t.product, t.metric) })));
      setMc({ id: row.mc_id, name: row.mc_name, termStart: row.term_start });
    })();
    return () => { cancelled = true; };
  }, [projectId, exec, role, departments, ledKey]);

  if (!mc || (messages.length === 0 && targets.length === 0)) return null;
  const progress = termProgress(mc.termStart);
  const label = (product: string) => PRODUCTS.find((p) => p.code === product)?.label ?? product;

  return (
    <section aria-label={`From ${mc.name}`} style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", borderBottom: "1px solid var(--color-border)" }}>
        <Globe2 size={15} color="var(--color-navy)" aria-hidden="true" />
        <h2 style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--color-navy)", margin: 0 }}>From {mc.name}</h2>
      </header>
      <div style={{ padding: "12px 14px", display: "grid", gap: 14 }}>
        {messages.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
            {messages.map((m) => (
              <li key={m.id} style={{ fontSize: 13, color: "var(--color-body)", lineHeight: 1.5 }}>
                <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{m.kind === "nudge" ? "Reminder · " : ""}{formatDay(m.created_at)}</span>
                <p style={{ margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{m.body}</p>
              </li>
            ))}
          </ul>
        )}
        {targets.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-secondary)", margin: "0 0 6px" }}>
              National targets this term
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {targets.map((t) => {
                const p = pace(t.actual, t.target, progress);
                return (
                  <li key={`${t.product}-${t.metric}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ flex: 1 }}>{label(t.product)} {t.metric === "approved" ? "approvals" : "realizations"}</span>
                    <strong style={{ fontVariantNumeric: "tabular-nums" }}>{t.actual} / {t.target}</strong>
                    {p && <span title={`${p.expected} expected by now`} style={{ fontSize: 11, fontWeight: 600, color: p.status === "behind" ? "var(--color-error)" : "var(--color-secondary)" }}>{PACE_LABEL[p.status]}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
