"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { mapGoal, progressRatio } from "@/lib/pipeline";
import { PRODUCTS, PRODUCT_BY_CODE, STAGES, STAGE_LABEL, type ExchangeStage, type ProductCode } from "@/lib/products";
import type { Department, Goal } from "@/types";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";
import { askConfirm } from "@/components/ui/confirm";

export interface GoalWithProgress extends Goal { current: number }

/** Goals of the LC plus their progress (counts only, via goal_progress()). */
export function useGoals(projectId: string | null, version = 0) {
  const [goals, setGoals] = useState<GoalWithProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const enabled = Boolean(projectId) && isSupabaseConfigured;

  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const [g, p] = await Promise.all([
          supabase.from("goals").select("*").eq("project_id", projectId).order("ends_on"),
          supabase.rpc("goal_progress", { p_project_id: projectId }),
        ]);
        if (g.error) throw new Error(g.error.message);
        if (p.error) throw new Error(p.error.message);
        const progress = new Map(((p.data ?? []) as { goal_id: string; current: number }[]).map((r) => [r.goal_id, Number(r.current)]));
        if (!cancelled) {
          setGoals((g.data ?? []).map(mapGoal).map((goal) => ({ ...goal, current: progress.get(goal.id) ?? 0 })));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, enabled, version]);

  return { goals, error, loading: enabled && !loaded };
}

export function describeMetric(goal: Goal): string {
  if (goal.metric === "manual") return goal.unit ? `Updated by hand · ${goal.unit}` : "Updated by hand";
  const product = goal.product ? PRODUCT_BY_CODE[goal.product].label : "All products";
  return `${product} reaching ${STAGE_LABEL[goal.stage!]}`;
}

/** Progress bar with the value printed beside it (never colour alone). */
export function GoalBar({ goal, color }: { goal: GoalWithProgress; color?: string }) {
  const ratio = progressRatio(goal.current, goal.target);
  const done = goal.current >= goal.target;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "var(--color-body)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{goal.title}</span>
        <span style={{ color: done ? "var(--color-success)" : "var(--color-body)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {goal.current} / {goal.target}{done ? " ✓" : ""}
        </span>
      </div>
      <div role="progressbar" aria-label={goal.title} aria-valuemin={0} aria-valuemax={goal.target} aria-valuenow={goal.current}
        style={{ height: 8, borderRadius: 4, backgroundColor: "var(--chart-grid)", overflow: "hidden" }}>
        <div style={{ width: `${ratio * 100}%`, height: "100%", borderRadius: 4, backgroundColor: color ?? "var(--chart-series)" }} />
      </div>
    </div>
  );
}

export function GoalModal({ projectId, userId, departments, allowedDepartmentIds, canSetLcWide, termStart, goal, onClose, onSaved }: {
  projectId: string; userId: string; departments: Department[];
  /** Departments this person may set goals for (president: all). */
  allowedDepartmentIds: string[]; canSetLcWide: boolean; termStart: string;
  goal?: Goal; onClose: () => void; onSaved: () => void;
}) {
  const termEnd = (() => { const d = new Date(termStart + "T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  const [title, setTitle] = useState(goal?.title ?? "");
  const [departmentId, setDepartmentId] = useState(goal?.departmentId ?? (canSetLcWide ? "" : allowedDepartmentIds[0] ?? ""));
  const [metric, setMetric] = useState<Goal["metric"]>(goal?.metric ?? "pipeline");
  const [product, setProduct] = useState<ProductCode | "">(goal?.product ?? "");
  const [stage, setStage] = useState<ExchangeStage>(goal?.stage ?? "approved");
  const [target, setTarget] = useState(goal ? String(goal.target) : "");
  const [unit, setUnit] = useState(goal?.unit ?? "");
  const [startsOn, setStartsOn] = useState(goal?.startsOn ?? termStart);
  const [endsOn, setEndsOn] = useState(goal?.endsOn ?? termEnd);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dept = departments.find((d) => d.id === departmentId);
  const productChoices = PRODUCTS.filter((p) => !dept || dept.products.length === 0 || dept.products.includes(p.code));

  async function save() {
    const value = Number(target);
    if (!title.trim()) { setError("Give the goal a title."); return; }
    if (!(value > 0)) { setError("The target must be greater than zero."); return; }
    if (endsOn < startsOn) { setError("The end date can't be before the start date."); return; }
    setSaving(true);
    setError(null);
    try {
      const fields = {
        title: title.trim(), department_id: departmentId || null, metric,
        product: metric === "pipeline" ? product || null : null,
        stage: metric === "pipeline" ? stage : null,
        target: value, unit: unit.trim() || null, starts_on: startsOn, ends_on: endsOn,
      };
      const { error: err } = goal
        ? await supabase.from("goals").update(fields).eq("id", goal.id)
        : await supabase.from("goals").insert({ ...fields, project_id: projectId, created_by: userId });
      if (err) throw new Error(err.message);
      onSaved();
    } catch (e) {
      setError(`Couldn't save the goal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!goal || !(await askConfirm(`Delete "${goal.title}"?`))) return;
    setDeleting(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("goals").delete().eq("id", goal.id);
      if (err) throw new Error(err.message);
      onSaved();
    } catch (e) {
      setError(`Couldn't delete the goal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal
      title={goal ? "Edit goal" : "New goal"} onClose={onClose}
      footer={<>
        {goal && <Button variant="danger" onClick={remove} disabled={deleting} style={{ marginRight: "auto" }}>{deleting ? "Deleting…" : "Delete"}</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save goal"}</Button>
      </>}
    >
      <Field label="Goal" htmlFor="goal-title">
        <input id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 30 oGV approvals this term" style={inputStyle} autoFocus />
      </Field>
      <Field label="Department" htmlFor="goal-dept">
        <select id="goal-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={selectStyle}>
          {canSetLcWide && <option value="">Whole LC</option>}
          {departments.filter((d) => allowedDepartmentIds.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <div role="radiogroup" aria-label="How progress is measured" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <Button variant={metric === "pipeline" ? "primary" : "secondary"} aria-pressed={metric === "pipeline"} onClick={() => setMetric("pipeline")} style={{ flex: 1 }}>Count from the pipeline</Button>
        <Button variant={metric === "manual" ? "primary" : "secondary"} aria-pressed={metric === "manual"} onClick={() => setMetric("manual")} style={{ flex: 1 }}>Update by hand</Button>
      </div>
      {metric === "pipeline" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Product" htmlFor="goal-product">
            <select id="goal-product" value={product} onChange={(e) => setProduct(e.target.value as ProductCode | "")} style={selectStyle}>
              <option value="">{dept ? "All of the department's products" : "All products"}</option>
              {productChoices.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Counts exchanges reaching" htmlFor="goal-stage">
            <select id="goal-stage" value={stage} onChange={(e) => setStage(e.target.value as ExchangeStage)} style={selectStyle}>
              {STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </Field>
        </div>
      ) : (
        <Field label="Unit (optional)" htmlFor="goal-unit">
          <input id="goal-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. members, partners, €" style={inputStyle} />
        </Field>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label="Target" htmlFor="goal-target"><input id="goal-target" type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} style={inputStyle} /></Field>
        <Field label="From" htmlFor="goal-from"><input id="goal-from" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} style={inputStyle} /></Field>
        <Field label="To" htmlFor="goal-to"><input id="goal-to" type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} style={inputStyle} /></Field>
      </div>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
