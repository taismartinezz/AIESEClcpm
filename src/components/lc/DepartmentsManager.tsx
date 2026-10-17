"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Landmark } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import { AIESEC_PALETTE } from "@/lib/brand";
import { PRODUCTS } from "@/lib/products";
import { SUGGESTED_DEPARTMENTS, type SuggestedDepartment } from "@/lib/departments";
import type { Department } from "@/types";

interface ExecOption { id: string; name: string }

const inputStyle: React.CSSProperties = {
  height: 34, border: "1px solid var(--color-border)", borderRadius: 6, padding: "0 10px",
  fontSize: 13, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-canvas)",
  color: "var(--color-body)", outline: "none", minWidth: 0,
};

/**
 * President-only editor for the LC's departments: create (from scratch or from
 * the usual AIESEC suggestions), rename, recolour, assign the leading VP, pick
 * the exchange products each one runs, add and delete. New LCs start empty. RLS ("president manages departments") enforces
 * the same rule in the database.
 */
export default function DepartmentsManager() {
  const { projectId, departments, refreshDepartments } = useProject();
  const [execs, setExecs] = useState<ExecOption[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from("team_members")
        .select("user_id, role, user_profiles(name)")
        .eq("project_id", projectId)
        .in("role", ["vp", "president"]);
      if (cancelled) return;
      if (err) { setError(`Couldn't load the executive board: ${err.message}`); return; }
      setExecs((data ?? []).map((row) => {
        const p = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
        return { id: row.user_id as string, name: (p as { name?: string } | null)?.name ?? "Unknown" };
      }));
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  async function run(id: string, action: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusyId(id);
    setError(null);
    try {
      const { error: err } = await action();
      if (err) throw new Error(err.message);
      await refreshDepartments();
    } catch (e) {
      setError(`Couldn't save the department: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  function update(dep: Department, patch: Record<string, unknown>) {
    return run(dep.id, () => supabase.from("departments").update(patch).eq("id", dep.id));
  }

  async function add() {
    const name = newName.trim();
    if (!name || !projectId) return;
    const color = AIESEC_PALETTE[departments.length % AIESEC_PALETTE.length];
    await run("new", () => supabase.from("departments").insert({
      project_id: projectId, name, color, sort_order: departments.length + 1,
    }));
    setNewName("");
  }

  function addSuggested(s: SuggestedDepartment) {
    if (!projectId) return;
    return run(`suggest:${s.name}`, () => supabase.from("departments").insert({
      project_id: projectId, name: s.name, color: s.color, products: s.products,
      is_finance: s.is_finance && !departments.some((d) => d.isFinance), sort_order: departments.length + 1,
    }));
  }

  function toggleProduct(dep: Department, code: string) {
    const products = dep.products.includes(code) ? dep.products.filter((p) => p !== code) : [...dep.products, code];
    return update(dep, { products });
  }

  const suggestions = SUGGESTED_DEPARTMENTS.filter((s) => !departments.some((d) => d.name.toLowerCase() === s.name.toLowerCase()));

  function remove(dep: Department) {
    if (!window.confirm(`Delete "${dep.name}"? Its members will have no department until you reassign them.`)) return;
    return run(dep.id, () => supabase.from("departments").delete().eq("id", dep.id));
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--color-secondary)", marginTop: 0, marginBottom: 12 }}>
        Create your LC&rsquo;s departments or committees (e.g. oGX, oGT, oGV, Marketing). Every member belongs to one department and a VP can lead several. Tick the exchange products a department runs so its exchanges show in the pipeline. The department marked{" "}
        <Landmark size={11} style={{ verticalAlign: "-1px" }} aria-label="finance" /> is the one whose VP handles finance.
      </p>

      {departments.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--color-body)", margin: "0 0 12px" }}>No departments yet. Add your own below, or start from a suggestion.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {departments.map((dep) => (
          <div key={dep.id} style={{ opacity: busyId === dep.id ? 0.6 : 1 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <input
              type="color"
              value={dep.color}
              onChange={(e) => update(dep, { color: e.target.value })}
              aria-label={`Colour for ${dep.name}`}
              style={{ width: 30, height: 30, padding: 0, border: "1px solid var(--color-border)", borderRadius: 6, background: "none", cursor: "pointer" }}
            />
            <input
              value={drafts[dep.id] ?? dep.name}
              onChange={(e) => setDrafts((d) => ({ ...d, [dep.id]: e.target.value }))}
              onBlur={() => {
                const next = (drafts[dep.id] ?? dep.name).trim();
                if (next && next !== dep.name) update(dep, { name: next });
              }}
              aria-label={`Name of ${dep.name}`}
              style={{ ...inputStyle, flex: "1 1 180px" }}
            />
            <select
              value={dep.vpUserId ?? ""}
              onChange={(e) => update(dep, { vp_user_id: e.target.value || null })}
              aria-label={`VP leading ${dep.name}`}
              style={{ ...inputStyle, flex: "0 1 180px" }}
            >
              <option value="">No VP assigned</option>
              {execs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => update(dep, { is_finance: !dep.isFinance })}
              aria-pressed={dep.isFinance}
              title={dep.isFinance ? "Handles finance" : "Mark as the finance department"}
              style={{
                height: 30, width: 30, display: "flex", alignItems: "center", justifyContent: "center",
                border: `1px solid ${dep.isFinance ? "var(--color-navy)" : "var(--color-border)"}`,
                backgroundColor: dep.isFinance ? "var(--color-navy-dim)" : "transparent", borderRadius: 6, cursor: "pointer",
              }}
            >
              <Landmark size={13} color={dep.isFinance ? "var(--color-navy)" : "var(--color-secondary)"} />
            </button>
            <button
              type="button"
              onClick={() => remove(dep)}
              aria-label={`Delete ${dep.name}`}
              style={{ height: 30, width: 30, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--color-border)", backgroundColor: "transparent", borderRadius: 6, cursor: "pointer" }}
            >
              <Trash2 size={12} color="var(--color-secondary)" />
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6, paddingLeft: 38 }}>
          <div role="group" aria-label={`Exchange products run by ${dep.name}`} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PRODUCTS.map((p) => {
              const on = dep.products.includes(p.code);
              return (
                <button key={p.code} type="button" aria-pressed={on} onClick={() => toggleProduct(dep, p.code)} title={p.name}
                  style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12, cursor: "pointer",
                    border: `1px solid ${on ? "var(--color-navy)" : "var(--color-border)"}`,
                    backgroundColor: on ? "var(--color-navy-dim)" : "transparent", color: on ? "var(--color-navy)" : "var(--color-secondary)" }}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <select aria-label={`Pulse area for ${dep.name}`} value={dep.pulseArea ?? ""} onChange={(e) => update(dep, { pulse_area: e.target.value || null })}
            title="Small departments are pooled into an area for the Member Pulse"
            style={{ ...inputStyle, height: 24, fontSize: 11, padding: "0 6px" }}>
            <option value="">Pulse area: automatic</option>
            <option value="outgoing">Pulse area: Outgoing</option>
            <option value="incoming">Pulse area: Incoming</option>
            <option value="support">Pulse area: Support</option>
          </select>
          </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="New department (e.g. Partnerships)"
          aria-label="New department name"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          type="button"
          onClick={add}
          disabled={!newName.trim() || busyId === "new"}
          style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: newName.trim() ? 1 : 0.6 }}
        >
          <Plus size={13} /> Add
        </button>
      </div>

      {suggestions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 6px" }}>Suggestions</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {suggestions.map((s) => (
              <button key={s.name} type="button" onClick={() => addSuggested(s)} disabled={busyId === `suggest:${s.name}`}
                style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, padding: "4px 10px", borderRadius: 14, cursor: "pointer",
                  border: "1px dashed var(--color-border)", backgroundColor: "transparent", color: "var(--color-body)" }}>
                <Plus size={11} aria-hidden="true" /> {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", marginTop: 10, marginBottom: 0 }}>{error}</p>
      )}
    </div>
  );
}
