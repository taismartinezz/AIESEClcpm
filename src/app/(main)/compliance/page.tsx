"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { useProject } from "@/context/ProjectContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Button, ErrorText, Panel, inputStyle } from "@/components/lc/ui";
import { evaluate, monthlyDeadline, STATUS_LABEL, type CheckKind, type ComplianceData, type Status } from "@/lib/compliance";

const STATUS_STYLE: Record<Status, { icon: typeof CheckCircle2; color: string; bg: string }> = {
  ok:   { icon: CheckCircle2,  color: "var(--color-success, #0F7B3F)", bg: "var(--color-success-bg, #E7F6EE)" },
  warn: { icon: AlertTriangle, color: "var(--color-warning, #8A5A00)", bg: "var(--color-warning-bg, #FFF6E0)" },
  fail: { icon: XCircle,       color: "var(--color-error, #B42318)",   bg: "var(--color-error-bg, #FDECEC)" },
};
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The membership criteria an LC must meet to keep full-member status (from
 * the LC planning template), each green / yellow / red with who owns it.
 * For the LC president.
 */
export default function CompliancePage() {
  const { projectId, role, isLoading } = useProject();
  const exec = role === "president";
  const [data, setData] = useState<ComplianceData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [boa, setBoa] = useState("");
  const [plan, setPlan] = useState("");
  const [now] = useState(today);
  const [since, setSince] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !projectId || isLoading || !exec) return;
    let cancelled = false;
    Promise.all([
      supabase.rpc("lc_compliance", { p_project_id: projectId }),
      supabase.from("projects").select("created_at").eq("id", projectId).maybeSingle(),
    ]).then(([{ data: rows, error: err }, lc]) => {
      if (cancelled) return;
      // Months before the LC existed don't count as missed.
      const created = (lc.data as { created_at?: string } | null)?.created_at;
      setSince(typeof created === "string" ? created.slice(0, 10) : null);
      const row = Array.isArray(rows) ? (rows[0] as ComplianceData | undefined) : undefined;
      if (err) setError(`Couldn't load the criteria: ${err.message}`);
      else if (row) { setData({ ...row, balance: Number(row.balance) }); setBoa(String(row.boa_members)); setPlan(row.debt_plan ?? ""); setError(null); }
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [projectId, isLoading, exec, version]);

  async function saveInfo(fields: Record<string, unknown>) {
    setError(null);
    const { error: err } = await supabase.from("lc_compliance_info").upsert({ project_id: projectId, ...fields, updated_at: new Date().toISOString() }, { onConflict: "project_id" });
    if (err) setError(`Couldn't save: ${err.message}`); else setVersion((v) => v + 1);
  }

  async function tick(kind: CheckKind, month: string) {
    setError(null);
    const { error: err } = await supabase.from("lc_compliance_checks").upsert({ project_id: projectId, kind, month, done_on: now }, { onConflict: "project_id,kind,month" });
    if (err) setError(`Couldn't save: ${err.message}`); else setVersion((v) => v + 1);
  }

  const criteria = data ? evaluate(data, now, since) : [];
  const counts = { ok: 0, warn: 0, fail: 0 } as Record<Status, number>;
  for (const c of criteria) counts[c.status]++;

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Membership criteria" subtitle="What your LC needs to keep full-member status, and how it stands today." />
      <div className="flex-1 overflow-auto [&>*]:shrink-0" style={{ padding: "16px clamp(16px, 3vw, 28px)", display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
        {!isSupabaseConfigured ? (
          <NeedsDatabase what="Membership criteria">A non-negative balance, 3 BoA members, 5 oGX approvals and 8 iGTa meetings a year, SONA by the 1st: each criterion green, yellow or red.</NeedsDatabase>
        ) : !exec ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>Your LC&apos;s president keeps track of the membership criteria.</p>
        ) : (
          <>
            <ErrorText>{error}</ErrorText>
            {!loaded ? (
              <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
            ) : data && (
              <>
                <p role="status" style={{ margin: 0, fontSize: 13 }}>
                  <strong>{counts.ok} of {criteria.length}</strong> met{counts.warn ? `, ${counts.warn} at risk` : ""}{counts.fail ? `, ${counts.fail} not met` : ""}.
                </p>
                <Panel>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {criteria.map((c, i) => {
                      const st = STATUS_STYLE[c.status];
                      const Icon = st.icon;
                      const monthly = c.key === "sona" || c.key === "hr_report" ? monthlyDeadline(c.key, data.checks, now, since) : null;
                      return (
                        <li key={c.key} style={{ display: "flex", gap: 12, padding: "12px 14px", borderTop: i ? "1px solid var(--color-border)" : "none", alignItems: "flex-start" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, backgroundColor: st.bg, color: st.color, flexShrink: 0, minWidth: 74 }}>
                            <Icon size={12} aria-hidden="true" /> {STATUS_LABEL[c.status]}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <strong style={{ fontSize: 13 }}>{c.title}</strong>
                            <span style={{ fontSize: 12, color: "var(--color-secondary)" }}> · {c.owner}</span>
                            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-body)" }}>{c.detail}</p>

                            {c.key === "boa" && (
                              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                                <label htmlFor="boa-count" style={{ fontSize: 12, color: "var(--color-secondary)" }}>BoA members</label>
                                <input id="boa-count" inputMode="numeric" value={boa} onChange={(e) => setBoa(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} style={{ ...inputStyle, width: 60, height: 30 }} />
                                <Button variant="secondary" onClick={() => saveInfo({ boa_members: Number(boa) || 0 })}>Save</Button>
                              </div>
                            )}
                            {c.key === "university" && (
                              <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, fontSize: 12 }}>
                                <input type="checkbox" checked={data.university_affiliated} onChange={(e) => saveInfo({ university_affiliated: e.target.checked })} />
                                The LC is affiliated with its university
                              </label>
                            )}
                            {c.key === "balance" && data.balance < 0 && (
                              <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                                <label htmlFor="debt-plan" style={{ fontSize: 12, color: "var(--color-secondary)" }}>Debt repayment plan</label>
                                <textarea id="debt-plan" value={plan} rows={2} maxLength={2000} onChange={(e) => setPlan(e.target.value)} style={{ ...inputStyle, height: "auto", padding: "6px 10px" }} />
                                <div><Button variant="secondary" onClick={() => saveInfo({ debt_plan: plan.trim() || null })}>Save plan</Button></div>
                              </div>
                            )}
                            {monthly && (
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                                {monthly.months.map((m) => {
                                  const label = new Date(`${m.month}T12:00:00Z`).toLocaleDateString("en-US", { month: "short" });
                                  const state = m.done ? (m.done <= m.due ? "on time" : "late") : m.missed ? "missed" : "due";
                                  return (
                                    <button key={m.month} type="button" disabled={Boolean(m.done)} onClick={() => tick(c.key as CheckKind, m.month)}
                                      title={m.done ? `Done ${m.done}` : `Due ${m.due}: mark as done today`}
                                      aria-label={`${label}: ${state}${m.done ? "" : ". Mark as done today"}`}
                                      style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, cursor: m.done ? "default" : "pointer",
                                        border: `1px solid ${m.missed ? "var(--color-error, #B42318)" : "var(--color-border)"}`,
                                        backgroundColor: m.done && !m.missed ? "var(--color-navy-dim)" : "var(--color-surface)",
                                        color: m.missed ? "var(--color-error, #B42318)" : "var(--color-body)" }}>
                                      {label} · {state}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
                <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
                  Approvals come from the pipeline and meetings from partners (log a meeting on a partner to count it). Tip: add the SONA and HR report routines so they show up as tasks before they&apos;re due.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
