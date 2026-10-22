"use client";

import { useMemo, useState } from "react";
import { Download, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { breakdown, formatMoney, totals, withRunningBalance } from "@/lib/finance";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { Department, FinanceCategory, FinanceEntry } from "@/types";
import { BarList, Button, ErrorText, Panel, Stat, inputStyle, selectStyle } from "@/components/lc/ui";
import ReceiptButton from "./ReceiptButton";
import EntryModal from "./EntryModal";
import { askConfirm } from "@/components/ui/confirm";

interface Props {
  projectId: string;
  userId: string;
  currency: string;
  entries: FinanceEntry[];
  categories: FinanceCategory[];
  departments: Department[];
  memberNames: Record<string, string>;
  /** Finance lead: full ledger + editing. Otherwise a VP's department-only view. */
  canEdit: boolean;
  onChanged: () => void;
}

const thStyle: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { fontSize: 13, color: "var(--color-body)", padding: "8px 10px", borderTop: "1px solid var(--color-border)", verticalAlign: "top" };

export default function LedgerView({ projectId, userId, currency, entries, categories, departments, memberNames, canEdit, onChanged }: Props) {
  const [type, setType] = useState<"all" | "income" | "expense">("all");
  const [categoryId, setCategoryId] = useState("all");
  const [departmentId, setDepartmentId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<FinanceEntry | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "Uncategorised";
  const department = (id: string | null) => departments.find((d) => d.id === id);

  // Running balance is computed over the whole ledger, then filtered for display.
  const ledger = useMemo(() => withRunningBalance(entries).reverse(), [entries]);
  const filtered = ledger.filter((e) =>
    (type === "all" || e.type === type)
    && (categoryId === "all" || (categoryId === "none" ? !e.categoryId : e.categoryId === categoryId))
    && (departmentId === "all" || (departmentId === "none" ? !e.departmentId : e.departmentId === departmentId))
    && (!from || e.date >= from) && (!to || e.date <= to)
    && (!search || e.description.toLowerCase().includes(search.toLowerCase())),
  );

  const t = totals(entries);
  const money = (n: number) => formatMoney(n, currency);
  const byCategory = [...breakdown(entries, "expense", (e) => e.categoryId).entries()]
    .map(([id, value]) => ({ key: id ?? "none", label: categoryName(id), value }))
    .sort((a, b) => b.value - a.value);
  const byDepartment = [...breakdown(entries, "expense", (e) => e.departmentId).entries()]
    .map(([id, value]) => ({ key: id ?? "none", label: department(id)?.name ?? "Whole LC", value, color: department(id)?.color }))
    .sort((a, b) => b.value - a.value);

  function exportCsv() {
    const csv = toCsv(filtered, [
      { header: "Date", value: (e) => e.date },
      { header: "Type", value: (e) => e.type },
      { header: "Amount", value: (e) => e.amount.toFixed(2) },
      { header: "Currency", value: (e) => e.currency },
      { header: "Category", value: (e) => categoryName(e.categoryId) },
      { header: "Department", value: (e) => department(e.departmentId)?.name ?? "" },
      { header: "Description", value: (e) => e.description },
      { header: "Recorded by", value: (e) => (e.recordedBy ? memberNames[e.recordedBy] ?? "" : "") },
      { header: "From expense claim", value: (e) => (e.claimId ? "yes" : "no") },
      { header: "Running balance", value: (e) => e.runningBalance.toFixed(2) },
    ]);
    downloadCsv(`ledger-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  async function remove(entry: FinanceEntry) {
    if (!(await askConfirm(`Delete "${entry.description || "this entry"}"?`))) return;
    setError(null);
    setDeletingId(entry.id);
    try {
      const { error: err } = await supabase.from("finance_entries").delete().eq("id", entry.id);
      if (err) throw new Error(err.message);
      onChanged();
    } catch (e) {
      setError(`Couldn't delete the entry: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!canEdit && (
        <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
          You&apos;re seeing income and spend tagged with the departments you lead.
        </p>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Stat label={canEdit ? "Current balance" : "Net for your departments"} value={money(t.balance)} />
        <Stat label="This month" value={money(t.monthIn - t.monthOut)} note={`In ${money(t.monthIn)} · Out ${money(t.monthOut)}`} />
        <Stat label="Year to date" value={money(t.yearIn - t.yearOut)} note={`In ${money(t.yearIn)} · Out ${money(t.yearOut)}`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 12 }}>
        <Panel title="Spend by category"><BarList items={byCategory} format={money} /></Panel>
        <Panel title="Spend by department"><BarList items={byDepartment} format={money} /></Panel>
      </div>

      <Panel
        title="Ledger"
        action={<div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={exportCsv} disabled={filtered.length === 0}><Download size={14} aria-hidden="true" /> CSV</Button>
          {canEdit && <Button onClick={() => setEditing("new")}><Plus size={14} aria-hidden="true" /> Add entry</Button>}
        </div>}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
          <input aria-label="Search descriptions" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, width: 160, height: 34 }} />
          <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as typeof type)} style={{ ...selectStyle, width: 130, height: 34 }}>
            <option value="all">All types</option><option value="income">Income</option><option value="expense">Expenses</option>
          </select>
          <select aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ ...selectStyle, width: 160, height: 34 }}>
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="none">Uncategorised</option>
          </select>
          <select aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={{ ...selectStyle, width: 180, height: 34 }}>
            <option value="all">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            {canEdit && <option value="none">Whole LC</option>}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-secondary)" }}>
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...inputStyle, width: 140, height: 34 }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-secondary)" }}>
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...inputStyle, width: 140, height: 34 }} />
          </label>
        </div>
        <ErrorText>{error}</ErrorText>
        {filtered.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: "16px 14px", margin: 0 }}>
            {entries.length === 0 ? "No entries yet." : "No entries match these filters."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th scope="col" style={thStyle}>Date</th>
                  <th scope="col" style={thStyle}>Description</th>
                  <th scope="col" style={thStyle}>Category</th>
                  <th scope="col" style={thStyle}>Department</th>
                  <th scope="col" style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                  {canEdit && <th scope="col" style={{ ...thStyle, textAlign: "right" }}>Balance</th>}
                  <th scope="col" style={thStyle}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{e.date}</td>
                    <td style={tdStyle}>
                      {e.description || <span style={{ color: "var(--color-secondary)" }}>-</span>}
                      {e.claimId && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "var(--color-secondary)", border: "1px solid var(--color-border)", borderRadius: 4, padding: "0 4px" }}>Claim</span>}
                      {e.recordedBy && memberNames[e.recordedBy] && <div style={{ fontSize: 11, color: "var(--color-secondary)" }}>by {memberNames[e.recordedBy]}</div>}
                    </td>
                    <td style={tdStyle}>{categoryName(e.categoryId)}</td>
                    <td style={tdStyle}>{department(e.departmentId)?.name ?? "Whole LC"}</td>
                    <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: e.type === "income" ? "var(--color-success)" : "var(--color-body)" }}>
                      {e.type === "income" ? "+" : "−"}{formatMoney(e.amount, e.currency)}
                    </td>
                    {canEdit && <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: "var(--color-secondary)" }}>{money(e.runningBalance)}</td>}
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", textAlign: "right" }}>
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        {e.receiptPath && <ReceiptButton path={e.receiptPath} />}
                        {canEdit && !e.claimId && (
                          <>
                            <button type="button" onClick={() => setEditing(e)} aria-label={`Edit ${e.description}`} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}><Pencil size={13} color="var(--color-secondary)" /></button>
                            <button type="button" onClick={() => remove(e)} disabled={deletingId === e.id} aria-label={`Delete ${e.description}`} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}><Trash2 size={13} color="var(--color-secondary)" /></button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {editing && (
        <EntryModal
          projectId={projectId} userId={userId} currency={currency}
          departments={departments} categories={categories}
          entry={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </div>
  );
}
