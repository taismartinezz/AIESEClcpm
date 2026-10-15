"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, Plus, Search } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { useProject } from "@/context/ProjectContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { isExec } from "@/lib/permissions";
import { PARTNER_STAGES, PARTNER_STAGE_LABEL, followUpState, mapPartner } from "@/lib/partners";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useLcMembers } from "@/hooks/useLcMembers";
import type { Partner, PartnerStage } from "@/types";
import { Button, ErrorText, Panel, inputStyle, selectStyle } from "@/components/lc/ui";
import PartnerModal from "@/components/partners/PartnerModal";

export default function PartnersPage() {
  const { projectId, userId, role, departments, departmentId, isLoading } = useProject();
  const exec = isExec(role);
  const { members: roster, names } = useLcMembers(projectId);
  const allowedDepartments = exec ? departments.map((d) => d.id) : departmentId ? [departmentId] : [];

  const [partners, setPartners] = useState<Partner[]>([]);
  const [stage, setStage] = useState<"all" | PartnerStage>("all");
  const [dept, setDept] = useState("all");
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Partner | "new" | null>(null);
  const enabled = Boolean(projectId) && isSupabaseConfigured;

  useEffect(() => {
    if (isLoading || !enabled || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await supabase.from("partners").select("*").eq("project_id", projectId).order("name");
        if (err) throw new Error(err.message);
        if (!cancelled) { setPartners((data ?? []).map(mapPartner)); setError(null); }
      } catch (e) {
        if (!cancelled) setError(`Couldn't load partners: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, isLoading, enabled, version]);

  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
  const shown = partners.filter((p) =>
    (stage === "all" || p.stage === stage)
    && (dept === "all" || p.departmentId === dept)
    && (!mine || p.ownerId === userId)
    && (!query || [p.name, p.industry, p.notes].some((v) => v?.toLowerCase().includes(query.toLowerCase()))));
  const due = partners.filter((p) => p.ownerId === userId && followUpState(p.nextFollowUp) && p.stage !== "lost");

  function exportCsv() {
    downloadCsv(`partners-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(shown, [
      { header: "Organisation", value: (p) => p.name },
      { header: "Industry", value: (p) => p.industry },
      { header: "Stage", value: (p) => PARTNER_STAGE_LABEL[p.stage] },
      { header: "Department", value: (p) => deptName(p.departmentId) },
      { header: "Owner", value: (p) => (p.ownerId ? names[p.ownerId] : "") },
      { header: "Next follow-up", value: (p) => p.nextFollowUp },
      { header: "Website", value: (p) => p.website },
    ]));
  }

  const loading = isLoading || (enabled && !loaded);
  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderTop: "1px solid var(--color-border)" };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Partners"
        subtitle="Companies and organisations your LC works with: stage, contacts and follow-ups."
        action={<>
          <Button variant="secondary" onClick={exportCsv} disabled={shown.length === 0}><Download size={14} aria-hidden="true" /> CSV</Button>
          {allowedDepartments.length > 0 && <Button onClick={() => setEditing("new")}><Plus size={14} aria-hidden="true" /> Add partner</Button>}
        </>}
      />
      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px)", maxWidth: 1200, width: "100%" }}>
        <ErrorText>{error}</ErrorText>
        {loading ? (
          <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
        ) : !enabled || !projectId || !userId ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>Partners need a connected database.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div role="group" aria-label="Filter by stage" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PARTNER_STAGES.map((s) => {
                const n = partners.filter((p) => p.stage === s.code).length;
                const active = stage === s.code;
                return (
                  <button key={s.code} type="button" onClick={() => setStage(active ? "all" : s.code)} aria-pressed={active}
                    style={{ minWidth: 92, padding: "8px 12px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                      border: `1px solid ${active ? "var(--color-navy)" : "var(--color-border)"}`,
                      backgroundColor: active ? "var(--color-navy-dim)" : "var(--color-surface)" }}>
                    <span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)" }}>{s.label}</span>
                    <span style={{ display: "block", fontSize: 18, fontWeight: 600, color: "var(--color-body)", fontVariantNumeric: "tabular-nums" }}>{n}</span>
                  </button>
                );
              })}
            </div>

            {due.length > 0 && (
              <p role="status" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-warning)", margin: 0 }}>
                <AlertTriangle size={14} aria-hidden="true" /> {due.length} of your partners need a follow-up this week.
              </p>
            )}

            <Panel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ position: "relative", width: 220 }}>
                  <Search size={14} color="var(--color-secondary)" aria-hidden="true" style={{ position: "absolute", left: 10, top: 10 }} />
                  <input aria-label="Search partners" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...inputStyle, height: 34, paddingLeft: 30 }} />
                </div>
                <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} style={{ ...selectStyle, width: 200, height: 34 }}>
                  <option value="all">All departments</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-body)" }}>
                  <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} style={{ accentColor: "var(--color-navy)" }} /> Only mine
                </label>
              </div>
              {shown.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>{partners.length === 0 ? "No partners yet." : "No partners match."}</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr><th scope="col" style={th}>Organisation</th><th scope="col" style={th}>Stage</th><th scope="col" style={th}>Department</th><th scope="col" style={th}>Owner</th><th scope="col" style={th}>Next follow-up</th></tr></thead>
                    <tbody>
                      {shown.map((p) => {
                        const f = followUpState(p.nextFollowUp);
                        return (
                          <tr key={p.id}>
                            <td style={td}>
                              <button type="button" onClick={() => setEditing(p)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--color-navy)", textAlign: "left" }}>{p.name}</button>
                              {p.industry && <div style={{ fontSize: 11, color: "var(--color-secondary)" }}>{p.industry}</div>}
                            </td>
                            <td style={td}>{PARTNER_STAGE_LABEL[p.stage]}</td>
                            <td style={{ ...td, color: "var(--color-secondary)" }}>{deptName(p.departmentId)}</td>
                            <td style={td}>{p.ownerId ? names[p.ownerId] ?? "—" : "—"}</td>
                            <td style={{ ...td, whiteSpace: "nowrap", color: f === "overdue" ? "var(--color-error)" : f === "soon" ? "var(--color-warning)" : "var(--color-body)", fontWeight: f ? 600 : 400 }}>
                              {p.nextFollowUp ?? "—"}{f === "overdue" ? " · overdue" : ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        )}
      </div>

      {editing && projectId && userId && (
        <PartnerModal
          projectId={projectId} userId={userId} departments={departments} allowedDepartmentIds={allowedDepartments} roster={roster}
          partner={editing === "new" ? undefined : editing}
          onClose={() => { setEditing(null); setVersion((v) => v + 1); }} onSaved={() => { setEditing(null); setVersion((v) => v + 1); }}
        />
      )}
    </div>
  );
}
