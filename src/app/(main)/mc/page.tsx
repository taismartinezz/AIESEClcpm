"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { PRODUCTS } from "@/lib/products";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useMcs, type Mc } from "@/hooks/useMcs";
import { Button, ErrorText, Field, Panel, Stat, Tabs, inputStyle } from "@/components/lc/ui";
import McTemplateReview from "@/components/outreach/McTemplateReview";
import { askConfirm } from "@/components/ui/confirm";

type Metric = "approved" | "realized" | "applied" | "completed";
interface Row { project_id: string; lc_name: string; members: number; product: string; applied: number; approved: number; realized: number; completed: number }

/** National (MC) view: every LC's exchange numbers this term. Counts only. */
export default function McPage() {
  const [version, setVersion] = useState(0);
  const { mcs, loaded, error: mcError } = useMcs(version);
  const [chosen, setChosen] = useState<string | null>(null);
  const mc = mcs.find((m) => m.id === chosen) ?? mcs[0] ?? null;

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="National (MC)" subtitle="Every LC's approvals and realizations this term, side by side. Numbers only, never people." />
      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px)", maxWidth: 1200, width: "100%" }}>
        <ErrorText>{mcError}</ErrorText>
        {!isSupabaseConfigured ? (
          <NeedsDatabase what="National (MC)">Every LC&apos;s approvals and realizations this term, side by side, for the national team.</NeedsDatabase>
        ) : !loaded ? (
          <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
        ) : !mc ? (
          <JoinOrCreate onDone={() => setVersion((v) => v + 1)} />
        ) : (
          <>
            {mcs.length > 1 && (
              <Tabs value={mc.id} onChange={setChosen} tabs={mcs.map((m) => ({ id: m.id, label: m.name }))} />
            )}
            <McDashboard mc={mc} onChanged={() => setVersion((v) => v + 1)} />
          </>
        )}
      </div>
    </div>
  );
}

function JoinOrCreate({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [mcName, setMcName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data } = await supabase.from("user_profiles").select("id").eq("id", session.user.id).maybeSingle();
      if (!cancelled) setNeedsProfile(!data);
    })();
    return () => { cancelled = true; };
  }, []);

  async function go(action: "create" | "join") {
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("sign in first");
      if (needsProfile) {
        if (!name.trim()) throw new Error("add your name");
        const { error: pErr } = await supabase.from("user_profiles").upsert({ id: session.user.id, name: name.trim(), role: "member" });
        if (pErr) throw new Error(pErr.message);
      }
      const { error: err } = action === "create"
        ? await supabase.rpc("create_mc", { p_name: mcName })
        : await supabase.rpc("join_mc", { p_code: code });
      if (err) throw new Error(err.message);
      onDone();
    } catch (e) {
      setError(`Couldn't ${action === "create" ? "create the MC" : "join"}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontSize: 13, color: "var(--color-body)", margin: 0 }}>
        This view is for the national team (MC). You see each LC&apos;s numbers once its president links it with your MC&apos;s LC code. You never see an LC&apos;s members, exchanges or wellbeing data.
      </p>
      {needsProfile && (
        <Field label="Your name" htmlFor="mc-you"><input id="mc-you" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} /></Field>
      )}
      <Panel title="Join your MC">
        <div style={{ padding: 14, display: "flex", gap: 8 }}>
          <input aria-label="MC member code" placeholder="Member code from your MCP" value={code} onChange={(e) => setCode(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          <Button onClick={() => go("join")} disabled={busy || !code.trim()}>Join</Button>
        </div>
      </Panel>
      <Panel title="Or set up your MC (MCP)">
        <div style={{ padding: 14, display: "flex", gap: 8 }}>
          <input aria-label="MC name" placeholder="e.g. AIESEC in Portugal" value={mcName} onChange={(e) => setMcName(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          <Button variant="secondary" onClick={() => go("create")} disabled={busy || !mcName.trim()}>Create</Button>
        </div>
      </Panel>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function McDashboard({ mc, onChanged }: { mc: Mc; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("approved");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await supabase.rpc("mc_dashboard", { p_mc_id: mc.id });
        if (err) throw new Error(err.message);
        if (!cancelled) { setRows((data ?? []) as Row[]); setError(null); }
      } catch (e) {
        if (!cancelled) setError(`Couldn't load the national numbers: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [mc.id, version]);

  const lcs = useMemo(() => {
    const by = new Map<string, { id: string; name: string; members: number; values: Record<string, Row> }>();
    for (const r of rows) {
      const lc = by.get(r.project_id) ?? { id: r.project_id, name: r.lc_name, members: r.members, values: {} };
      lc.values[r.product] = r;
      by.set(r.project_id, lc);
    }
    const total = (lc: { values: Record<string, Row> }) => Object.values(lc.values).reduce((s, r) => s + r[metric], 0);
    return [...by.values()].sort((a, b) => total(b) - total(a));
  }, [rows, metric]);

  const sum = (m: Metric, product?: string) => rows.filter((r) => !product || r.product === product).reduce((s, r) => s + r[m], 0);
  const conv = sum("applied") ? `${Math.round((sum("approved") / sum("applied")) * 100)}%` : "-";

  async function removeLc(id: string, name: string) {
    if (!(await askConfirm(`Remove ${name} from ${mc.name}? Its president can link it again with the LC code.`, { confirmLabel: "Remove" }))) return;
    setError(null);
    try {
      const { error: err } = await supabase.rpc("unlink_lc_from_mc", { p_project_id: id });
      if (err) throw new Error(err.message);
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      setError(`Couldn't remove ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function exportCsv() {
    downloadCsv(`${mc.name}-${metric}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(lcs, [
      { header: "LC", value: (l) => l.name },
      { header: "Members", value: (l) => l.members },
      ...PRODUCTS.map((p) => ({ header: `${p.label} ${metric}`, value: (l: (typeof lcs)[number]) => l.values[p.code]?.[metric] ?? 0 })),
    ]));
  }

  const th: React.CSSProperties = { textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Stat label="LCs linked" value={String(lcs.length)} />
        <Stat label="Approved this term" value={String(sum("approved"))} />
        <Stat label="Realized this term" value={String(sum("realized"))} />
        <Stat label="Applied → approved" value={conv} note="national conversion" />
      </div>
      <ErrorText>{error}</ErrorText>
      <Panel title="By LC" action={<div style={{ display: "flex", gap: 8 }}>
        <Tabs value={metric} onChange={setMetric} tabs={[{ id: "approved", label: "Approved" }, { id: "realized", label: "Realized" }, { id: "applied", label: "Applied" }, { id: "completed", label: "Completed" }]} />
        <Button variant="secondary" onClick={exportCsv} disabled={lcs.length === 0}><Download size={14} aria-hidden="true" /> CSV</Button>
      </div>}>
        {!loaded ? <div className="animate-pulse" style={{ height: 120, backgroundColor: "var(--color-dimmed-bg)" }} /> : lcs.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>
            No LCs linked yet. Send LC presidents the LC code <strong>{mc.lcCode}</strong>; they enter it in Settings → National (MC).
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th scope="col" style={{ ...th, textAlign: "left" }}>LC</th>
                {PRODUCTS.map((p) => <th key={p.code} scope="col" style={th}>{p.label}</th>)}
                <th scope="col" style={th}>Total</th>
                {mc.isMcp && <th scope="col" style={th}><span className="sr-only">Remove</span></th>}
              </tr></thead>
              <tbody>
                {lcs.map((l) => (
                  <tr key={l.id}>
                    <td style={{ ...td, textAlign: "left" }}><strong style={{ fontWeight: 600 }}>{l.name}</strong> <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{l.members} members</span></td>
                    {PRODUCTS.map((p) => <td key={p.code} style={td}>{l.values[p.code]?.[metric] ?? 0}</td>)}
                    <td style={{ ...td, fontWeight: 700 }}>{Object.values(l.values).reduce((s, r) => s + r[metric], 0)}</td>
                    {mc.isMcp && <td style={td}><button type="button" aria-label={`Remove ${l.name}`} onClick={() => removeLc(l.id, l.name)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={13} color="var(--color-secondary)" /></button></td>}
                  </tr>
                ))}
                <tr>
                  <th scope="row" style={{ ...td, textAlign: "left", fontWeight: 700 }}>National</th>
                  {PRODUCTS.map((p) => <td key={p.code} style={{ ...td, fontWeight: 700 }}>{sum(metric, p.code)}</td>)}
                  <td style={{ ...td, fontWeight: 700 }}>{sum(metric)}</td>
                  {mc.isMcp && <td style={td} />}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <McTemplateReview lcNames={Object.fromEntries(lcs.map((l) => [l.id, l.name]))} />
      <Panel title="Codes">
        <div style={{ padding: 14, fontSize: 13, color: "var(--color-body)", display: "grid", gap: 6 }}>
          <span>LC code (for LC presidents): <strong style={{ fontFamily: "monospace" }}>{mc.lcCode}</strong></span>
          <span>Member code (for MC members): <strong style={{ fontFamily: "monospace" }}>{mc.memberCode}</strong></span>
        </div>
      </Panel>
    </div>
  );
}
