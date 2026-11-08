"use client";

import { useState } from "react";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { balanceAt, flowBetween, formatMoney, growthSince, monthlyBalances, withRunningBalance } from "@/lib/finance";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDay } from "@/lib/dates";
import type { FinanceAccount, FinanceEntry } from "@/types";
import { Button, ErrorText, Panel } from "@/components/lc/ui";
import { askConfirm } from "@/components/ui/confirm";
import { BalanceTrend } from "./TrackerCharts";
import TrackerEntryModal from "./TrackerEntryModal";

const ACCOUNT_TITLE: Record<FinanceAccount, string> = { lc: "Account statement", university: "University money" };

/**
 * One account of one LC, as the National Finance Tracker shows it: net balance
 * as of today, growth since the start of the term and since the last MC review,
 * the balance trend over the term, and every transaction with its running balance.
 */
export default function AccountStatement({
  projectId, userId, lcName, account, currency, entries, termStart, reviewedOn, canEdit, canMarkReviewed, onChanged,
}: {
  projectId: string; userId: string; lcName: string; account: FinanceAccount; currency: string;
  /** This account's entries only. */
  entries: FinanceEntry[];
  termStart: string | null; reviewedOn: string | null;
  canEdit: boolean; canMarkReviewed?: boolean; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<FinanceEntry | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const money = (n: number) => formatMoney(n, currency);

  const rows = withRunningBalance(entries);
  const balance = balanceAt(entries, today);
  const from = termStart ?? rows[0]?.date ?? today;
  const series = monthlyBalances(entries, from, today);
  const term = flowBetween(entries, from, today);
  const sinceTerm = growthSince(entries, termStart, today);
  const sinceReview = growthSince(entries, reviewedOn, today);

  async function remove(e: FinanceEntry) {
    if (!(await askConfirm(`Delete "${e.description || "this transaction"}" (${money(e.amount)})?`, { confirmLabel: "Delete" }))) return;
    setError(null);
    const { error: err } = await supabase.from("finance_entries").delete().eq("id", e.id);
    if (err) setError(`Couldn't delete: ${err.message}`); else onChanged();
  }
  async function markReviewed() {
    setError(null);
    const { error: err } = await supabase.rpc("mark_finance_reviewed", { p_project_id: projectId });
    if (err) setError(`Couldn't mark it reviewed: ${err.message}`); else onChanged();
  }
  function exportCsv() {
    downloadCsv(`${lcName} - ${ACCOUNT_TITLE[account]} - ${today}.csv`, toCsv([...rows].reverse(), [
      { header: "Month", value: (e) => new Date(`${e.date}T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" }) },
      { header: "Date", value: (e) => e.date },
      { header: "Payment Method", value: (e) => e.paymentMethod ?? "" },
      { header: "Description", value: (e) => e.description },
      { header: "Income/Expense", value: (e) => (e.type === "expense" ? "Expense" : e.type === "income" ? "Income" : "Opening balance") },
      { header: "Department / Area", value: (e) => e.area ?? "" },
      { header: "Processed on", value: (e) => e.processedVia ?? "" },
      { header: `Amount (${currency})`, value: (e) => e.amount.toFixed(2) },
      { header: "Remaining Balance", value: (e) => e.runningBalance.toFixed(2) },
      { header: "Notes / Observations", value: (e) => e.notes ?? "" },
    ]));
  }

  const pct = (g: number | null) => (g === null ? "–" : `${g > 0 ? "+" : ""}${(g * 100).toFixed(1)}%`);
  const growthColor = (g: number | null) => (g === null ? "var(--color-secondary)" : g < 0 ? "var(--color-error)" : "var(--color-success)");
  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px", whiteSpace: "nowrap", backgroundColor: "var(--color-dimmed-bg)" };
  const td: React.CSSProperties = { fontSize: 13, color: "var(--color-body)", padding: "8px 10px", borderTop: "1px solid var(--color-border)", verticalAlign: "top" };
  const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

  return (
    <section aria-label={`${lcName}: ${ACCOUNT_TITLE[account]}`} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 12 }}>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden", backgroundColor: "var(--color-surface)" }}>
          <p style={{ margin: 0, padding: "8px 14px", backgroundColor: "var(--color-navy)", color: "white", fontSize: 13, fontWeight: 600, textAlign: "center" }}>
            {lcName}: {account === "university" ? "university money" : "net balance"}
          </p>
          <p style={{ margin: 0, padding: "3px 14px", fontSize: 11, textAlign: "center", color: "var(--color-secondary)", backgroundColor: "var(--color-dimmed-bg)" }}>As of {formatDay(today)}</p>
          <p style={{ margin: 0, padding: "14px", fontSize: 40, fontWeight: 700, textAlign: "center", color: balance < 0 ? "var(--color-error)" : "var(--color-body)" }}>{money(balance)}</p>
          <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", margin: 0, borderTop: "1px solid var(--color-border)" }}>
            {[
              { label: termStart ? `Growth since ${formatDay(termStart)}` : "Growth this term", value: sinceTerm },
              { label: reviewedOn ? `Growth since last MC review (${formatDay(reviewedOn)})` : "Not reviewed by the MC yet", value: sinceReview },
            ].map((g, i) => (
              <div key={i} style={{ padding: "10px 14px", borderLeft: i ? "1px solid var(--color-border)" : undefined }}>
                <dt style={{ fontSize: 11, color: "var(--color-secondary)" }}>{g.label}</dt>
                <dd style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 600, color: growthColor(g.value) }}>{pct(g.value)}</dd>
              </div>
            ))}
          </dl>
          <p style={{ margin: 0, padding: "8px 14px", fontSize: 12, color: "var(--color-secondary)", borderTop: "1px solid var(--color-border)" }}>
            This term: in {money(term.income)} · out {money(term.expense)}
          </p>
          {canMarkReviewed && (
            <div style={{ padding: "0 14px 12px" }}>
              <Button variant="secondary" onClick={markReviewed}>Mark reviewed today</Button>
            </div>
          )}
        </div>
        <Panel title={account === "university" ? "University money over the term" : "Balance over the term"}>
          <div style={{ padding: "12px 14px 8px" }}>
            {rows.length === 0
              ? <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>The trend appears after the first transaction.</p>
              : <BalanceTrend series={series} currency={currency} format={money} label={`${lcName} ${account === "university" ? "university money" : "balance"} at the end of each month`} />}
          </div>
        </Panel>
      </div>

      <ErrorText>{error}</ErrorText>
      <Panel
        title={`${lcName}: ${ACCOUNT_TITLE[account]}`}
        action={<div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}><Download size={14} aria-hidden="true" /> CSV</Button>
          {canEdit && <Button onClick={() => setEditing("new")}><Plus size={14} aria-hidden="true" /> {account === "university" ? "Add university money" : "Add transaction"}</Button>}
        </div>}
      >
        {rows.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>
            No transactions yet.{canEdit ? " Start with the opening balance, then add each income and expense." : ""}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
              <thead><tr>
                {["Month", "Date", "Payment method", "Description", "Income / Expense", "Department / Area", "Processed on"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}
                <th scope="col" style={{ ...th, textAlign: "right" }}>Amount ({currency})</th>
                <th scope="col" style={{ ...th, textAlign: "right" }}>Remaining balance</th>
                <th scope="col" style={th}>Notes / Observations</th>
                {canEdit && <th scope="col" style={th}><span className="sr-only">Actions</span></th>}
              </tr></thead>
              <tbody>
                {[...rows].reverse().map((e) => (
                  <tr key={e.id}>
                    <td style={td}>{new Date(`${e.date}T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" })}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDay(e.date)}</td>
                    <td style={td}>{e.paymentMethod ?? ""}</td>
                    <td style={{ ...td, minWidth: 200 }}>{e.description}{e.claimId && <span style={{ display: "block", fontSize: 11, color: "var(--color-secondary)" }}>From an approved expense claim</span>}</td>
                    <td style={{ ...td, color: e.type === "expense" ? "var(--color-error)" : "var(--color-success)", fontWeight: 600 }}>
                      {e.type === "expense" ? "Expense" : e.type === "income" ? "Income" : "Opening balance"}
                    </td>
                    <td style={td}>{e.area ?? ""}</td>
                    <td style={td}>{e.processedVia ?? ""}</td>
                    <td style={num}>{e.type === "expense" ? "−" : ""}{money(e.amount)}</td>
                    <td style={{ ...num, fontWeight: 600, color: e.runningBalance < 0 ? "var(--color-error)" : "var(--color-body)" }}>{money(e.runningBalance)}</td>
                    <td style={{ ...td, minWidth: 160, fontSize: 12 }}>{e.notes ?? ""}</td>
                    {canEdit && (
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {!e.claimId && <>
                          <button type="button" aria-label={`Edit ${e.description}`} onClick={() => setEditing(e)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Pencil size={13} color="var(--color-secondary)" /></button>
                          <button type="button" aria-label={`Delete ${e.description}`} onClick={() => remove(e)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Trash2 size={13} color="var(--color-secondary)" /></button>
                        </>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {editing && (
        <TrackerEntryModal
          projectId={projectId} userId={userId} currency={currency} account={account}
          entry={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </section>
  );
}
