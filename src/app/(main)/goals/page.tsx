"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { useProject } from "@/context/ProjectContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Button, ErrorText, Panel } from "@/components/lc/ui";
import { GoalBar, GoalModal, describeMetric, useGoals, type GoalWithProgress } from "@/components/goals/GoalsShared";

export default function GoalsPage() {
  const { projectId, userId, role, departments, ledDepartmentIds, isLoading } = useProject();
  const president = role === "president";
  const manageable = president ? departments.map((d) => d.id) : ledDepartmentIds;
  const canManage = (g: GoalWithProgress) => president || (g.departmentId != null && ledDepartmentIds.includes(g.departmentId));

  const [version, setVersion] = useState(0);
  const { goals, error, loading } = useGoals(isLoading ? null : projectId, version);
  const [editing, setEditing] = useState<GoalWithProgress | "new" | null>(null);
  const [termStart, setTermStart] = useState(() => `${new Date().getFullYear()}-02-01`);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    let cancelled = false;
    supabase.rpc("lc_term_start", { p_project_id: projectId }).then(({ data }) => { if (!cancelled && data) setTermStart(data as string); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Clicks show at once (offsets) and are written one by one as +1 / −1, so
  // quick repeated clicks all count.
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const queues = useRef<Record<string, Promise<void>>>({});
  const inFlight = useRef<Record<string, number>>({});

  function bump(goal: GoalWithProgress, delta: number) {
    if (goal.current + (offsets[goal.id] ?? 0) + delta < 0) return;
    setWriteError(null);
    setOffsets((o) => ({ ...o, [goal.id]: (o[goal.id] ?? 0) + delta }));
    inFlight.current[goal.id] = (inFlight.current[goal.id] ?? 0) + 1;
    queues.current[goal.id] = (queues.current[goal.id] ?? Promise.resolve()).then(async () => {
      const { error: err } = await supabase.rpc("adjust_goal_value", { p_goal_id: goal.id, p_delta: delta });
      if (err) {
        setWriteError(`Couldn't update "${goal.title}": ${err.message}`);
        setOffsets((o) => ({ ...o, [goal.id]: (o[goal.id] ?? 0) - delta }));
      }
      inFlight.current[goal.id] -= 1;
      if (inFlight.current[goal.id] === 0) {
        // All clicks saved: reload, then drop the local offset.
        setVersion((v) => v + 1);
      }
    });
  }

  useEffect(() => {
    // A reload after the queue drained carries the saved value; clear offsets that are settled.
    setOffsets((o) => Object.fromEntries(Object.entries(o).filter(([id]) => (inFlight.current[id] ?? 0) > 0)));
  }, [goals]);

  const sections = [
    { key: "lc", title: "Whole LC", color: undefined as string | undefined, items: goals.filter((g) => !g.departmentId) },
    ...departments.map((d) => ({ key: d.id, title: d.name, color: d.color, items: goals.filter((g) => g.departmentId === d.id) })),
  ].filter((s) => s.items.length > 0);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Goals & KPIs"
        subtitle="Term targets per department. Pipeline goals update themselves as exchanges move."
        action={manageable.length > 0 || president ? <Button onClick={() => setEditing("new")}><Plus size={14} aria-hidden="true" /> New goal</Button> : undefined}
      />
      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px)", maxWidth: 1000, width: "100%" }}>
        <ErrorText>{error ? `Couldn't load goals: ${error}` : writeError}</ErrorText>
        {loading ? (
          <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
        ) : !isSupabaseConfigured || !projectId ? (
          <NeedsDatabase what="Term goals">Your LC&apos;s and departments&apos; targets for the term. Exchange goals count themselves from the pipeline.</NeedsDatabase>
        ) : sections.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>
            No goals yet.{president || manageable.length ? " Add your term targets, e.g. \"30 oGV approvals\" or \"15 new members\"." : " Your VPs and LCP set them."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sections.map((s) => (
              <Panel key={s.key} title={s.title}>
                <ul style={{ listStyle: "none", margin: 0, padding: "4px 14px 12px" }}>
                  {s.items.map((g) => (
                    <li key={g.id} style={{ padding: "10px 0", borderTop: "1px solid var(--color-border)" }}>
                      <GoalBar goal={offsets[g.id] ? { ...g, current: g.current + offsets[g.id] } : g} color={s.color} />
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontSize: 11, color: "var(--color-secondary)", flexWrap: "wrap" }}>
                        <span>{describeMetric(g)} · {g.startsOn} → {g.endsOn}</span>
                        <span style={{ flex: 1 }} />
                        {canManage(g) && g.metric === "manual" && (
                          <span style={{ display: "inline-flex", gap: 4 }}>
                            <Button variant="secondary" onClick={() => bump(g, -1)} aria-label={`Decrease ${g.title}`} style={{ height: 26, padding: "0 8px" }}>−</Button>
                            <Button variant="secondary" onClick={() => bump(g, 1)} aria-label={`Increase ${g.title}`} style={{ height: 26, padding: "0 8px" }}>+</Button>
                          </span>
                        )}
                        {canManage(g) && (
                          <button type="button" onClick={() => setEditing(g)} aria-label={`Edit ${g.title}`} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                            <Pencil size={13} color="var(--color-secondary)" />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        )}
      </div>

      {editing && projectId && userId && (
        <GoalModal
          projectId={projectId} userId={userId} departments={departments}
          allowedDepartmentIds={manageable} canSetLcWide={president} termStart={termStart}
          goal={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setVersion((v) => v + 1); }}
        />
      )}
    </div>
  );
}
