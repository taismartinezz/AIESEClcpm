"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, ExternalLink, Plus, Search, Upload } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { useProject } from "@/context/ProjectContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { PRODUCTS, PRODUCT_BY_CODE, STAGES, STAGE_DATE_FIELD, STAGE_LABEL, type ExchangeStage, type ProductCode } from "@/lib/products";
import { daysSince, formatPct, localIsoDate, mapExchange, pipelineStats, stuckExchanges } from "@/lib/pipeline";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useLcMembers } from "@/hooks/useLcMembers";
import type { Exchange } from "@/types";
import { Button, ErrorText, Stat, inputStyle } from "@/components/lc/ui";
import ExchangeModal from "@/components/pipeline/ExchangeModal";
import ImportWizard from "@/components/import/ImportWizard";

export default function PipelinePage() {
  const { projectId, userId, role, departments, departmentId, ledDepartmentIds, isLoading } = useProject();
  const { members: roster, names } = useLcMembers(projectId);

  // Products this person works on: all for the LCP, otherwise their own and led departments'.
  const myProducts = useMemo<ProductCode[]>(() => {
    if (role === "president") return PRODUCTS.map((p) => p.code);
    const mine = departments.filter((d) => d.id === departmentId || ledDepartmentIds.includes(d.id));
    return PRODUCTS.map((p) => p.code).filter((c) => mine.some((d) => d.products.includes(c)));
  }, [role, departments, departmentId, ledDepartmentIds]);

  const [productChoice, setProduct] = useState<ProductCode | null>(null);
  const product = productChoice ?? myProducts[0] ?? "ogv";
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const [editing, setEditing] = useState<Exchange | "new" | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [termStart, setTermStart] = useState(() => `${new Date().getFullYear()}-02-01`);
  const enabled = Boolean(projectId) && isSupabaseConfigured;

  useEffect(() => {
    if (isLoading || !enabled || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        // RLS returns only the exchanges this person may see.
        const [{ data, error: err }, term] = await Promise.all([
          supabase.from("exchanges").select("*").eq("project_id", projectId).order("updated_at", { ascending: false }),
          supabase.rpc("lc_term_start", { p_project_id: projectId }),
        ]);
        if (err) throw new Error(err.message);
        if (!cancelled && !term.error && term.data) setTermStart(term.data as string);
        if (!cancelled) { setExchanges((data ?? []).map(mapExchange)); setError(null); }
      } catch (e) {
        if (!cancelled) setError(`Couldn't load the pipeline: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, isLoading, enabled, version]);

  async function move(ex: Exchange, stage: ExchangeStage) {
    setMovingId(ex.id);
    setError(null);
    try {
      const { error: err } = await supabase.from("exchanges").update({ stage }).eq("id", ex.id);
      if (err) throw new Error(err.message);
      reload();
    } catch (e) {
      setError(`Couldn't move ${ex.personName}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMovingId(null);
    }
  }

  const inProduct = exchanges.filter((e) => e.product === product);
  const shown = inProduct.filter((e) => !query || [e.personName, e.opportunity, e.hostEntity, e.expaId].some((v) => v?.toLowerCase().includes(query.toLowerCase())));
  const color = PRODUCT_BY_CODE[product].color;
  const today = localIsoDate(new Date());
  const stats = pipelineStats(inProduct, termStart, today);
  const stuck = stuckExchanges(inProduct);

  function exportCsv() {
    downloadCsv(`pipeline-${product}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(inProduct, [
      { header: "Product", value: (e) => PRODUCT_BY_CODE[e.product].label },
      { header: "Stage", value: (e) => STAGE_LABEL[e.stage] },
      { header: "Name", value: (e) => e.personName },
      { header: "Project / position", value: (e) => e.opportunity },
      { header: "Host / home", value: (e) => e.hostEntity },
      { header: "EXPA ID", value: (e) => e.expaId },
      { header: "Responsible", value: (e) => (e.ownerId ? names[e.ownerId] : "") },
      ...STAGES.map((s) => ({ header: `${s.label} on`, value: (e: Exchange) => e[STAGE_DATE_FIELD[s.code]] })),
    ]));
  }

  const loading = isLoading || (enabled && !loaded);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Exchange pipeline"
        subtitle="Every exchange from sign-up to completed, per product."
        action={<>
          <Button variant="secondary" onClick={exportCsv} disabled={inProduct.length === 0}><Download size={14} aria-hidden="true" /> CSV</Button>
          {myProducts.length > 0 && <Button variant="secondary" onClick={() => setImporting(true)}><Upload size={14} aria-hidden="true" /> Import from EXPA</Button>}
          {myProducts.length > 0 && <Button onClick={() => setEditing("new")}><Plus size={14} aria-hidden="true" /> Add exchange</Button>}
        </>}
      >
        <div role="tablist" aria-label="Product" style={{ display: "flex", gap: 6, marginTop: 8, overflowX: "auto" }}>
          {PRODUCTS.filter((p) => myProducts.includes(p.code)).map((p) => {
            const active = p.code === product;
            const count = exchanges.filter((e) => e.product === p.code).length;
            return (
              <button
                key={p.code} type="button" role="tab" aria-selected={active} onClick={() => setProduct(p.code)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 7, cursor: "pointer",
                  fontSize: 13, fontWeight: active ? 700 : 500, whiteSpace: "nowrap",
                  border: `1px solid ${active ? p.color : "var(--color-border)"}`,
                  backgroundColor: active ? "var(--color-surface)" : "transparent", color: "var(--color-body)",
                  boxShadow: active ? `inset 0 -3px 0 ${p.color}` : undefined,
                }}
              >
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: p.color }} />
                {p.label} <span style={{ color: "var(--color-secondary)", fontWeight: 400 }}>{count}</span>
              </button>
            );
          })}
        </div>
      </PageHeader>

      <div className="flex-1 overflow-auto" style={{ padding: "16px clamp(16px, 3vw, 28px)" }}>
        <ErrorText>{error}</ErrorText>
        {loading ? (
          <div className="animate-pulse" style={{ height: 260, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
        ) : !enabled || !projectId || !userId ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>The pipeline needs a connected database. You are in demo mode: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (locally in .env, or in your hosting provider&apos;s environment variables) to use it.</p>
        ) : myProducts.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>
            Your department doesn&apos;t run an exchange product. The pipeline is for the oGV, oGT/Te, iGV and iGT/Te departments.
          </p>
        ) : (
          <>
            <section aria-label={`${PRODUCT_BY_CODE[product].label} this term`} style={{ marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                <Stat label={`Approved this term`} value={String(stats.approved)} note={`since ${termStart}`} />
                <Stat label="Realized this term" value={String(stats.realized)} note={`${stats.completed} completed`} />
                <Stat label="Applied → accepted" value={formatPct(stats.appliedToAccepted)} note={`of ${stats.applied} who applied this term`} />
                <Stat label="Applied → approved" value={formatPct(stats.appliedToApproved)} note="the conversion MCs track" />
                <Stat label="Approved → realized" value={formatPct(stats.approvedToRealized)} note={`of ${stats.approved} approved this term`} />
              </div>
              {stuck.length > 0 && (
                <div role="status" style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, backgroundColor: "var(--color-warning-bg)", fontSize: 12, color: "var(--color-body)" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700, color: "var(--color-warning)" }}>
                    <AlertTriangle size={13} aria-hidden="true" /> {stuck.length} stuck
                  </span>{" "}
                  {stuck.slice(0, 6).map(({ exchange: e, days }, i) => (
                    <span key={e.id}>
                      {i > 0 && " · "}
                      <button type="button" onClick={() => setEditing(e)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: "var(--color-navy)", fontWeight: 600 }}>{e.personName}</button>
                      {` ${STAGE_LABEL[e.stage].toLowerCase()} ${days}d`}
                    </span>
                  ))}
                  {stuck.length > 6 && ` · and ${stuck.length - 6} more`}
                </div>
              )}
            </section>
            <div style={{ position: "relative", maxWidth: 280, marginBottom: 12 }}>
              <Search size={14} color="var(--color-secondary)" aria-hidden="true" style={{ position: "absolute", left: 10, top: 12 }} />
              <input aria-label="Search exchanges" placeholder="Search name, project, EXPA ID…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...inputStyle, paddingLeft: 30 }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(200px, 1fr))`, gap: 10, overflowX: "auto", paddingBottom: 8 }}>
              {STAGES.map((s, i) => {
                const col = shown.filter((e) => e.stage === s.code);
                return (
                  <section key={s.code} aria-label={`${s.label}: ${col.length}`} style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", borderRadius: 10, minHeight: 200 }}>
                    <header style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", borderBottom: `2px solid ${color}` }}>
                      <h2 style={{ flex: 1, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-body)", margin: 0 }}>{s.label}</h2>
                      <span style={{ fontSize: 12, color: "var(--color-secondary)", fontVariantNumeric: "tabular-nums" }}>{col.length}</span>
                    </header>
                    <ul style={{ listStyle: "none", margin: 0, padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                      {col.map((e) => {
                        const days = daysSince(e[STAGE_DATE_FIELD[e.stage]]);
                        return (
                          <li key={e.id} style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "8px 10px", opacity: movingId === e.id ? 0.6 : 1 }}>
                            <button type="button" onClick={() => setEditing(e)} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-body)" }}>{e.personName}</span>
                              {(e.opportunity || e.hostEntity) && <span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)", marginTop: 2 }}>{[e.opportunity, e.hostEntity].filter(Boolean).join(" · ")}</span>}
                              <span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)", marginTop: 2 }}>
                                {e.ownerId ? names[e.ownerId] ?? "—" : "Unassigned"}{days != null ? ` · ${days}d here` : ""}
                              </span>
                            </button>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                              <select
                                aria-label={`Move ${e.personName}`} value={e.stage} disabled={movingId === e.id}
                                onChange={(ev) => move(e, ev.target.value as ExchangeStage)}
                                style={{ flex: 1, height: 26, fontSize: 11, border: "1px solid var(--color-border)", borderRadius: 6, backgroundColor: "var(--color-canvas)", color: "var(--color-body)" }}
                              >
                                {STAGES.map((st) => <option key={st.code} value={st.code}>{st.label}</option>)}
                              </select>
                              {i < STAGES.length - 1 && (
                                <button type="button" onClick={() => move(e, STAGES[i + 1].code)} disabled={movingId === e.id}
                                  aria-label={`Move ${e.personName} to ${STAGES[i + 1].label}`}
                                  style={{ height: 26, padding: "0 8px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, cursor: "pointer", backgroundColor: "var(--color-navy-dim)", color: "var(--color-navy)" }}>
                                  →
                                </button>
                              )}
                              {e.expaUrl && <a href={e.expaUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${e.personName} in EXPA`} style={{ display: "flex", color: "var(--color-secondary)" }}><ExternalLink size={13} /></a>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>

      {importing && projectId && (
        <ImportWizard
          target="exchanges" projectId={projectId} products={[product, ...myProducts.filter((p) => p !== product)]}
          context={{ departments, roster, defaultDepartmentId: departmentId }}
          onClose={() => setImporting(false)} onImported={reload}
        />
      )}

      {editing && projectId && userId && (
        <ExchangeModal
          projectId={projectId} userId={userId} products={myProducts} roster={roster}
          exchange={editing === "new" ? undefined : editing} defaultProduct={product}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}
