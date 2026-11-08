"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { balanceAt, flowBetween, formatMoney, growthSince, mapEntry, monthlyBalances } from "@/lib/finance";
import { formatDay } from "@/lib/dates";
import type { FinanceAccount, FinanceEntry } from "@/types";
import type { Mc } from "@/hooks/useMcs";
import { Button, ErrorText, Panel, Stat, Tabs } from "@/components/lc/ui";
import AccountStatement from "@/components/finance/AccountStatement";
import { BalanceBars, BalanceTrend, Sparkline } from "@/components/finance/TrackerCharts";

interface FinanceLc { project_id: string; name: string; currency: string | null; term_start_date: string | null; finance_reviewed_on: string | null; has_university_account: boolean }

const STALE_REVIEW_DAYS = 60;

/**
 * The MC's finance view (MCP and VP Finance only): every linked LC's account
 * and, where the university funds the LC, its university money, side by side,
 * with one LC opening as its full statement. The VP Finance keeps the books
 * here; the MCP reads.
 */
export default function McFinance({ mc, userId }: { mc: Mc; userId: string }) {
  const [lcs, setLcs] = useState<FinanceLc[] | null>(null);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [account, setAccount] = useState<FinanceAccount>("lc");
  const canEdit = mc.isVpFinance;
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await supabase.rpc("mc_finance_lcs", { p_mc_id: mc.id });
        if (err) throw new Error(err.message);
        const list = (data ?? []) as FinanceLc[];
        const rows = list.length
          ? await supabase.from("finance_entries").select("*").in("project_id", list.map((l) => l.project_id)).order("entry_date")
          : { data: [], error: null };
        if (rows.error) throw new Error(rows.error.message);
        if (cancelled) return;
        setLcs(list);
        setEntries((rows.data ?? []).map(mapEntry));
        setError(null);
      } catch (e) {
        if (!cancelled) { setLcs([]); setError(`Couldn't load finance: ${e instanceof Error ? e.message : String(e)}`); }
      }
    })();
    return () => { cancelled = true; };
  }, [mc.id, version]);

  const reload = () => setVersion((v) => v + 1);
  const anyUniversity = (lcs ?? []).some((l) => l.has_university_account);
  const shownAccount: FinanceAccount = anyUniversity ? account : "lc";

  // Per LC: both accounts' numbers, worked out once.
  const summary = (lcs ?? []).map((l) => {
    const mine = entries.filter((e) => e.projectId === l.project_id);
    const lcAcc = mine.filter((e) => e.account === "lc");
    const uni = mine.filter((e) => e.account === "university");
    const from = l.term_start_date ?? today.slice(0, 4) + "-01-01";
    const daysSinceReview = l.finance_reviewed_on ? Math.floor((Date.parse(today) - Date.parse(l.finance_reviewed_on)) / 86_400_000) : null;
    return {
      ...l,
      currency: l.currency ?? "USD",
      lcEntries: lcAcc, uniEntries: uni,
      balance: balanceAt(lcAcc, today),
      uniBalance: l.has_university_account ? balanceAt(uni, today) : null,
      sinceReview: growthSince(lcAcc, l.finance_reviewed_on, today),
      term: flowBetween(lcAcc, from, today),
      uniTerm: flowBetween(uni, from, today),
      series: monthlyBalances(lcAcc, from, today),
      uniSeries: monthlyBalances(uni, from, today),
      lastEntry: mine.reduce<string | null>((m, e) => (!m || e.date > m ? e.date : m), null),
      reviewStale: daysSinceReview === null || daysSinceReview > STALE_REVIEW_DAYS,
    };
  });

  if (lcs === null) return <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />;

  const open = summary.find((l) => l.project_id === openId);
  if (open) {
    const acct: FinanceAccount = open.has_university_account ? account : "lc";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={() => setOpenId(null)}><ArrowLeft size={14} aria-hidden="true" /> All LCs</Button>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--color-navy)" }}>{open.name}</h2>
          <span style={{ flex: 1 }} />
          {canEdit && <UniversityToggle projectId={open.project_id} on={open.has_university_account} onChanged={reload} />}
        </div>
        {open.has_university_account && (
          <Tabs<FinanceAccount> value={acct} onChange={setAccount} tabs={[{ id: "lc", label: "LC account" }, { id: "university", label: "University money" }]} />
        )}
        <AccountStatement
          key={`${open.project_id}:${acct}`}
          projectId={open.project_id} userId={userId} lcName={open.name} account={acct} currency={open.currency}
          entries={acct === "lc" ? open.lcEntries : open.uniEntries}
          termStart={open.term_start_date} reviewedOn={acct === "lc" ? open.finance_reviewed_on : null}
          canEdit={canEdit} canMarkReviewed={canEdit && acct === "lc"} onChanged={reload}
        />
      </div>
    );
  }

  // National totals, per currency (LCs can keep their books in different currencies).
  const currencies = [...new Set(summary.map((l) => l.currency))];
  const single = currencies.length === 1 ? currencies[0] : null;
  const money = (n: number, c = single ?? "USD") => formatMoney(n, c);
  const totalBy = (pick: (l: (typeof summary)[number]) => number | null) =>
    currencies.map((c) => ({ c, v: summary.filter((l) => l.currency === c).reduce((s, l) => s + (pick(l) ?? 0), 0) }));
  const fmtTotals = (t: { c: string; v: number }[]) => t.map((x) => formatMoney(x.v, x.c)).join(" · ");
  const uniLcs = summary.filter((l) => l.has_university_account);
  const below = summary.filter((l) => (shownAccount === "lc" ? l.balance : l.uniBalance ?? 0) < 0);
  const staleReviews = summary.filter((l) => l.reviewStale);
  const scoped = shownAccount === "lc" ? summary : uniLcs;

  // The national trend: the sum of every LC's end-of-month balance (same currency only).
  const national = (() => {
    if (!single || scoped.length === 0) return [];
    const byMonth = new Map<string, number>();
    for (const l of scoped) for (const p of shownAccount === "lc" ? l.series : l.uniSeries) byMonth.set(p.month, (byMonth.get(p.month) ?? 0) + p.balance);
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, balance]) => ({ month, balance: Math.round(balance * 100) / 100 }));
  })();

  const th: React.CSSProperties = { textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const pct = (g: number | null) => (g === null ? "–" : `${g > 0 ? "+" : ""}${(g * 100).toFixed(1)}%`);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
        Only the MCP and the VP Finance see this. {canEdit ? "You keep the books: open an LC to add or edit its transactions." : "Read-only: your VP Finance keeps the books."}
      </p>
      <ErrorText>{error}</ErrorText>
      {summary.length === 0 ? (
        <Panel title="Finance">
          <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>No LCs linked yet. Each LC&apos;s account shows up here once its president links it with the LC code.</p>
        </Panel>
      ) : (
        <>
          {anyUniversity && (
            <Tabs<FinanceAccount> value={shownAccount} onChange={setAccount} tabs={[{ id: "lc", label: "LC accounts" }, { id: "university", label: `University money (${uniLcs.length} LC${uniLcs.length === 1 ? "" : "s"})` }]} />
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Stat label={shownAccount === "lc" ? "All LC accounts" : "All university money"} value={fmtTotals(totalBy((l) => (shownAccount === "lc" ? l.balance : l.uniBalance)))} note={`${scoped.length} LC${scoped.length === 1 ? "" : "s"}, as of ${formatDay(today)}`} />
            <Stat label="In this term" value={fmtTotals(totalBy((l) => (shownAccount === "lc" ? l.term.income : l.uniTerm.income)))} />
            <Stat label="Out this term" value={fmtTotals(totalBy((l) => (shownAccount === "lc" ? l.term.expense : l.uniTerm.expense)))} />
            <Stat label="Below zero" value={String(below.length)} note={below.length ? below.map((l) => l.name).join(", ") : "None"} />
            {shownAccount === "lc" && <Stat label={`Not reviewed in ${STALE_REVIEW_DAYS} days`} value={String(staleReviews.length)} note={staleReviews.length ? staleReviews.map((l) => l.name).slice(0, 3).join(", ") + (staleReviews.length > 3 ? "…" : "") : "All reviewed"} />}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 12 }}>
            <Panel title={shownAccount === "lc" ? "Every LC's balance" : "Every LC's university money"}>
              <div style={{ padding: "10px 8px" }}>
                <BalanceBars
                  items={scoped.map((l) => ({ id: l.project_id, label: l.name, value: (shownAccount === "lc" ? l.balance : l.uniBalance) ?? 0, note: single ? undefined : l.currency }))}
                  format={(n) => money(n)} onSelect={(id) => setOpenId(id)}
                />
                <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "8px 6px 0" }}>Select an LC to open its statement.{single ? "" : " LCs use different currencies: compare within one currency."}</p>
              </div>
            </Panel>
            <Panel title="National balance over the term">
              <div style={{ padding: "12px 14px 8px" }}>
                {national.length > 0
                  ? <BalanceTrend series={national} currency={single ?? "USD"} format={(n) => money(n)} label="Sum of every LC's balance at the end of each month" />
                  : <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>{single ? "The trend appears after the first transaction." : "LCs keep their books in different currencies, so there's no single national line."}</p>}
              </div>
            </Panel>
          </div>

          <Panel title="By LC">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead><tr>
                  <th scope="col" style={{ ...th, textAlign: "left" }}>LC</th>
                  <th scope="col" style={th}>LC account</th>
                  <th scope="col" style={{ ...th, textAlign: "left" }}>Trend</th>
                  <th scope="col" style={th}>Since last review</th>
                  <th scope="col" style={th}>In this term</th>
                  <th scope="col" style={th}>Out this term</th>
                  <th scope="col" style={th}>University money</th>
                  <th scope="col" style={th}>Last transaction</th>
                  <th scope="col" style={th}>Reviewed</th>
                </tr></thead>
                <tbody>
                  {[...summary].sort((a, b) => a.name.localeCompare(b.name)).map((l) => (
                    <tr key={l.project_id}>
                      <th scope="row" style={{ ...td, textAlign: "left", fontWeight: 600 }}>
                        <button type="button" onClick={() => setOpenId(l.project_id)} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--color-navy)", cursor: "pointer", textDecoration: "underline" }}>{l.name}</button>
                      </th>
                      <td style={{ ...td, fontWeight: 600, color: l.balance < 0 ? "var(--color-error)" : "var(--color-body)" }}>{formatMoney(l.balance, l.currency)}</td>
                      <td style={{ ...td, textAlign: "left" }}><Sparkline values={l.series.map((p) => p.balance)} label={`${l.name} balance trend this term`} /></td>
                      <td style={{ ...td, color: l.sinceReview === null ? "var(--color-secondary)" : l.sinceReview < 0 ? "var(--color-error)" : "var(--color-success)" }}>{pct(l.sinceReview)}</td>
                      <td style={td}>{formatMoney(l.term.income, l.currency)}</td>
                      <td style={td}>{formatMoney(l.term.expense, l.currency)}</td>
                      <td style={{ ...td, color: l.uniBalance === null ? "var(--color-secondary)" : undefined }}>{l.uniBalance === null ? "Not used" : formatMoney(l.uniBalance, l.currency)}</td>
                      <td style={td}>{formatDay(l.lastEntry)}</td>
                      <td style={{ ...td, color: l.reviewStale ? "var(--color-error)" : "var(--color-body)" }}>{l.finance_reviewed_on ? formatDay(l.finance_reviewed_on) : "Never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

/** The VP Finance turns an LC's university account on or off (the LC can too, from its Finance page). */
function UniversityToggle({ projectId, on, onChanged }: { projectId: string; on: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function flip() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("set_university_account", { p_project_id: projectId, p_on: !on });
    setBusy(false);
    if (err) setError(err.message); else onChanged();
  }
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-body)", cursor: "pointer" }}>
        <input type="checkbox" checked={on} disabled={busy} onChange={flip} />
        University gives this LC money
      </label>
      <ErrorText>{error}</ErrorText>
    </span>
  );
}
