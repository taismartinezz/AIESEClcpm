"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { mapStep, stepsFor, type OnboardingStep } from "@/lib/lifecycle";
import type { Department } from "@/types";
import type { LcMember } from "@/hooks/useLcMembers";
import { Button, ErrorText, Panel, inputStyle, selectStyle } from "@/components/lc/ui";

type Done = Record<string, Set<string>>;   // user_id → step ids

async function loadOnboarding(projectId: string) {
  const [steps, done] = await Promise.all([
    supabase.from("onboarding_steps").select("*").eq("project_id", projectId).order("sort_order"),
    supabase.from("member_onboarding").select("user_id, step_id").eq("project_id", projectId),
  ]);
  if (steps.error) throw new Error(steps.error.message);
  if (done.error) throw new Error(done.error.message);
  const map: Done = {};
  for (const r of done.data ?? []) (map[r.user_id as string] ??= new Set()).add(r.step_id as string);
  return { steps: (steps.data ?? []).map(mapStep), done: map };
}

async function toggleStep(projectId: string, userId: string, stepId: string, isDone: boolean) {
  const { error } = isDone
    ? await supabase.from("member_onboarding").delete().eq("user_id", userId).eq("step_id", stepId)
    : await supabase.from("member_onboarding").insert({ project_id: projectId, user_id: userId, step_id: stepId });
  if (error) throw new Error(error.message);
}

function Checklist({ steps, done, onToggle, busy }: { steps: OnboardingStep[]; done: Set<string>; onToggle: (s: OnboardingStep) => void; busy: string | null }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {steps.map((s) => {
        const isDone = done.has(s.id);
        return (
          <li key={s.id}>
            <button type="button" role="checkbox" aria-checked={isDone} onClick={() => onToggle(s)} disabled={busy === s.id}
              style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
              {isDone ? <CheckCircle2 size={16} color="var(--color-success, #00A86B)" aria-hidden="true" /> : <Circle size={16} color="var(--color-secondary)" aria-hidden="true" />}
              <span>
                <span style={{ display: "block", fontSize: 13, color: "var(--color-body)", textDecoration: isDone ? "line-through" : undefined }}>{s.title}</span>
                {s.description && <span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)" }}>{s.description}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Exec board: edit the checklist and tick steps for the members they look after. */
export default function OnboardingTab({ projectId, members, departments, canEditSteps }: {
  projectId: string; members: LcMember[]; departments: Department[]; canEditSteps: boolean;
}) {
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [done, setDone] = useState<Done>({});
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [newStep, setNewStep] = useState({ title: "", department_id: "" });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOnboarding(projectId)
      .then((r) => { if (!cancelled) { setSteps(r.steps); setDone(r.done); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(`Couldn't load onboarding: ${e instanceof Error ? e.message : String(e)}`); });
    return () => { cancelled = true; };
  }, [projectId, version]);

  async function act(key: string, what: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try { await fn(); setVersion((v) => v + 1); }
    catch (e) { setError(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  }

  const people = members.filter((m) => m.role !== "president");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
      <Panel title="Checklist for new members">
        <div style={{ padding: 14 }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {steps.map((s) => (
              <li key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ flex: 1 }}>{s.title}{s.departmentId && <span style={{ color: "var(--color-secondary)" }}> · {departments.find((d) => d.id === s.departmentId)?.name}</span>}</span>
                {canEditSteps && (
                  <button type="button" aria-label={`Remove ${s.title}`} onClick={() => act(s.id, "remove the step", async () => {
                    const { error: err } = await supabase.from("onboarding_steps").delete().eq("id", s.id);
                    if (err) throw new Error(err.message);
                  })} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Trash2 size={12} color="var(--color-secondary)" /></button>
                )}
              </li>
            ))}
          </ul>
          {canEditSteps && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <input aria-label="New step" placeholder="New step, e.g. Shadow a tabling shift" value={newStep.title} onChange={(e) => setNewStep({ ...newStep, title: e.target.value })} style={{ ...inputStyle, flex: "1 1 180px", height: 34 }} />
              <select aria-label="For department" value={newStep.department_id} onChange={(e) => setNewStep({ ...newStep, department_id: e.target.value })} style={{ ...selectStyle, width: 150, height: 34 }}>
                <option value="">Everyone</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <Button disabled={!newStep.title.trim() || busy === "new"} onClick={() => act("new", "add the step", async () => {
                const { error: err } = await supabase.from("onboarding_steps").insert({ project_id: projectId, title: newStep.title.trim(), department_id: newStep.department_id || null, sort_order: steps.length + 1 });
                if (err) throw new Error(err.message);
                setNewStep({ title: "", department_id: "" });
              })}><Plus size={13} aria-hidden="true" /> Add</Button>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Progress">
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {people.length === 0 && <li style={{ padding: 14, fontSize: 13, color: "var(--color-secondary)" }}>No members to onboard yet.</li>}
          {people.map((m) => {
            const mine = stepsFor(steps, m.departmentId);
            const n = mine.filter((s) => done[m.id]?.has(s.id)).length;
            return (
              <li key={m.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                <button type="button" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}
                  style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "9px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--color-body)", textAlign: "left" }}>
                  <span style={{ flex: 1 }}>{m.name}</span>
                  <span style={{ fontSize: 12, color: n === mine.length ? "var(--color-success, #00A86B)" : "var(--color-secondary)", fontVariantNumeric: "tabular-nums" }}>{n}/{mine.length}</span>
                </button>
                {open === m.id && (
                  <div style={{ padding: "0 14px 12px" }}>
                    <Checklist steps={mine} done={done[m.id] ?? new Set()} busy={busy}
                      onToggle={(s) => act(s.id, "update the checklist", () => toggleStep(projectId, m.id, s.id, Boolean(done[m.id]?.has(s.id))))} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Dashboard card for a member until their onboarding is complete. */
export function MyOnboardingCard({ projectId, userId, departmentId }: { projectId: string | null; userId: string | null; departmentId: string | null }) {
  const [state, setState] = useState<{ steps: OnboardingStep[]; done: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!projectId || !userId || !isSupabaseConfigured) return;
    let cancelled = false;
    loadOnboarding(projectId)
      .then((r) => { if (!cancelled) setState({ steps: stepsFor(r.steps, departmentId), done: r.done[userId] ?? new Set() }); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [projectId, userId, departmentId, version]);

  if (error) return <p role="alert" style={{ fontSize: 12, color: "var(--color-error)" }}>Couldn&apos;t load your onboarding: {error}</p>;
  if (!state || state.steps.length === 0 || state.steps.every((s) => state.done.has(s.id))) return null;
  const n = state.steps.filter((s) => state.done.has(s.id)).length;

  return (
    <section aria-label="Your onboarding" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px" }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--color-navy)", margin: "0 0 2px" }}>Your onboarding</h2>
      <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "0 0 10px" }}>{n} of {state.steps.length} done. Tick what you&apos;ve finished.</p>
      <Checklist steps={state.steps} done={state.done} busy={busy} onToggle={async (s) => {
        setBusy(s.id);
        try { await toggleStep(projectId!, userId!, s.id, state.done.has(s.id)); setVersion((v) => v + 1); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(null); }
      }} />
    </section>
  );
}
