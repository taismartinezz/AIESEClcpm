"use client";

import { useEffect, useMemo, useState } from "react";
import { Pause, Play, Plus, UserPlus } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import TeachingEmpty, { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { useProject } from "@/context/ProjectContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { PRODUCTS, PRODUCT_BY_CODE, STAGE_LABEL, type ProductCode } from "@/lib/products";
import { TEMPLATE_STATUS_LABEL } from "@/lib/outreach";
import { Button, ErrorText, Panel, Tabs } from "@/components/lc/ui";
import TemplateModal, { mapTemplate, type OutreachTemplate } from "@/components/outreach/TemplateModal";
import { EnrollModal, SequenceModal, mapSequence, type Sequence } from "@/components/outreach/SequenceModals";

type Tab = "sequences" | "templates" | "results";
interface Stat { sequence_id: string; name: string; product: string; enrolled: number; active: number; replied: number; unsubscribed: number; moved_on: number; applied: number; emails_sent: number }

const STATUS_COLOR: Record<OutreachTemplate["status"], string> = { draft: "var(--color-secondary)", pending: "var(--color-warning)", approved: "var(--color-success, #00A86B)", rejected: "var(--color-error)" };

/** oGX outreach: approved templates, sequences tied to pipeline stages, results per sequence. */
export default function OutreachPage() {
  const { projectId, userId, role, departments, departmentId, ledDepartmentIds, isLoading } = useProject();
  const [tab, setTab] = useState<Tab>("sequences");
  const [templates, setTemplates] = useState<OutreachTemplate[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [stats, setStats] = useState<Stat[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const [editingTpl, setEditingTpl] = useState<OutreachTemplate | "new" | null>(null);
  const [editingSeq, setEditingSeq] = useState<Sequence | "new" | null>(null);
  const [enrolling, setEnrolling] = useState<Sequence | null>(null);
  const enabled = Boolean(projectId) && isSupabaseConfigured;

  const products = useMemo<ProductCode[]>(() => {
    if (role === "president") return PRODUCTS.map((p) => p.code);
    const mine = departments.filter((d) => d.id === departmentId || ledDepartmentIds.includes(d.id));
    return PRODUCTS.map((p) => p.code).filter((c) => mine.some((d) => d.products.includes(c)));
  }, [role, departments, departmentId, ledDepartmentIds]);
  const canApprove = (t?: { departmentId: string | null }) => role === "president" || Boolean(t?.departmentId && ledDepartmentIds.includes(t.departmentId));
  const canManageSequences = role === "president" || ledDepartmentIds.length > 0;

  useEffect(() => {
    if (isLoading || !enabled || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const [t, s, st] = await Promise.all([
          supabase.from("outreach_templates").select("*").eq("project_id", projectId).order("updated_at", { ascending: false }),
          supabase.from("outreach_sequences").select("*, outreach_steps(step_no, delay_days, template_id)").eq("project_id", projectId).order("created_at"),
          supabase.rpc("outreach_stats", { p_project_id: projectId }),
        ]);
        const failed = [t, s, st].find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
        if (cancelled) return;
        setTemplates((t.data ?? []).map(mapTemplate));
        setSequences((s.data ?? []).map(mapSequence));
        setStats((st.data ?? []) as Stat[]);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(`Couldn't load outreach: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, isLoading, enabled, version]);

  async function toggle(s: Sequence) {
    setError(null);
    try {
      const { error: err } = await supabase.from("outreach_sequences").update({ active: !s.active }).eq("id", s.id);
      if (err) throw new Error(err.message);
      reload();
    } catch (e) {
      setError(`Couldn't ${s.active ? "pause" : "start"} ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const pending = templates.filter((t) => t.status === "pending" && canApprove(t));
  const tplName = (id: string) => templates.find((t) => t.id === id);
  const loading = isLoading || (enabled && !loaded);
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Outreach" subtitle="Emails to people who signed up, sent from your name, that stop as soon as they move on or reply.">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: "sequences", label: "Sequences" },
          { id: "templates", label: pending.length ? `Templates (${pending.length} to review)` : "Templates" },
          { id: "results", label: "Results" },
        ]} />
      </PageHeader>
      <div className="flex-1 overflow-auto" style={{ padding: "16px clamp(16px, 3vw, 28px)", maxWidth: 1100, width: "100%" }}>
        <ErrorText>{error}</ErrorText>
        {loading ? <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
        : !enabled || !projectId || !userId ? (
          <NeedsDatabase what="Outreach">Email sequences to oGX sign-ups (day 0, day 3, day 7…) from approved templates, stopping when someone applies, replies or unsubscribes.</NeedsDatabase>
        ) : products.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>Outreach is for departments that run an exchange product.</p>
        ) : tab === "templates" ? (
          <Panel title="Templates" action={<Button onClick={() => setEditingTpl("new")}><Plus size={14} aria-hidden="true" /> Template</Button>}>
            {templates.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>No templates yet. Write one; your VP or LCP approves it before it can be sent.</p> : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {templates.map((t) => (
                  <li key={t.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <button type="button" onClick={() => setEditingTpl(t)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-body)" }}>{t.name}</span>
                        <span style={{ display: "block", fontSize: 12, color: "var(--color-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</span>
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[t.status] }}>{TEMPLATE_STATUS_LABEL[t.status]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : tab === "results" ? (
          <Panel title="Results per sequence">
            {stats.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>No sequences yet.</p> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr>{["Sequence", "Enrolled", "Emails sent", "Replied", "Unsubscribed", "Applied after", "Sign-up → applied"].map((h, i) => (
                    <th key={h} scope="col" style={{ textAlign: i ? "right" : "left", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px" }}>{h}</th>))}</tr></thead>
                  <tbody>
                    {stats.map((s) => (
                      <tr key={s.sequence_id}>
                        <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}><strong style={{ fontWeight: 600 }}>{s.name}</strong> <span style={{ color: "var(--color-secondary)", fontSize: 11 }}>{PRODUCT_BY_CODE[s.product as ProductCode]?.label}</span></td>
                        {[s.enrolled, s.emails_sent, s.replied, s.unsubscribed, s.applied].map((n, i) => (
                          <td key={i} style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{n}</td>))}
                        <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", fontWeight: 700 }}>{pct(s.applied, s.enrolled)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : sequences.length === 0 ? (
          <TeachingEmpty title="Follow up with every sign-up, automatically" actions={<>
            {canManageSequences && <Button onClick={() => setEditingSeq("new")}><Plus size={14} aria-hidden="true" /> New sequence</Button>}
            <Button variant="secondary" onClick={() => setTab("templates")}>Write a template first</Button>
          </>}>
            A sequence sends approved emails to sign-ups on the days you choose (e.g. day 0, 3 and 7), from the member who enrolled them, with
            replies going to that member. It stops the moment someone applies, replies or unsubscribes, and the Results tab shows which
            sequence turns sign-ups into applications.
          </TeachingEmpty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {canManageSequences && <div><Button onClick={() => setEditingSeq("new")}><Plus size={14} aria-hidden="true" /> New sequence</Button></div>}
            {sequences.map((s) => {
              const notReady = s.steps.some((st) => tplName(st.templateId)?.status !== "approved");
              return (
                <Panel key={s.id} title={`${s.name} · ${PRODUCT_BY_CODE[s.product].label} · ${STAGE_LABEL[s.triggerStage]}`} action={<div style={{ display: "flex", gap: 6 }}>
                  {s.active && <Button onClick={() => setEnrolling(s)}><UserPlus size={14} aria-hidden="true" /> Enroll people</Button>}
                  {canManageSequences && <Button variant="secondary" onClick={() => toggle(s)} disabled={!s.active && notReady}>
                    {s.active ? <><Pause size={13} aria-hidden="true" /> Pause</> : <><Play size={13} aria-hidden="true" /> Start</>}
                  </Button>}
                  {canManageSequences && <Button variant="ghost" onClick={() => setEditingSeq(s)}>Edit</Button>}
                </div>}>
                  <ol style={{ margin: 0, padding: "10px 14px 10px 32px", fontSize: 13, color: "var(--color-body)", lineHeight: 1.7 }}>
                    {s.steps.map((st) => {
                      const t = tplName(st.templateId);
                      return <li key={st.stepNo}>Day {st.delayDays}: {t?.name ?? "missing template"} {t && t.status !== "approved" && <span style={{ color: "var(--color-warning)", fontSize: 12 }}>({TEMPLATE_STATUS_LABEL[t.status].toLowerCase()})</span>}</li>;
                    })}
                  </ol>
                  {!s.active && notReady && <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 14px 10px" }}>Waiting for every template to be approved before it can start.</p>}
                </Panel>
              );
            })}
          </div>
        )}
      </div>

      {editingTpl && projectId && userId && (
        <TemplateModal projectId={projectId} userId={userId} departments={departments.filter((d) => d.products.length > 0)} defaultDepartmentId={departmentId ?? ledDepartmentIds[0] ?? null}
          template={editingTpl === "new" ? undefined : editingTpl} canApprove={canApprove(editingTpl === "new" ? { departmentId: departmentId ?? ledDepartmentIds[0] ?? null } : editingTpl)}
          onClose={() => setEditingTpl(null)} onSaved={() => { setEditingTpl(null); reload(); }} />
      )}
      {editingSeq && projectId && userId && (
        <SequenceModal projectId={projectId} userId={userId} products={products} templates={templates}
          sequence={editingSeq === "new" ? undefined : editingSeq} onClose={() => setEditingSeq(null)} onSaved={() => { setEditingSeq(null); reload(); }} />
      )}
      {enrolling && projectId && (
        <EnrollModal projectId={projectId} sequence={enrolling} onClose={() => setEnrolling(null)} onDone={reload} />
      )}
    </div>
  );
}
