"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Download, Target, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { PRODUCTS } from "@/lib/products";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useMcs, type Mc } from "@/hooks/useMcs";
import { Button, ErrorText, Field, Panel, Stat, Tabs, inputStyle } from "@/components/lc/ui";
import McTemplateReview from "@/components/outreach/McTemplateReview";
import { askConfirm } from "@/components/ui/confirm";
import CountryCombobox from "@/components/ui/CountryCombobox";
import { countryByCode, mcNameFor } from "@/lib/aiesecCountries";
import { copyText } from "@/lib/clipboard";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { FUNNEL_STEPS, needsAttention, pace, PACE_LABEL, sourceLabel, stepRate, termProgress, weakestStep, type FunnelCounts, type LcHealth, type PaceStatus } from "@/lib/mcPace";
import { formatDay } from "@/lib/dates";
import { APP_NAME } from "@/lib/brand";

type Metric = "approved" | "realized" | "applied" | "completed";
interface Row { project_id: string; lc_name: string; members: number; product: string; applied: number; approved: number; realized: number; completed: number }

/** National (MC) view: every LC's exchange numbers this term. Counts only. */
export default function McPage() {
  const [version, setVersion] = useState(0);
  const { mcs, loaded, error: mcError } = useMcs(version);
  const [chosen, setChosen] = useState<string | null>(null);
  const mc = mcs.find((m) => m.id === chosen) ?? mcs[0] ?? null;
  // The tab shows the MC's name ("AIESEC in Portugal · LC Manager").
  useDocumentTitle(`${mc?.name ?? "National"} · ${APP_NAME}`);

  return (
    <div className="flex flex-col h-full">
      <PageHeader title={mc?.name ?? "National (MC)"} action={mc?.isMcp ? <RenameMc mc={mc} onDone={() => setVersion((v) => v + 1)} /> : undefined} subtitle={mc ? "National view: every LC's approvals and realizations this term, side by side. Numbers only, never people." : "Every LC's approvals and realizations this term, side by side. Numbers only, never people."} />
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

const NAME_MAX = 80;

function JoinOrCreate({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [mcCountry, setMcCountry] = useState("");
  // The MC set up in the picked country already, if any (one MC per country).
  const [taken, setTaken] = useState<string | null>(null);
  const mcName = mcCountry ? mcNameFor(mcCountry) : "";

  useEffect(() => {
    if (!mcCountry) return;
    let cancelled = false;
    supabase.rpc("mc_in_country", { p_country: mcCountry }).then(({ data, error: err }) => {
      // Before migration 20261108003 there's no such function: Create says so instead.
      if (!cancelled) setTaken(!err && typeof data === "string" && data ? data : null);
    });
    return () => { cancelled = true; };
  }, [mcCountry]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // Each box shows its own error, next to the button that caused it.
  const [error, setError] = useState<{ action: "create" | "join"; text: string } | null>(null);
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

  // Your name is needed (and only spaces don't count) before either action.
  const nameMissing = needsProfile && !name.trim();

  async function go(action: "create" | "join") {
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("sign in first");
      if (needsProfile) {
        if (!name.trim()) throw new Error("add your name");
        const { error: pErr } = await supabase.from("user_profiles").upsert({ id: session.user.id, name: name.trim().slice(0, NAME_MAX), role: "member" });
        if (pErr) throw new Error(pErr.message);
      }
      const { error: err } = action === "create"
        ? await supabase.rpc("create_mc", { p_name: mcName, p_country: mcCountry })
        : await supabase.rpc("join_mc", { p_code: code.trim() });
      if (err) throw new Error(err.message);
      onDone();
    } catch (e) {
      setError({ action, text: `Couldn't ${action === "create" ? "create the MC" : "join"}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  const hint: React.CSSProperties = { fontSize: 12, color: "var(--color-secondary)", margin: "0 0 10px", lineHeight: 1.5 };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 520 }}>
        <p style={{ fontSize: 13, color: "var(--color-body)", margin: 0, lineHeight: 1.6 }}>
          This view is for the national team (MC). You see each LC&apos;s numbers once its president links it with your MC&apos;s LC code. You never see an LC&apos;s members, exchanges or wellbeing data.
        </p>
        {needsProfile && (
          <Field label="Your name" htmlFor="mc-you">
            <input id="mc-you" value={name} maxLength={NAME_MAX} autoComplete="name" onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </Field>
        )}
        <Panel title="Join your MC">
          <div style={{ padding: 14 }}>
            <p style={hint}>Ask your MCP for the <strong>member code</strong>. It lets you see the national view. (The LC code is for LC presidents.)</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input aria-label="MC member code" placeholder="Member code, e.g. 3FA9C21B" value={code} maxLength={16} onChange={(e) => setCode(e.target.value)} style={{ ...inputStyle, flex: 1, fontFamily: "monospace" }} />
              <Button onClick={() => go("join")} disabled={busy || nameMissing || !code.trim()}>Join</Button>
            </div>
            {error?.action === "join" && <ErrorText>{error.text}</ErrorText>}
          </div>
        </Panel>
        <Panel title="Or set up your MC (MCP)">
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ ...hint, margin: 0 }}>One MC per country. You&apos;ll get two codes: a member code for your national team, and an LC code to send to each LCP.</p>
            <div>
              <label htmlFor="mc-country" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", marginBottom: 6 }}>Your MC&apos;s country</label>
              <CountryCombobox id="mc-country" value={mcCountry} onChange={(c) => { setTaken(null); setMcCountry(c); }} />
            </div>
            {mcCountry && (taken ? (
              <p role="status" style={{ fontSize: 13, margin: 0, padding: "10px 12px", borderRadius: 8, backgroundColor: "var(--color-navy-dim)", color: "var(--color-body)", lineHeight: 1.5 }}>
                <strong>{taken}</strong> is already on {APP_NAME}. Ask your MCP for the member code and join above.
              </p>
            ) : (
              <p style={{ fontSize: 13, margin: 0 }}>It will be called <strong>{mcName}</strong>. You can rename it later.</p>
            ))}
            <div><Button onClick={() => go("create")} disabled={busy || nameMissing || !mcCountry || Boolean(taken)}>Create {mcName || "the MC"}</Button></div>
            {error?.action === "create" && <ErrorText>{error.text}</ErrorText>}
          </div>
        </Panel>
        {nameMissing && (code.trim() || mcCountry) && <p style={{ ...hint, margin: 0 }}>Add your name first.</p>}
      </div>
      <SamplePreview />
    </div>
  );
}

/** What the national view looks like, with made-up LCs: numbers only. */
function SamplePreview() {
  const sample = [
    { lc: "AIESEC in North", gv: 14, gta: 3, gte: 2 },
    { lc: "AIESEC in Capital", gv: 11, gta: 5, gte: 1 },
    { lc: "AIESEC in Coast", gv: 6, gta: 1, gte: 0 },
  ];
  const th: React.CSSProperties = { textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "6px 10px" };
  const td: React.CSSProperties = { fontSize: 13, padding: "6px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", fontVariantNumeric: "tabular-nums" };
  return (
    <section aria-label="Example of the national view" style={{ border: "1px dashed var(--color-border)", borderRadius: 10, padding: 14, backgroundColor: "var(--color-surface)" }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-secondary)", margin: "0 0 4px" }}>Example</p>
      <p style={{ fontSize: 13, color: "var(--color-body)", margin: "0 0 10px" }}>Approvals this term, per LC and product. Made-up LCs: you&apos;ll see your own once they link.</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th scope="col" style={{ ...th, textAlign: "left" }}>LC</th><th scope="col" style={th}>oGV</th><th scope="col" style={th}>oGTa</th><th scope="col" style={th}>oGTe</th><th scope="col" style={th}>Total</th>
        </tr></thead>
        <tbody>
          {sample.map((r) => (
            <tr key={r.lc}>
              <td style={{ ...td, textAlign: "left" }}>{r.lc}</td><td style={td}>{r.gv}</td><td style={td}>{r.gta}</td><td style={td}>{r.gte}</td>
              <td style={{ ...td, fontWeight: 700 }}>{r.gv + r.gta + r.gte}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "10px 0 0" }}>Numbers only. No names, tasks, chats or check-ins ever leave an LC.</p>
    </section>
  );
}

function McDashboard({ mc, onChanged }: { mc: Mc; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("approved");
  const [version, setVersion] = useState(0);
  // Targets, pace and health (migration 20261108006). Missing before it runs: the page works without them.
  const [health, setHealth] = useState<Record<string, LcHealth>>({});
  const [insights, setInsights] = useState<Record<string, Insight>>({});
  const [termStart, setTermStart] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [editingTargets, setEditingTargets] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingTargets, setSavingTargets] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dash, h, term, ins] = await Promise.all([
          supabase.rpc("mc_dashboard", { p_mc_id: mc.id }),
          supabase.rpc("mc_lc_health", { p_mc_id: mc.id }),
          supabase.rpc("mc_term_start", { p_mc_id: mc.id }),
          supabase.rpc("mc_lc_insights", { p_mc_id: mc.id }),
        ]);
        if (dash.error) throw new Error(dash.error.message);
        const start = !term.error && typeof term.data === "string" ? term.data : null;
        const t = start
          ? await supabase.from("mc_lc_targets").select("project_id, product, metric, target").eq("mc_id", mc.id).eq("term_start", start)
          : { data: [], error: null };
        if (cancelled) return;
        setRows((dash.data ?? []) as Row[]);
        setHealth(Object.fromEntries(((h.error ? [] : h.data ?? []) as LcHealth[]).map((x) => [x.project_id, x])));
        // Before migration 20261108007 there are no insights: those columns and panels stay hidden.
        setInsights(Object.fromEntries(((ins.error ? [] : ins.data ?? []) as Insight[]).map((x) => [x.project_id, x])));
        setTermStart(start);
        setTargets(Object.fromEntries(((t.error ? [] : t.data ?? []) as { project_id: string; product: string; metric: string; target: number }[])
          .map((x) => [targetKey(x.project_id, x.product, x.metric), x.target])));
        setError(null);
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
  const progress = termStart ? termProgress(termStart) : 0;
  const hasInsights = Object.keys(insights).length > 0;
  const hasTargets = metric === "approved" || metric === "realized";
  const targetOf = (lcId: string, product: string, m: string) => targets[targetKey(lcId, product, m)];
  const lcTarget = (lcId: string, m: string) => {
    const vals = PRODUCTS.map((p) => targetOf(lcId, p.code, m)).filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const attention = needsAttention(lcs.map((l) => ({
    id: l.id, name: l.name,
    applied: Object.values(l.values).reduce((s, r) => s + r.applied, 0),
    approved: Object.values(l.values).reduce((s, r) => s + r.approved, 0),
    approvedTarget: lcTarget(l.id, "approved"),
    health: health[l.id] ?? null,
  })), progress);

  function startEditingTargets() {
    setDraft(Object.fromEntries(lcs.flatMap((l) => PRODUCTS.map((p) => [targetKey(l.id, p.code, metric), String(targetOf(l.id, p.code, metric) ?? "")]))));
    setEditingTargets(true);
  }

  async function saveTargets() {
    if (!termStart) return;
    setSavingTargets(true);
    setError(null);
    try {
      const upserts: Record<string, unknown>[] = [];
      const removals: { project_id: string; product: string }[] = [];
      for (const l of lcs) for (const p of PRODUCTS) {
        const raw = (draft[targetKey(l.id, p.code, metric)] ?? "").trim();
        const before = targetOf(l.id, p.code, metric);
        if (raw === "") { if (before !== undefined) removals.push({ project_id: l.id, product: p.code }); continue; }
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) throw new Error(`"${raw}" isn't a whole number (${l.name}, ${p.label})`);
        if (n !== before) upserts.push({ mc_id: mc.id, project_id: l.id, product: p.code, metric, term_start: termStart, target: n, updated_at: new Date().toISOString() });
      }
      if (upserts.length) {
        const { error: err } = await supabase.from("mc_lc_targets").upsert(upserts, { onConflict: "mc_id,project_id,product,metric,term_start" });
        if (err) throw new Error(err.message);
      }
      for (const r of removals) {
        const { error: err } = await supabase.from("mc_lc_targets").delete()
          .eq("mc_id", mc.id).eq("project_id", r.project_id).eq("product", r.product).eq("metric", metric).eq("term_start", termStart);
        if (err) throw new Error(err.message);
      }
      setEditingTargets(false);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(`Couldn't save the targets: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingTargets(false);
    }
  }

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
      ...(hasTargets ? [
        { header: `Target ${metric}`, value: (l: (typeof lcs)[number]) => lcTarget(l.id, metric) ?? "" },
        { header: "Pace", value: (l: (typeof lcs)[number]) => {
          const t = lcTarget(l.id, metric);
          const p = t !== null ? pace(Object.values(l.values).reduce((s, r) => s + r[metric], 0), t, progress) : null;
          return p ? PACE_LABEL[p.status] : "";
        } },
      ] : []),
    ]));
  }

  const th: React.CSSProperties = { textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
      {/* Until LCs link, the codes are the next step; after that, what needs attention comes first. */}
      {loaded && lcs.length === 0 && <McCodes mc={mc} prominent onChanged={onChanged} />}
      {attention.length > 0 && (
        <Panel title={`Needs attention (${attention.length})`}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {attention.map((a) => (
              <li key={a.id} style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <AlertTriangle size={14} color="var(--color-warning, #B45309)" aria-hidden="true" style={{ marginTop: 2, flexShrink: 0 }} />
                <div>
                  <strong style={{ fontSize: 13 }}>{a.name}</strong>
                  <ul style={{ margin: "2px 0 0", paddingLeft: 16, fontSize: 12, color: "var(--color-body)" }}>
                    {a.reasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Stat label="LCs linked" value={String(lcs.length)} />
        <Stat label="Approved this term" value={String(sum("approved"))} />
        <Stat label="Realized this term" value={String(sum("realized"))} />
        <Stat label="Applied → approved" value={conv} note="national conversion" />
      </div>
      <ErrorText>{error}</ErrorText>
      <Panel title="By LC" action={<div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <Tabs value={metric} onChange={(m) => { setEditingTargets(false); setMetric(m); }} tabs={[{ id: "approved", label: "Approved" }, { id: "realized", label: "Realized" }, { id: "applied", label: "Applied" }, { id: "completed", label: "Completed" }]} />
        {hasTargets && termStart && lcs.length > 0 && (editingTargets ? (
          <>
            <Button onClick={saveTargets} disabled={savingTargets}>{savingTargets ? "Saving…" : "Save targets"}</Button>
            <Button variant="ghost" onClick={() => setEditingTargets(false)}>Cancel</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={startEditingTargets}><Target size={14} aria-hidden="true" /> Set {metric} targets</Button>
        ))}
        <Button variant="secondary" onClick={exportCsv} disabled={lcs.length === 0}><Download size={14} aria-hidden="true" /> CSV</Button>
      </div>}>
        {hasTargets && termStart && (
          <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0, padding: "10px 14px 0" }}>
            {editingTargets
              ? `Targets for this term (since ${formatDay(termStart)}), per LC and product. Leave a box empty for no target.`
              : `Term started ${formatDay(termStart)}: ${Math.round(progress * 100)}% of the way through. With targets set, each LC shows how it's doing for this point in the term.`}
          </p>
        )}
        {!loaded ? <div className="animate-pulse" style={{ height: 120, backgroundColor: "var(--color-dimmed-bg)" }} /> : lcs.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>
            No LCs linked yet. Send each LCP the LC code above; their LC&apos;s numbers show up here once they link.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th scope="col" style={{ ...th, textAlign: "left" }}>LC</th>
                {hasInsights && <th scope="col" style={{ ...th, textAlign: "left" }}>Approvals, 12 weeks</th>}
                {PRODUCTS.map((p) => <th key={p.code} scope="col" style={th}>{p.label}</th>)}
                <th scope="col" style={th}>Total</th>
                {mc.isMcp && <th scope="col" style={th}><span className="sr-only">Remove</span></th>}
              </tr></thead>
              <tbody>
                {lcs.map((l) => (
                  <tr key={l.id}>
                    <td style={{ ...td, textAlign: "left" }}>
                      <strong style={{ fontWeight: 600 }}>{l.name}</strong> <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{l.members} {l.members === 1 ? "member" : "members"}</span>
                      {health[l.id] && <span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)" }}>{sourceLabel(health[l.id])}</span>}
                    </td>
                    {hasInsights && (
                      <td style={{ ...td, textAlign: "left" }}>
                        {insights[l.id] && <Trend weekly={insights[l.id].weekly} thisTerm={insights[l.id].approved} lastTerm={insights[l.id].last_term_to_date} lcName={l.name} />}
                      </td>
                    )}
                    {PRODUCTS.map((p) => {
                      const actual = l.values[p.code]?.[metric] ?? 0;
                      const t = hasTargets ? targetOf(l.id, p.code, metric) : undefined;
                      const key = targetKey(l.id, p.code, metric);
                      return (
                        <td key={p.code} style={td}>
                          {editingTargets ? (
                            <input aria-label={`${l.name} ${p.label} ${metric} target`} inputMode="numeric" value={draft[key] ?? ""}
                              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value.replace(/[^0-9]/g, "") }))}
                              style={{ ...inputStyle, width: 64, height: 30, textAlign: "right" }} />
                          ) : t !== undefined ? <>{actual}<span style={{ color: "var(--color-secondary)" }}> / {t}</span></> : actual}
                        </td>
                      );
                    })}
                    <td style={{ ...td, fontWeight: 700 }}>
                      <TotalWithPace actual={Object.values(l.values).reduce((s, r) => s + r[metric], 0)} target={hasTargets ? lcTarget(l.id, metric) : null} progress={progress} metric={metric} />
                    </td>
                    {mc.isMcp && <td style={td}><button type="button" aria-label={`Remove ${l.name}`} onClick={() => removeLc(l.id, l.name)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={13} color="var(--color-secondary)" /></button></td>}
                  </tr>
                ))}
                <tr>
                  <th scope="row" style={{ ...td, textAlign: "left", fontWeight: 700 }}>National</th>
                  {hasInsights && <td style={td} />}
                  {PRODUCTS.map((p) => <td key={p.code} style={{ ...td, fontWeight: 700 }}>{sum(metric, p.code)}</td>)}
                  <td style={{ ...td, fontWeight: 700 }}>{sum(metric)}</td>
                  {mc.isMcp && <td style={td} />}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {hasInsights && <FunnelPanel lcs={lcs.map((l) => ({ id: l.id, name: l.name }))} insights={insights} />}
      {hasInsights && <TeamPanel lcs={lcs.map((l) => ({ id: l.id, name: l.name }))} insights={insights} />}
      <McTemplateReview lcNames={Object.fromEntries(lcs.map((l) => [l.id, l.name]))} />
      <LinkStatus mc={mc} version={version} />
      {!(loaded && lcs.length === 0) && <McCodes mc={mc} prominent={false} onChanged={onChanged} />}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <>
      <Button variant="secondary" onClick={async () => {
        setState((await copyText(text)) ? "copied" : "failed");
        setTimeout(() => setState("idle"), 2500);
      }}>
        {state === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {state === "copied" ? "Copied" : label}
      </Button>
      <span role="status" style={{ fontSize: 12, color: state === "failed" ? "var(--color-error)" : "var(--color-secondary)" }}>
        {state === "copied" ? `${label.replace(/^Copy /, "")} copied.` : state === "failed" ? "Couldn't copy: select it and copy by hand." : ""}
      </span>
    </>
  );
}

/** The two codes, each with what it's for and a ready-to-send message. */
function McCodes({ mc, prominent, onChanged }: { mc: Mc; prominent: boolean; onChanged: () => void }) {
  const [country, setCountry] = useState(mc.countryCode ?? "");
  const [editingCountry, setEditingCountry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const lcMessage = `Hi! ${mc.name} now follows national numbers in ${APP_NAME}. To link your LC: open ${origin}/settings#national (LC presidents only) and enter the LC code ${mc.lcCode}. We only see counts (applied, approved, realized), never names.`;
  const memberMessage = `Join ${mc.name}'s national view in ${APP_NAME}: sign in at ${origin}/mc and enter the member code ${mc.memberCode}.`;

  async function saveCountry(code: string) {
    setCountry(code);
    setError(null);
    const { error: err } = await supabase.from("mcs").update({ country_code: code || null }).eq("id", mc.id);
    if (err?.code === "23505") {
      const { data: other } = await supabase.rpc("mc_in_country", { p_country: code });
      setCountry(mc.countryCode ?? "");
      setError(`${typeof other === "string" && other ? other : "Another MC"} is already set up for ${countryByCode(code)?.name ?? code}. There's one MC per country.`);
    } else if (err) setError(`Couldn't save the country: ${err.message}`);
    else onChanged();
  }

  const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
  const codeStyle: React.CSSProperties = { fontFamily: "monospace", fontSize: prominent ? 22 : 16, fontWeight: 700, letterSpacing: "0.08em", color: "var(--color-navy)" };
  return (
    <Panel title={prominent ? "Next: get your LCs linked" : "Codes"}>
      <div style={{ padding: 14, display: "grid", gap: 16 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 2px" }}>LC code, for LC presidents</p>
          <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 8px" }}>Send this to each LCP so they can link their LC (Settings → LC &amp; departments → National (MC)).</p>
          <div style={row}><span style={codeStyle}>{mc.lcCode}</span><CopyButton text={mc.lcCode} label="Copy code" /><CopyButton text={lcMessage} label="Copy invite message" /></div>
        </div>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 2px" }}>Member code, for your national team</p>
          <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 8px" }}>Only for people on the MC: it opens this national view.</p>
          <div style={row}><span style={{ ...codeStyle, fontSize: 16 }}>{mc.memberCode}</span><CopyButton text={mc.memberCode} label="Copy code" /><CopyButton text={memberMessage} label="Copy invite message" /></div>
        </div>
        {mc.isMcp && (!mc.countryCode || editingCountry) ? (
          <div style={{ maxWidth: 360 }} onKeyDown={(e) => { if (e.key === "Escape" && editingCountry) setEditingCountry(false); }}>
            <label htmlFor="mc-set-country" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", marginBottom: 6 }}>Your MC&apos;s country, to see which LCs haven&apos;t linked yet</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <CountryCombobox id="mc-set-country" value={country} autoFocus={editingCountry} onChange={(c) => { setEditingCountry(false); void saveCountry(c); }} />
              </div>
              {editingCountry && <Button variant="ghost" onClick={() => setEditingCountry(false)}>Cancel</Button>}
            </div>
          </div>
        ) : mc.countryCode ? (
          <p style={{ fontSize: 13, margin: 0 }}>
            Country: <strong>{countryByCode(mc.countryCode)?.flag} {countryByCode(mc.countryCode)?.name ?? mc.countryCode}</strong>
            {mc.isMcp && (
              <> · <button type="button" onClick={() => setEditingCountry(true)} style={{ background: "none", border: "none", padding: 0, fontSize: 13, color: "var(--color-navy)", textDecoration: "underline", cursor: "pointer" }}>Change</button></>
            )}
          </p>
        ) : null}
        <ErrorText>{error}</ErrorText>
      </div>
    </Panel>
  );
}

/** Which LCs are linked, and which LCs on the app in the MC's country aren't yet. */
function LinkStatus({ mc, version }: { mc: Mc; version: number }) {
  const [linked, setLinked] = useState<string[] | null>(null);
  const [inCountry, setInCountry] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [l, c] = await Promise.all([
        supabase.rpc("mc_linked_lcs", { p_mc_id: mc.id }),
        mc.countryCode ? supabase.rpc("lcs_in_country", { p_country: mc.countryCode }) : Promise.resolve({ data: [], error: null }),
      ]);
      if (cancelled) return;
      // Before migration 20261108001 mc_linked_lcs doesn't exist: show nothing.
      setLinked(l.error ? null : ((l.data ?? []) as { name: string }[]).map((x) => x.name));
      setInCountry(((c.data ?? []) as { name: string }[]).map((x) => x.name));
    })();
    return () => { cancelled = true; };
  }, [mc.id, mc.countryCode, version]);

  if (!linked) return null;
  const notYet = inCountry.filter((n) => !linked.includes(n));
  if (linked.length === 0 && notYet.length === 0 && !mc.countryCode) return null;
  const countryName = countryByCode(mc.countryCode)?.name ?? mc.countryCode;
  const known = linked.length + notYet.length;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const reminder = `Hi! ${notYet.join(", ")}: ${mc.name} follows national numbers in ${APP_NAME} and your LC isn't linked yet. LCPs: open ${origin}/settings#national and enter the LC code ${mc.lcCode}. We only see counts, never names.`;
  const chip: React.CSSProperties = { display: "inline-block", fontSize: 12, padding: "3px 8px", borderRadius: 999, margin: "0 6px 6px 0" };
  return (
    <Panel title={mc.countryCode && known > 0 ? `LCs: ${linked.length} of ${known} in ${countryName} linked` : "LCs"}>
      <div style={{ padding: 14, display: "grid", gap: 10 }}>
        {mc.countryCode && known > 0 && (
          <div role="progressbar" aria-label="LCs linked" aria-valuemin={0} aria-valuemax={known} aria-valuenow={linked.length}
            style={{ height: 6, borderRadius: 999, backgroundColor: "var(--color-dimmed-bg)", overflow: "hidden" }}>
            <div style={{ width: `${(linked.length / known) * 100}%`, height: "100%", backgroundColor: "var(--color-navy)" }} />
          </div>
        )}
        {linked.length > 0 && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", margin: "0 0 6px" }}>Linked ({linked.length})</p>
            {linked.map((n) => <span key={n} style={{ ...chip, backgroundColor: "var(--color-navy-dim)", color: "var(--color-navy)" }}>{n}</span>)}
          </div>
        )}
        {mc.countryCode && notYet.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>
            {linked.length === 0
              ? `No LCs in ${countryName} are on ${APP_NAME} yet. Once an LCP creates their LC here, it shows up in this list until they link it.`
              : `Every LC in ${countryName} that's on ${APP_NAME} is linked.`}
          </p>
        )}
        {mc.countryCode && (
          <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
            Only LCs with a country saved are listed. An LC without one gets it the next time its president signs in (they&apos;re asked once).
          </p>
        )}
        {notYet.length > 0 && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", margin: "0 0 6px" }}>On {APP_NAME} but not linked yet ({notYet.length})</p>
            {notYet.map((n) => <span key={n} style={{ ...chip, border: "1px solid var(--color-border)", color: "var(--color-body)" }}>{n}</span>)}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <CopyButton text={reminder} label="Copy reminder message" />
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** The MCP renames the MC (e.g. to its official name). */
function RenameMc({ mc, onDone }: { mc: Mc; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(mc.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const name = value.trim();
    if (!name || name === mc.name) { setEditing(false); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("mcs").update({ name }).eq("id", mc.id);
    setBusy(false);
    if (err) { setError(`Couldn't rename: ${err.message}`); return; }
    setEditing(false);
    onDone();
  }

  if (!editing) return <Button variant="secondary" onClick={() => { setValue(mc.name); setEditing(true); }}>Rename</Button>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
      style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input aria-label="MC name" value={value} maxLength={80} autoFocus onChange={(e) => setValue(e.target.value)} style={{ ...inputStyle, width: 240 }} />
        <Button type="submit" disabled={busy || !value.trim()}>Save</Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

const targetKey = (projectId: string, product: string, metric: string) => `${projectId}:${product}:${metric}`;

const PACE_COLOR: Record<PaceStatus, { bg: string; fg: string }> = {
  ahead:             { bg: "var(--color-success-bg, #E7F6EE)", fg: "var(--color-success, #0F7B3F)" },
  "on-track":        { bg: "var(--color-success-bg, #E7F6EE)", fg: "var(--color-success, #0F7B3F)" },
  "slightly-behind": { bg: "var(--color-warning-bg, #FFF6E0)", fg: "var(--color-warning, #8A5A00)" },
  behind:            { bg: "var(--color-error-bg, #FDECEC)",   fg: "var(--color-error, #B42318)" },
};

/** "12 / 30 (40%)" and an on-track badge, or just the number without a target. */
function TotalWithPace({ actual, target, progress, metric }: { actual: number; target: number | null; progress: number; metric: string }) {
  const p = target !== null ? pace(actual, target, progress) : null;
  if (!p || target === null) return <>{actual}</>;
  const c = PACE_COLOR[p.status];
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <span>{actual} / {target} <span style={{ fontWeight: 400, color: "var(--color-secondary)" }}>({p.pct}%)</span></span>
      <span title={`${p.expected} ${metric} expected by now`} style={{ fontSize: 11, fontWeight: 600, padding: "1px 6px", borderRadius: 999, backgroundColor: c.bg, color: c.fg }}>
        {PACE_LABEL[p.status]}
      </span>
    </span>
  );
}

/** mc_lc_insights() row. */
interface Insight extends FunnelCounts {
  project_id: string; weekly: number[]; last_term_to_date: number;
  members: number; joined_term: number; term_ended: number; active_14d: number;
  handover_due: number; handover_written: number; recruits_term: number; recruits_joined: number;
}

/** A small line of weekly approvals, and this term against the same point last term. */
function Trend({ weekly, thisTerm, lastTerm, lcName }: { weekly: number[]; thisTerm: number; lastTerm: number; lcName: string }) {
  const w = 84, h = 22, pad = 2;
  const max = Math.max(1, ...weekly);
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, weekly.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const points = weekly.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const diff = thisTerm - lastTerm;
  const label = `${lcName}: approvals per week over the last 12 weeks, oldest first: ${weekly.join(", ")}`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
        <title>{`Last 12 weeks: ${weekly.join(", ")}`}</title>
        <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="var(--color-border)" strokeWidth={1} />
        <polyline points={points} fill="none" stroke="var(--color-navy)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(weekly.length - 1)} cy={y(weekly[weekly.length - 1] ?? 0)} r={2.5} fill="var(--color-navy)" />
      </svg>
      <span style={{ fontSize: 11, color: "var(--color-secondary)", whiteSpace: "nowrap" }} title="Approvals this term against the same point last term">
        {diff === 0 ? "same as last term" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs last term`}
      </span>
    </span>
  );
}

const pct = (n: number | null) => (n === null ? "-" : `${Math.round(n * 100)}%`);

/** Where each LC loses people: the funnel this term, and the step to coach on. */
function FunnelPanel({ lcs, insights }: { lcs: { id: string; name: string }[]; insights: Record<string, Insight> }) {
  const rows = lcs.filter((l) => insights[l.id]);
  const national = rows.reduce<FunnelCounts>((t, l) => {
    const i = insights[l.id];
    return { applied: t.applied + i.applied, accepted: t.accepted + i.accepted, approved: t.approved + i.approved, realized: t.realized + i.realized, completed: t.completed + i.completed };
  }, { applied: 0, accepted: 0, approved: 0, realized: 0, completed: 0 });
  const th: React.CSSProperties = { textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const cell = (c: FunnelCounts, i: number) => <span style={{ fontSize: 11, color: "var(--color-secondary)" }}> {pct(stepRate(c, i))}</span>;
  return (
    <Panel title="Where each LC loses people">
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0, padding: "10px 14px 0" }}>
        This term, by the date each stage was reached. Percentages are each step&apos;s conversion (up to 100%: some reach a stage this term after the one before it last term). A step 20% or more below the national rate is flagged with what to coach on.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th scope="col" style={{ ...th, textAlign: "left" }}>LC</th>
            <th scope="col" style={th}>Applied</th><th scope="col" style={th}>Accepted</th><th scope="col" style={th}>Approved</th>
            <th scope="col" style={th}>Realized</th><th scope="col" style={th}>Completed</th>
            <th scope="col" style={{ ...th, textAlign: "left" }}>Coach on</th>
          </tr></thead>
          <tbody>
            {rows.map((l) => {
              const c = insights[l.id];
              const weak = weakestStep(c, national);
              return (
                <tr key={l.id}>
                  <th scope="row" style={{ ...td, textAlign: "left", fontWeight: 600 }}>{l.name}</th>
                  <td style={td}>{c.applied}</td>
                  <td style={td}>{c.accepted}{cell(c, 0)}</td>
                  <td style={td}>{c.approved}{cell(c, 1)}</td>
                  <td style={td}>{c.realized}{cell(c, 2)}</td>
                  <td style={td}>{c.completed}</td>
                  <td style={{ ...td, textAlign: "left" }}>
                    {weak ? <span title={`${FUNNEL_STEPS[weak.index].label}: ${pct(weak.rate)} (national ${pct(weak.nationalRate)})`}>
                      <strong style={{ fontWeight: 600 }}>{FUNNEL_STEPS[weak.index].coach}</strong>
                      <span style={{ fontSize: 11, color: "var(--color-secondary)" }}> {FUNNEL_STEPS[weak.index].label.toLowerCase()} {pct(weak.rate)} vs {pct(weak.nationalRate)}</span>
                    </span> : <span style={{ color: "var(--color-secondary)" }}>-</span>}
                  </td>
                </tr>
              );
            })}
            <tr>
              <th scope="row" style={{ ...td, textAlign: "left", fontWeight: 700 }}>National</th>
              <td style={{ ...td, fontWeight: 700 }}>{national.applied}</td>
              <td style={{ ...td, fontWeight: 700 }}>{national.accepted}{cell(national, 0)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{national.approved}{cell(national, 1)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{national.realized}{cell(national, 2)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{national.completed}</td>
              <td style={td} />
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** What EXPA can't show: the team behind the numbers. Counts only. */
function TeamPanel({ lcs, insights }: { lcs: { id: string; name: string }[]; insights: Record<string, Insight> }) {
  const rows = lcs.filter((l) => insights[l.id]);
  const th: React.CSSProperties = { textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", fontVariantNumeric: "tabular-nums" };
  return (
    <Panel title="Beyond exchanges">
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0, padding: "10px 14px 0" }}>
        What EXPA doesn&apos;t show, as counts only: the team, whether it uses {APP_NAME}, and whether VPs wrote their handover notes this term.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th scope="col" style={{ ...th, textAlign: "left" }}>LC</th>
            <th scope="col" style={th}>Members</th>
            <th scope="col" style={th} title="Joined since the term started">Joined</th>
            <th scope="col" style={th} title="Still listed although their term has ended">Term ended</th>
            <th scope="col" style={th} title="Opened the app in the last 14 days">Active (14 days)</th>
            <th scope="col" style={th} title="Each department with a VP, plus the LC-wide note">Handover notes</th>
            <th scope="col" style={th} title="Applied to join this term, and how many joined">Recruitment</th>
          </tr></thead>
          <tbody>
            {rows.map((l) => {
              const i = insights[l.id];
              const active = i.members ? i.active_14d / i.members : 0;
              return (
                <tr key={l.id}>
                  <th scope="row" style={{ ...td, textAlign: "left", fontWeight: 600 }}>{l.name}</th>
                  <td style={td}>{i.members}</td>
                  <td style={td}>{i.joined_term}</td>
                  <td style={td}>{i.term_ended}</td>
                  <td style={td}>{i.active_14d} <span style={{ fontSize: 11, color: active < 0.3 && i.members > 0 ? "var(--color-error)" : "var(--color-secondary)" }}>({pct(i.members ? active : null)})</span></td>
                  <td style={td}>{i.handover_written} / {i.handover_due}</td>
                  <td style={td}>{i.recruits_joined} joined <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>of {i.recruits_term}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
