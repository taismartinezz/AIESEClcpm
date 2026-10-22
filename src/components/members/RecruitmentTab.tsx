"use client";

import { useEffect, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { RECRUIT_STAGES, mapRecruit, type Recruit, type RecruitStage } from "@/lib/lifecycle";
import type { Department } from "@/types";
import { Button, ErrorText, Field, Modal, Panel, inputStyle, selectStyle } from "@/components/lc/ui";
import { formatDay } from "@/lib/dates";

/** Recruitment intake: applications to join the LC, Applied → Joined. Exec board only. */
export default function RecruitmentTab({ projectId, userId, departments, onImport, version }: {
  projectId: string; userId: string; departments: Department[]; onImport: () => void; version: number;
}) {
  const [recruits, setRecruits] = useState<Recruit[]>([]);
  const [stage, setStage] = useState<RecruitStage | "open">("open");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await supabase.from("recruits").select("*").eq("project_id", projectId).order("applied_on", { ascending: false });
        if (err) throw new Error(err.message);
        if (!cancelled) { setRecruits((data ?? []).map(mapRecruit)); setError(null); }
      } catch (e) {
        if (!cancelled) setError(`Couldn't load recruitment: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, version, reload]);

  async function move(r: Recruit, next: RecruitStage) {
    setBusyId(r.id);
    setError(null);
    try {
      const { error: err } = await supabase.from("recruits").update({ stage: next }).eq("id", r.id);
      if (err) throw new Error(err.message);
      setReload((v) => v + 1);
    } catch (e) {
      setError(`Couldn't update ${r.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  const openStages = RECRUIT_STAGES.filter((s) => s.open).map((s) => s.code);
  const shown = recruits.filter((r) => (stage === "open" ? openStages.includes(r.stage) : r.stage === stage));
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "-";
  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderTop: "1px solid var(--color-border)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <div role="group" aria-label="Filter by stage" style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
          {[{ code: "open" as const, label: "In progress" }, ...RECRUIT_STAGES].map((s) => {
            const n = s.code === "open" ? recruits.filter((r) => openStages.includes(r.stage)).length : recruits.filter((r) => r.stage === s.code).length;
            const active = stage === s.code;
            return (
              <button key={s.code} type="button" aria-pressed={active} onClick={() => setStage(s.code)}
                style={{ padding: "5px 10px", borderRadius: 14, fontSize: 12, cursor: "pointer", fontWeight: active ? 700 : 500,
                  border: `1px solid ${active ? "var(--color-navy)" : "var(--color-border)"}`, backgroundColor: active ? "var(--color-navy-dim)" : "transparent", color: "var(--color-body)" }}>
                {s.label} <span style={{ color: "var(--color-secondary)" }}>{n}</span>
              </button>
            );
          })}
        </div>
        <Button variant="secondary" onClick={onImport}><Upload size={14} aria-hidden="true" /> Import applications</Button>
        <Button onClick={() => setAdding(true)}><Plus size={14} aria-hidden="true" /> Add applicant</Button>
      </div>
      <ErrorText>{error}</ErrorText>
      <Panel>
        {!loaded ? <div className="animate-pulse" style={{ height: 120, backgroundColor: "var(--color-dimmed-bg)" }} /> : shown.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>
            {recruits.length === 0 ? "No applications yet. Import your recruitment form responses, or add someone by hand." : "Nobody at this stage."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th scope="col" style={th}>Name</th><th scope="col" style={th}>Interested in</th><th scope="col" style={th}>Source</th><th scope="col" style={th}>Applied</th><th scope="col" style={th}>Stage</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} style={{ opacity: busyId === r.id ? 0.6 : 1 }}>
                    <td style={td}>
                      <strong style={{ fontWeight: 600 }}>{r.name}</strong>
                      {(r.email || r.phone) && <div style={{ fontSize: 11, color: "var(--color-secondary)" }}>{[r.email, r.phone].filter(Boolean).join(" · ")}</div>}
                    </td>
                    <td style={{ ...td, color: "var(--color-secondary)" }}>{deptName(r.departmentId)}</td>
                    <td style={{ ...td, color: "var(--color-secondary)" }}>{r.source ?? "-"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDay(r.appliedOn)}</td>
                    <td style={td}>
                      <select aria-label={`Stage for ${r.name}`} value={r.stage} disabled={busyId === r.id} onChange={(e) => move(r, e.target.value as RecruitStage)} style={{ ...selectStyle, height: 30, fontSize: 12, width: 130 }}>
                        {RECRUIT_STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                      </select>
                      {r.stage === "joined" && <div style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 3 }}>Invite them from Settings → Invite</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {adding && <AddRecruit projectId={projectId} userId={userId} departments={departments} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setReload((v) => v + 1); }} />}
    </div>
  );
}

function AddRecruit({ projectId, userId, departments, onClose, onSaved }: { projectId: string; userId: string; departments: Department[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", source: "", department_id: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    if (!form.name.trim()) { setError("Add a name."); return; }
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("recruits").insert({
        project_id: projectId, created_by: userId, name: form.name.trim(), email: form.email || null, phone: form.phone || null,
        source: form.source || null, department_id: form.department_id || null, stage: "applied",
      });
      if (err) throw new Error(err.message.includes("duplicate") ? "someone with this email already applied" : err.message);
      onSaved();
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add an applicant" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></>}>
      <Field label="Name" htmlFor="rec-name"><input id="rec-name" value={form.name} onChange={set("name")} style={inputStyle} autoFocus /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Email" htmlFor="rec-email"><input id="rec-email" type="email" value={form.email} onChange={set("email")} style={inputStyle} /></Field>
        <Field label="Phone" htmlFor="rec-phone"><input id="rec-phone" value={form.phone} onChange={set("phone")} style={inputStyle} /></Field>
        <Field label="Where they heard about us" htmlFor="rec-source"><input id="rec-source" value={form.source} onChange={set("source")} placeholder="Tabling, Instagram…" style={inputStyle} /></Field>
        <Field label="Department of interest" htmlFor="rec-dept">
          <select id="rec-dept" value={form.department_id} onChange={set("department_id")} style={selectStyle}>
            <option value="">Not sure yet</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
