"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarCheck, TrendingDown, TrendingUp } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { localIsoDate, mapExchange, stuckExchanges, weekOverWeek, weekStart } from "@/lib/pipeline";
import { PRODUCT_BY_CODE, STAGE_LABEL } from "@/lib/products";
import { useLcMembers } from "@/hooks/useLcMembers";
import StuckActions from "@/components/pipeline/StuckActions";
import type { Department, Exchange, UserRole } from "@/types";

interface OverdueTask { id: string; title: string; departmentId: string | null; dueDate: string }

/**
 * What an LCP (or VP) checks on Monday: approvals and realizations this week
 * against last week, exchanges stuck in a stage, and overdue tasks per
 * department with the VP responsible. VPs see only their departments.
 */
export default function ThisWeekCard({ projectId, role, departments, ledDepartmentIds }: {
  projectId: string | null; role: UserRole; departments: Department[]; ledDepartmentIds: string[];
}) {
  const { names } = useLcMembers(projectId);
  const [state, setState] = useState<{ exchanges: Exchange[]; overdue: OverdueTask[]; error: string | null; loaded: boolean }>(
    { exchanges: [], overdue: [], error: null, loaded: false });

  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const [ex, tasks] = await Promise.all([
          // RLS already limits a VP to their departments' exchanges.
          supabase.from("exchanges").select("*").eq("project_id", projectId),
          supabase.from("tasks").select("id, title, department_id, due_date")
            .eq("project_id", projectId).neq("status", "done").eq("archived", false)
            .is("parent_id", null).lt("due_date", localIsoDate(new Date())),
        ]);
        if (ex.error) throw new Error(ex.error.message);
        if (tasks.error) throw new Error(tasks.error.message);
        if (cancelled) return;
        setState({
          exchanges: (ex.data ?? []).map(mapExchange),
          overdue: (tasks.data ?? []).map((t) => ({ id: t.id as string, title: t.title as string, departmentId: (t.department_id as string | null) ?? null, dueDate: t.due_date as string })),
          error: null, loaded: true,
        });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loaded: true }));
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const { exchanges, overdue, error, loaded } = state;
  const week = weekOverWeek(exchanges);
  const stuck = stuckExchanges(exchanges);
  const scope = role === "president" ? null : new Set(ledDepartmentIds);
  const overdueShown = overdue.filter((t) => !scope || (t.departmentId && scope.has(t.departmentId)));
  const byDept = [...overdueShown.reduce((m, t) => m.set(t.departmentId, (m.get(t.departmentId) ?? 0) + 1), new Map<string | null, number>())]
    .map(([id, n]) => {
      const d = departments.find((x) => x.id === id);
      return { id, n, name: d?.name ?? "Tasks with no department", color: d?.color ?? "var(--color-border)", vp: d?.vpUserId ? names[d.vpUserId] : null };
    })
    .sort((a, b) => b.n - a.n);

  return (
    <section aria-label="This week" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", borderBottom: "1px solid var(--color-border)" }}>
        <CalendarCheck size={15} color="var(--color-navy)" aria-hidden="true" />
        <h2 style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--color-navy)", margin: 0 }}>This week{scope ? " in your departments" : ""}</h2>
        {/* Spell out the window: an approval last Saturday counts under "last week". */}
        <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>since {new Date(weekStart(new Date()) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
      </header>
      <div style={{ padding: "12px 14px" }}>
        {error ? (
          <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: 0 }}>Couldn&apos;t load: {error}</p>
        ) : !loaded ? (
          <div className="animate-pulse" style={{ height: 80, borderRadius: 6, backgroundColor: "var(--color-dimmed-bg)" }} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <div>
              <h3 style={h3}>Exchanges</h3>
              <Trend label="Approved" now={week.approvedThisWeek} before={week.approvedLastWeek} />
              <Trend label="Realized" now={week.realizedThisWeek} before={week.realizedLastWeek} />
              <Link href="/pipeline" style={link}>Open the pipeline <ArrowRight size={12} aria-hidden="true" /></Link>
            </div>
            <div>
              <h3 style={h3}>Stuck exchanges</h3>
              {stuck.length === 0 ? <p style={muted}>None waiting 14+ days.</p> : (
                <ul style={list}>
                  {stuck.slice(0, 4).map(({ exchange: e, days }) => (
                    <li key={e.id} style={{ fontSize: 12, color: "var(--color-body)" }}>
                      <AlertTriangle size={11} color="var(--color-warning)" aria-hidden="true" style={{ verticalAlign: "-1px", marginRight: 4 }} />
                      <strong>{e.personName}</strong> · {PRODUCT_BY_CODE[e.product].label} · {STAGE_LABEL[e.stage].toLowerCase()} for {days} days
                      <span style={{ color: "var(--color-secondary)" }}> · {e.ownerId ? names[e.ownerId] ?? "owner left the LC" : "no owner"}</span>
                      <div style={{ margin: "2px 0 0 15px" }}><StuckActions exchange={e} days={days} ownerName={e.ownerId ? names[e.ownerId] ?? null : null} /></div>
                    </li>
                  ))}
                  {stuck.length > 4 && <li style={muted}>and {stuck.length - 4} more</li>}
                </ul>
              )}
            </div>
            <div>
              <h3 style={h3}>Overdue tasks{scope ? "" : " by department"}</h3>
              {byDept.length === 0 ? <p style={muted}>Nothing overdue.</p> : (
                <ul style={list}>
                  {byDept.map((d) => (
                    <li key={d.id ?? "none"} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-body)" }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: d.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.name}{d.vp ? <span style={{ color: "var(--color-secondary)" }}> · {d.vp}</span> : null}
                      </span>
                      <strong style={{ color: "var(--color-error)", fontVariantNumeric: "tabular-nums" }}>{d.n}</strong>
                    </li>
                  ))}
                </ul>
              )}
              {byDept.length > 0 && <Link href="/tasks" style={link}>Open tasks <ArrowRight size={12} aria-hidden="true" /></Link>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Trend({ label, now, before }: { label: string; now: number; before: number }) {
  const diff = now - before;
  const Icon = diff >= 0 ? TrendingUp : TrendingDown;
  return (
    <p style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 0 6px" }}>
      <span style={{ fontSize: 22, fontWeight: 600, color: "var(--color-body)", fontVariantNumeric: "tabular-nums", minWidth: 28 }}>{now}</span>
      <span style={{ fontSize: 12, color: "var(--color-body)" }}>{label}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--color-secondary)" }}>
        {diff !== 0 && <Icon size={11} aria-hidden="true" />}
        {before} last week
      </span>
    </p>
  );
}

const h3: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: "0 0 8px" };
const muted: React.CSSProperties = { fontSize: 12, color: "var(--color-secondary)", margin: 0 };
const list: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 };
const link: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--color-navy)", textDecoration: "none", marginTop: 8 };
