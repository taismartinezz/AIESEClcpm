"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Download, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatMoney } from "@/lib/finance";
import { formatDay } from "@/lib/dates";
import { downloadCsv, toCsv } from "@/lib/csv";
import { askConfirm } from "@/components/ui/confirm";
import type { Mc } from "@/hooks/useMcs";
import { Button, ErrorText, Field, Modal, Panel, Stat, inputStyle, selectStyle } from "@/components/lc/ui";
import {
  FY_MONTHS, budgetCsvRows, compareCodes, defaultPaymentDate, fyLabel, fyOf, fyRange, mapLine, mapPayment, monthIndex,
  parseAmount, parsePastedBudget, spreadEvenly, summarize, tagTotals, totals,
  type BudgetLine, type BudgetPayment, type LineSummary,
} from "@/lib/mcBudget";

/**
 * The MC's own budget: budget vs actuals per account line and month (July to
 * June), as in the MC Budget Tool sheet. Each line can have many payments, with
 * tags (e.g. "FallCo 2026") and comments. The MCP and VP Finance read it; the
 * VP Finance keeps it (the MCP does while there's no VP Finance).
 */
export default function McBudget({ mc }: { mc: Mc }) {
  const today = new Date().toISOString().slice(0, 10);
  const [fy, setFy] = useState(() => fyOf(today));
  const [lines, setLines] = useState<BudgetLine[] | null>(null);
  const [prevLines, setPrevLines] = useState<BudgetLine[]>([]);
  const [payments, setPayments] = useState<BudgetPayment[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [tag, setTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ line: BudgetLine | null; parentId: string | null } | null>(null);
  const [openLine, setOpenLine] = useState<{ id: string; month: number | null } | null>(null);
  const [pasting, setPasting] = useState(false);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { from, to } = fyRange(fy);
        const [cur, prev, pays, all, keep, cur$] = await Promise.all([
          supabase.from("mc_budget_lines").select("*").eq("mc_id", mc.id).eq("fy_start", fy),
          supabase.from("mc_budget_lines").select("*").eq("mc_id", mc.id).eq("fy_start", fy - 1),
          supabase.from("mc_budget_payments").select("*").eq("mc_id", mc.id).gte("paid_on", from).lte("paid_on", to).order("paid_on"),
          supabase.from("mc_budget_lines").select("fy_start").eq("mc_id", mc.id),
          supabase.rpc("can_keep_mc_budget", { p_mc_id: mc.id }),
          mc.countryCode ? supabase.rpc("currency_for_country", { p_country: mc.countryCode }) : Promise.resolve({ data: null, error: null }),
        ]);
        for (const r of [cur, prev, pays, all]) if (r.error) throw new Error(r.error.message);
        if (cancelled) return;
        setLines((cur.data ?? []).map(mapLine));
        setPrevLines((prev.data ?? []).map(mapLine));
        setPayments((pays.data ?? []).map(mapPayment));
        setYears([...new Set(((all.data ?? []) as { fy_start: number }[]).map((r) => r.fy_start))]);
        setCanEdit(!keep.error && keep.data === true);
        if (typeof cur$.data === "string" && cur$.data) setCurrency(cur$.data);
        setError(null);
      } catch (e) {
        if (!cancelled) { setLines([]); setError(`Couldn't load the budget: ${e instanceof Error ? e.message : String(e)}`); }
      }
    })();
    return () => { cancelled = true; };
  }, [mc.id, mc.countryCode, fy, version]);

  const tree = useMemo(() => summarize(lines ?? [], payments, { tag, prevLines }), [lines, payments, tag, prevLines]);
  const sum = useMemo(() => totals(tree), [tree]);
  const tags = useMemo(() => tagTotals(payments), [payments]);
  const money = (n: number) => formatMoney(n, currency);
  const yearOptions = [...new Set([...years, fyOf(today), fyOf(today) + 1, fy])].sort((a, b) => b - a);

  if (lines === null) return <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />;

  const open = openLine ? (lines.find((l) => l.id === openLine.id) ?? null) : null;
  const exportCsv = () => {
    const [header, ...rows] = budgetCsvRows(tree, fy);
    downloadCsv(`${mc.name} budget ${fyLabel(fy)}${tag ? ` (${tag})` : ""}.csv`, toCsv(rows, header.map((h, i) => ({ header: String(h), value: (r: (string | number)[]) => r[i] }))));
  };

  async function copyLastYear() {
    const tops = prevLines.filter((l) => !l.parentId);
    const ins = await supabase.from("mc_budget_lines").insert(tops.map((l) => ({ mc_id: mc.id, fy_start: fy, code: l.code, name: l.name, prev_budget: l.budget, budget: 0, sort_order: l.sortOrder, notes: null }))).select("id, code");
    if (ins.error) { setError(ins.error.message); return; }
    const idByCode = new Map(((ins.data ?? []) as { id: string; code: string }[]).map((r) => [r.code, r.id]));
    const prevById = new Map(prevLines.map((l) => [l.id, l]));
    const kids = prevLines.filter((l) => l.parentId).map((l) => ({ mc_id: mc.id, fy_start: fy, code: l.code, name: l.name, prev_budget: l.budget, budget: 0, sort_order: l.sortOrder, parent_id: idByCode.get(prevById.get(l.parentId!)?.code ?? "") ?? null }));
    if (kids.length) {
      const k = await supabase.from("mc_budget_lines").insert(kids);
      if (k.error) setError(k.error.message);
    }
    reload();
  }

  const th: React.CSSProperties = { textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 8px", whiteSpace: "nowrap", backgroundColor: "var(--color-surface)" };
  const td: React.CSSProperties = { fontSize: 12, padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const sticky: React.CSSProperties = { position: "sticky", left: 0, zIndex: 1, backgroundColor: "var(--color-surface)", textAlign: "left" };
  const cellMoney = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? "–" : money(n));

  const renderLine = (s: LineSummary, depth: number) => {
    const l = s.line;
    const isParent = s.children.length > 0;
    const top = { borderTop: "1px solid var(--color-border)" };
    const weight = isParent || depth === 0 ? 600 : 400;
    return (
      <Fragment key={l.id}>
        <tr>
          <th scope="row" rowSpan={2} style={{ ...td, ...sticky, ...top, fontWeight: weight, paddingLeft: 8 + depth * 16, verticalAlign: "top", minWidth: 200, maxWidth: 280, whiteSpace: "normal" }}>
            <button type="button" onClick={() => setOpenLine({ id: l.id, month: null })} title="Payments, tags and comments"
              style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--color-navy)", cursor: "pointer", textAlign: "left" }}>
              <span style={{ color: "var(--color-secondary)", marginRight: 6 }}>{l.code}</span>
              <span style={{ textDecoration: "underline" }}>{l.name}</span>
            </button>
            {l.notes && <span title={l.notes} style={{ display: "block", fontSize: 11, fontWeight: 400, color: "var(--color-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.notes}</span>}
          </th>
          <td style={{ ...td, ...top, textAlign: "left", color: "var(--color-secondary)" }}>Budget</td>
          <td rowSpan={2} style={{ ...td, ...top, verticalAlign: "top", color: "var(--color-secondary)" }}>{cellMoney(s.prevBudget)}</td>
          <td rowSpan={2} style={{ ...td, ...top, verticalAlign: "top", fontWeight: weight }}>{money(s.budget)}</td>
          {FY_MONTHS.map((m, i) => <td key={m} style={{ ...td, ...top, color: "var(--color-secondary)" }}>{s.plan ? cellMoney(s.plan[i]) : ""}</td>)}
          <td style={{ ...td, ...top, color: "var(--color-secondary)" }}>{s.plan ? money(s.plan.reduce((a, b) => a + b, 0)) : ""}</td>
          <td rowSpan={2} style={{ ...td, ...top, verticalAlign: "top", fontWeight: 600, color: s.remaining < 0 ? "var(--color-error)" : "var(--color-body)" }}>{money(s.remaining)}</td>
          {canEdit && (
            <td rowSpan={2} style={{ ...td, ...top, verticalAlign: "top" }}>
              <button type="button" aria-label={`Edit ${l.code} ${l.name}`} onClick={() => setEditing({ line: l, parentId: l.parentId })} style={iconBtn}><Pencil size={13} aria-hidden="true" /></button>
            </td>
          )}
        </tr>
        <tr>
          <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>Actuals</td>
          {s.actual.map((a, i) => {
            const over = s.plan ? a > s.plan[i] && s.plan[i] > 0 : false;
            return (
              <td key={i} style={td}>
                {a !== 0 ? (
                  <button type="button" onClick={() => setOpenLine({ id: l.id, month: i })} title={`${FY_MONTHS[i]} payments`}
                    style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", color: over ? "var(--color-error)" : "var(--color-body)", textDecoration: "underline dotted" }}>
                    {money(a)}
                  </button>
                ) : canEdit && !isParent ? (
                  <button type="button" onClick={() => setOpenLine({ id: l.id, month: i })} aria-label={`Add a ${FY_MONTHS[i]} payment to ${l.name}`}
                    style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", color: "var(--color-secondary)" }}>–</button>
                ) : <span style={{ color: "var(--color-secondary)" }}>–</span>}
              </td>
            );
          })}
          <td style={{ ...td, fontWeight: 600 }}>{money(s.spent)}</td>
        </tr>
        {s.children.map((c) => renderLine(c, depth + 1))}
      </Fragment>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div data-tour="mc-finance" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-body)" }}>
          Budget year
          <select value={fy} onChange={(e) => { setTag(null); setFy(Number(e.target.value)); }} style={{ ...selectStyle, width: "auto" }}>
            {yearOptions.map((y) => <option key={y} value={y}>{fyLabel(y)} (July {y} to June {y + 1})</option>)}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        {canEdit && <Button variant="secondary" onClick={() => setPasting(true)}><ClipboardPaste size={14} aria-hidden="true" /> Paste from your sheet</Button>}
        {canEdit && <Button onClick={() => setEditing({ line: null, parentId: null })}><Plus size={14} aria-hidden="true" /> Add line</Button>}
        {lines.length > 0 && <Button variant="ghost" onClick={exportCsv}><Download size={14} aria-hidden="true" /> CSV</Button>}
      </div>
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
        The MC&apos;s own budget. Only the MCP and the VP Finance see it. {canEdit ? "You keep it: open a line to record what was spent, with tags and comments." : "Read-only: your VP Finance keeps it."} LC accounts stay with their LC.
      </p>
      <ErrorText>{error}</ErrorText>

      {lines.length === 0 ? (
        <Panel title={`Budget ${fyLabel(fy)}`}>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            <p style={{ fontSize: 13, color: "var(--color-body)", margin: 0, lineHeight: 1.5 }}>
              No budget lines for {fyLabel(fy)} yet. {canEdit
                ? "Paste the account rows from your budget sheet (code, account, last year's budget, this year's budget, and the months if you have them), or add lines one by one."
                : "Your VP Finance sets it up."}
            </p>
            {canEdit && prevLines.length > 0 && (
              <Button variant="secondary" onClick={copyLastYear}>Start from {fyLabel(fy - 1)}&apos;s {prevLines.length} lines</Button>
            )}
          </div>
        </Panel>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Stat label={`Budget ${fyLabel(fy)}`} value={money(sum.budget)} note={sum.prevBudget !== null ? `${fyLabel(fy - 1)}: ${money(sum.prevBudget)}` : undefined} />
            <Stat label={tag ? `Spent on ${tag}` : "Spent so far"} value={money(sum.spent)} note={sum.budget > 0 ? `${Math.round((sum.spent / sum.budget) * 100)}% of the budget` : undefined} />
            <Stat label="Left" value={money(sum.remaining)} note={tree.filter((t) => t.remaining < 0).length ? `${tree.filter((t) => t.remaining < 0).length} line(s) over budget` : "No line over budget"} />
            <Stat label="Payments" value={String(payments.length)} note={tags.length ? `${tags.length} tag${tags.length === 1 ? "" : "s"}` : "No tags yet"} />
          </div>

          {tags.length > 0 && (
            <div role="group" aria-label="Filter actuals by tag" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <Tag size={13} color="var(--color-secondary)" aria-hidden="true" />
              <button type="button" aria-pressed={tag === null} onClick={() => setTag(null)} style={chip(tag === null)}>All payments</button>
              {tags.map((t) => (
                <button key={t.tag} type="button" aria-pressed={tag === t.tag} onClick={() => setTag(tag === t.tag ? null : t.tag)} style={chip(tag === t.tag)}>
                  {t.tag} · {money(t.spent)}
                </button>
              ))}
            </div>
          )}

          <Panel title={tag ? `Budget v actuals ${fyLabel(fy)}: only payments tagged ${tag}` : `Budget v actuals ${fyLabel(fy)}`}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1500 }}>
                <thead><tr>
                  <th scope="col" style={{ ...th, ...sticky }}>Account</th>
                  <th scope="col" style={{ ...th, textAlign: "left" }}><span className="sr-only">Row</span></th>
                  <th scope="col" style={th}>Budget {fyLabel(fy - 1)}</th>
                  <th scope="col" style={th}>Budget {fyLabel(fy)}</th>
                  {FY_MONTHS.map((m) => <th key={m} scope="col" style={th}>{m}</th>)}
                  <th scope="col" style={th}>Total</th>
                  <th scope="col" style={th}>Left</th>
                  {canEdit && <th scope="col" style={th}><span className="sr-only">Edit</span></th>}
                </tr></thead>
                <tbody>
                  {tree.map((s) => renderLine(s, 0))}
                  <tr>
                    <th scope="row" rowSpan={2} style={{ ...td, ...sticky, fontWeight: 700, borderTop: "2px solid var(--color-border)", verticalAlign: "top" }}>Total</th>
                    <td style={{ ...td, textAlign: "left", color: "var(--color-secondary)", borderTop: "2px solid var(--color-border)" }}>Budget</td>
                    <td rowSpan={2} style={{ ...td, verticalAlign: "top", borderTop: "2px solid var(--color-border)", color: "var(--color-secondary)" }}>{cellMoney(sum.prevBudget)}</td>
                    <td rowSpan={2} style={{ ...td, verticalAlign: "top", borderTop: "2px solid var(--color-border)", fontWeight: 700 }}>{money(sum.budget)}</td>
                    {FY_MONTHS.map((m, i) => <td key={m} style={{ ...td, borderTop: "2px solid var(--color-border)", color: "var(--color-secondary)" }}>{sum.plan ? cellMoney(sum.plan[i]) : ""}</td>)}
                    <td style={{ ...td, borderTop: "2px solid var(--color-border)", color: "var(--color-secondary)" }}>{sum.plan ? money(sum.plan.reduce((a, b) => a + b, 0)) : ""}</td>
                    <td rowSpan={2} style={{ ...td, verticalAlign: "top", borderTop: "2px solid var(--color-border)", fontWeight: 700, color: sum.remaining < 0 ? "var(--color-error)" : "var(--color-body)" }}>{money(sum.remaining)}</td>
                    {canEdit && <td rowSpan={2} style={{ ...td, borderTop: "2px solid var(--color-border)" }} />}
                  </tr>
                  <tr>
                    <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>Actuals</td>
                    {sum.actual.map((a, i) => <td key={i} style={{ ...td, fontWeight: 600 }}>{cellMoney(a)}</td>)}
                    <td style={{ ...td, fontWeight: 700 }}>{money(sum.spent)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: 0, padding: "8px 14px" }}>
              Select an account for its payments, tags and comments, or a month&apos;s actuals for that month&apos;s payments. Red: over budget.
            </p>
          </Panel>
        </>
      )}

      {editing && (
        <LineEditor
          mcId={mc.id} fy={fy} line={editing.line} parentId={editing.parentId} lines={lines} currency={currency}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {open && openLine && (
        <LinePayments
          mcId={mc.id} fy={fy} line={open} month={openLine.month} today={today} canEdit={canEdit} money={money}
          sub={lines.filter((l) => l.parentId === open.id)}
          payments={payments.filter((p) => p.lineId === open.id || lines.some((l) => l.parentId === open.id && l.id === p.lineId))}
          allTags={tags.map((t) => t.tag)} lineName={(id) => lines.find((l) => l.id === id)}
          onClose={() => setOpenLine(null)} onChanged={reload}
          onEditLine={() => { setOpenLine(null); setEditing({ line: open, parentId: open.parentId }); }}
          onAddSub={() => { setOpenLine(null); setEditing({ line: null, parentId: open.id }); }}
        />
      )}
      {pasting && <PasteLines mcId={mc.id} fy={fy} lines={lines} onClose={() => setPasting(false)} onDone={() => { setPasting(false); reload(); }} />}
    </div>
  );
}

const iconBtn: React.CSSProperties = { background: "none", border: "none", padding: 4, cursor: "pointer", color: "var(--color-secondary)", display: "inline-flex", borderRadius: 6 };
const chip = (on: boolean): React.CSSProperties => ({
  fontSize: 12, padding: "4px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
  border: `1px solid ${on ? "var(--color-navy)" : "var(--color-border)"}`,
  backgroundColor: on ? "var(--color-navy-dim)" : "var(--color-surface)",
  color: on ? "var(--color-navy)" : "var(--color-body)", fontWeight: on ? 600 : 400,
});
const tagChip: React.CSSProperties = { fontSize: 11, padding: "1px 8px", borderRadius: 999, border: "1px solid var(--color-border)", color: "var(--color-body)", whiteSpace: "nowrap" };

/** Add or edit a line: code, account, budgets, the plan per month and notes. */
function LineEditor({ mcId, fy, line, parentId, lines, currency, onClose, onSaved }: {
  mcId: string; fy: number; line: BudgetLine | null; parentId: string | null; lines: BudgetLine[]; currency: string; onClose: () => void; onSaved: () => void;
}) {
  const hasKids = !!line && lines.some((l) => l.parentId === line.id);
  const [code, setCode] = useState(line?.code ?? "");
  const [name, setName] = useState(line?.name ?? "");
  const [parent, setParent] = useState<string>(parentId ?? "");
  const [prev, setPrev] = useState(line?.prevBudget === null || line?.prevBudget === undefined ? "" : String(line.prevBudget));
  const [budget, setBudget] = useState(line ? String(line.budget) : "");
  const [months, setMonths] = useState<string[]>(() => (line?.monthBudgets ?? Array(12).fill(0)).map((m) => (m ? String(m) : "")));
  const [notes, setNotes] = useState(line?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parents = lines.filter((l) => !l.parentId && l.id !== line?.id).sort((a, b) => compareCodes(a.code, b.code));
  const planTotal = months.reduce((s, m) => s + (parseAmount(m) ?? 0), 0);

  async function save() {
    const b = hasKids ? 0 : parseAmount(budget) ?? 0;
    const p = prev.trim() === "" ? null : parseAmount(prev);
    if (!code.trim() || !name.trim()) { setError("Give the line a code and an account name."); return; }
    if (prev.trim() !== "" && p === null) { setError("Last year's budget isn't a number."); return; }
    const plan = months.map((m) => parseAmount(m) ?? 0);
    const row = {
      code: code.trim(), name: name.trim(), parent_id: parent || null, prev_budget: p, budget: b,
      month_budgets: plan.some((m) => m !== 0) ? plan : null, notes: notes.trim() || null,
    };
    setBusy(true);
    const res = line
      ? await supabase.from("mc_budget_lines").update(row).eq("id", line.id)
      : await supabase.from("mc_budget_lines").insert({ ...row, mc_id: mcId, fy_start: fy, sort_order: 0 });
    setBusy(false);
    if (res.error) setError(/duplicate|unique/i.test(res.error.message) ? `There's already a line ${code.trim()} in ${fyLabel(fy)}.` : res.error.message);
    else onSaved();
  }

  async function remove() {
    if (!line) return;
    if (!(await askConfirm(`Delete ${line.code} ${line.name}${hasKids ? " and its sub-lines" : ""}, with every payment recorded on it?`, { confirmLabel: "Delete line" }))) return;
    setBusy(true);
    const res = await supabase.from("mc_budget_lines").delete().eq("id", line.id);
    setBusy(false);
    if (res.error) setError(res.error.message); else onSaved();
  }

  const id = (s: string) => `budget-line-${s}`;
  return (
    <Modal title={line ? `Edit ${line.code} ${line.name}` : parentId ? "Add a sub-line" : "Add a budget line"} onClose={onClose} width={620}
      footer={<>
        {line && <Button variant="danger" onClick={remove} disabled={busy}><Trash2 size={14} aria-hidden="true" /> Delete</Button>}
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </>}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, 1fr) 3fr", gap: 10 }}>
        <Field label="Code" htmlFor={id("code")}><input id={id("code")} value={code} onChange={(e) => setCode(e.target.value)} placeholder="6300" maxLength={20} style={inputStyle} /></Field>
        <Field label="Account" htmlFor={id("name")}><input id={id("name")} value={name} onChange={(e) => setName(e.target.value)} placeholder="Conference Hotel" maxLength={120} style={inputStyle} /></Field>
      </div>
      {!hasKids && parents.length > 0 && (
        <Field label="Under" htmlFor={id("parent")} hint="Sub-lines add up into their line, like 6251-01 under 6251 Strategic Fund.">
          <select id={id("parent")} value={parent} onChange={(e) => setParent(e.target.value)} style={selectStyle}>
            <option value="">Nothing: a line of its own</option>
            {parents.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}
          </select>
        </Field>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={`Budget ${fyLabel(fy - 1)} (${currency})`} htmlFor={id("prev")} hint="Leave empty to use last year's line with the same code.">
          <input id={id("prev")} inputMode="decimal" value={prev} onChange={(e) => setPrev(e.target.value)} style={inputStyle} />
        </Field>
        <Field label={`Budget ${fyLabel(fy)} (${currency})`} htmlFor={id("budget")} hint={hasKids ? "Adds up from its sub-lines." : undefined}>
          <input id={id("budget")} inputMode="decimal" value={hasKids ? "" : budget} disabled={hasKids} onChange={(e) => setBudget(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      {!hasKids && (
        <fieldset style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 12px", margin: "0 0 14px" }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", padding: "0 4px" }}>Plan per month (optional)</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 8 }}>
            {FY_MONTHS.map((m, i) => (
              <label key={m} style={{ fontSize: 11, color: "var(--color-secondary)" }}>
                {m}
                <input inputMode="decimal" aria-label={`${m} budget`} value={months[i]} onChange={(e) => setMonths(months.map((x, j) => (j === i ? e.target.value : x)))} style={{ ...inputStyle, padding: "6px 8px" }} />
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, fontSize: 12, color: "var(--color-secondary)" }}>
            <span>Months add up to {formatMoney(planTotal, currency)}</span>
            <span style={{ flex: 1 }} />
            <button type="button" style={linkBtn} onClick={() => setMonths(spreadEvenly(parseAmount(budget) ?? 0).map((n) => (n ? String(n) : "")))}>Spread the budget evenly</button>
            <button type="button" style={linkBtn} onClick={() => setMonths(Array(12).fill(""))}>Clear</button>
          </div>
        </fieldset>
      )}
      <Field label="Comments" htmlFor={id("notes")}>
        <textarea id={id("notes")} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} style={{ ...inputStyle, resize: "vertical" }} />
      </Field>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}

const linkBtn: React.CSSProperties = { background: "none", border: "none", padding: 0, fontSize: 12, color: "var(--color-navy)", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" };

/** A line's payments (the actuals): many per line, each with tags and a comment. */
function LinePayments({ mcId, fy, line, month, today, canEdit, money, sub, payments, allTags, lineName, onClose, onChanged, onEditLine, onAddSub }: {
  mcId: string; fy: number; line: BudgetLine; month: number | null; today: string; canEdit: boolean; money: (n: number) => string;
  sub: BudgetLine[]; payments: BudgetPayment[]; allTags: string[]; lineName: (id: string) => BudgetLine | undefined;
  onClose: () => void; onChanged: () => void; onEditLine: () => void; onAddSub: () => void;
}) {
  const [onlyMonth, setOnlyMonth] = useState(month);
  const [editing, setEditing] = useState<BudgetPayment | null>(null);
  const shown = payments.filter((p) => onlyMonth === null || monthIndex(p.paidOn) === onlyMonth).sort((a, b) => b.paidOn.localeCompare(a.paidOn));
  const total = shown.reduce((s, p) => s + p.amount, 0);
  const targets = sub.length ? [line, ...sub] : [line];

  async function remove(p: BudgetPayment) {
    if (!(await askConfirm(`Delete the payment "${p.description}" (${money(p.amount)})?`, { confirmLabel: "Delete payment" }))) return;
    const res = await supabase.from("mc_budget_payments").delete().eq("id", p.id);
    if (!res.error) onChanged();
  }

  return (
    <Modal title={`${line.code} ${line.name}`} onClose={onClose} width={680}
      footer={canEdit ? <>
        {!line.parentId && <Button variant="ghost" onClick={onAddSub}><Plus size={14} aria-hidden="true" /> Sub-line</Button>}
        <Button variant="ghost" onClick={onEditLine}><Pencil size={14} aria-hidden="true" /> Edit line</Button>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </> : <Button variant="secondary" onClick={onClose}>Done</Button>}>
      {line.notes && <p style={{ fontSize: 13, color: "var(--color-body)", margin: "0 0 12px", padding: "8px 10px", borderRadius: 8, backgroundColor: "var(--color-navy-dim)", whiteSpace: "pre-wrap" }}>{line.notes}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <select aria-label="Month" value={onlyMonth ?? ""} onChange={(e) => setOnlyMonth(e.target.value === "" ? null : Number(e.target.value))} style={{ ...selectStyle, width: "auto" }}>
          <option value="">The whole year {fyLabel(fy)}</option>
          {FY_MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <span style={{ fontSize: 13, color: "var(--color-body)" }}>{shown.length} payment{shown.length === 1 ? "" : "s"}, {money(total)} spent</span>
      </div>

      {shown.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: "0 0 12px" }}>Nothing spent here yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "0 0 14px", padding: 0, display: "flex", flexDirection: "column" }}>
          {shown.map((p) => (
            <li key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: "1px solid var(--color-border)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)" }}>{p.description}</span>
                  <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>{formatDay(p.paidOn)}</span>
                  {p.lineId !== line.id && <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>{lineName(p.lineId)?.code}</span>}
                  {p.tags.map((t) => <span key={t} style={tagChip}>{t}</span>)}
                </div>
                {p.comment && <p style={{ fontSize: 12, color: "var(--color-body)", margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{p.comment}</p>}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: p.amount < 0 ? "var(--color-success)" : "var(--color-body)", whiteSpace: "nowrap" }}>{money(p.amount)}</span>
              {canEdit && (
                <span style={{ display: "inline-flex" }}>
                  <button type="button" aria-label={`Edit ${p.description}`} onClick={() => setEditing(p)} style={iconBtn}><Pencil size={13} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Delete ${p.description}`} onClick={() => remove(p)} style={iconBtn}><Trash2 size={13} aria-hidden="true" /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <PaymentForm
          key={editing?.id ?? "new"} mcId={mcId} fy={fy} payment={editing} targets={targets} defaultLine={line.id}
          defaultDate={defaultPaymentDate(fy, onlyMonth, today)} allTags={allTags}
          onCancel={editing ? () => setEditing(null) : undefined}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </Modal>
  );
}

function PaymentForm({ mcId, fy, payment, targets, defaultLine, defaultDate, allTags, onCancel, onSaved }: {
  mcId: string; fy: number; payment: BudgetPayment | null; targets: BudgetLine[]; defaultLine: string; defaultDate: string; allTags: string[];
  onCancel?: () => void; onSaved: () => void;
}) {
  const [lineId, setLineId] = useState(payment?.lineId ?? (targets.length > 1 ? targets[1].id : defaultLine));
  const [date, setDate] = useState(payment?.paidOn ?? defaultDate);
  const [amount, setAmount] = useState(payment ? String(payment.amount) : "");
  const [description, setDescription] = useState(payment?.description ?? "");
  const [tags, setTags] = useState<string[]>(payment?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [comment, setComment] = useState(payment?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { from, to } = fyRange(fy);

  const addTag = (raw: string) => {
    const t = raw.trim().slice(0, 40);
    if (t && !tags.includes(t) && tags.length < 10) setTags([...tags, t]);
    setTagDraft("");
  };

  async function save() {
    const n = parseAmount(amount);
    const finalTags = tagDraft.trim() ? [...new Set([...tags, tagDraft.trim().slice(0, 40)])] : tags;
    if (!description.trim()) { setError("Say what the payment was for."); return; }
    if (n === null || n === 0) { setError("Enter how much was spent."); return; }
    if (date < from || date > to) { setError(`The date must be in ${fyLabel(fy)} (1 July ${fy} to 30 June ${fy + 1}).`); return; }
    const row = { line_id: lineId, mc_id: mcId, paid_on: date, amount: n, description: description.trim(), tags: finalTags, comment: comment.trim() || null };
    setBusy(true);
    const res = payment
      ? await supabase.from("mc_budget_payments").update(row).eq("id", payment.id)
      : await supabase.from("mc_budget_payments").insert(row);
    setBusy(false);
    if (res.error) { setError(res.error.message); return; }
    onSaved();
  }

  const id = (s: string) => `budget-pay-${s}`;
  return (
    <section aria-label={payment ? "Edit the payment" : "Record a payment"} style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--color-navy)", margin: "0 0 10px" }}>{payment ? "Edit the payment" : "Record a payment"}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Field label="Amount spent" htmlFor={id("amount")} hint="A refund is negative.">
          <input id={id("amount")} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250" style={inputStyle} />
        </Field>
        <Field label="Date" htmlFor={id("date")}>
          <input id={id("date")} type="date" min={from} max={to} value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </Field>
        {targets.length > 1 && (
          <Field label="Line" htmlFor={id("line")}>
            <select id={id("line")} value={lineId} onChange={(e) => setLineId(e.target.value)} style={selectStyle}>
              {targets.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Field label="What it was" htmlFor={id("desc")}>
        <input id={id("desc")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Hotel deposit" style={inputStyle} />
      </Field>
      <Field label="Tags" htmlFor={id("tags")} hint="Press Enter after each one, for example FallCo 2026.">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {tags.map((t) => (
            <span key={t} style={{ ...tagChip, display: "inline-flex", alignItems: "center", gap: 4 }}>
              {t}
              <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-secondary)", fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          ))}
          <input id={id("tags")} list={id("tag-options")} value={tagDraft} maxLength={40}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagDraft); } }}
            onBlur={() => tagDraft.trim() && addTag(tagDraft)}
            placeholder={tags.length ? "Another tag" : "FallCo 2026"} style={{ ...inputStyle, flex: "1 1 140px", width: "auto" }} />
          <datalist id={id("tag-options")}>{allTags.filter((t) => !tags.includes(t)).map((t) => <option key={t} value={t} />)}</datalist>
        </div>
      </Field>
      <Field label="Comment" htmlFor={id("comment")}>
        <textarea id={id("comment")} value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={2000} style={{ ...inputStyle, resize: "vertical" }} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : payment ? "Save payment" : "Add payment"}</Button>
      </div>
    </section>
  );
}

/** Rows pasted from the budget sheet become lines; codes already there get their budgets updated. */
function PasteLines({ mcId, fy, lines, onClose, onDone }: { mcId: string; fy: number; lines: BudgetLine[]; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parsePastedBudget(text, lines.map((l) => l.code)), [text, lines]);
  const existing = new Map(lines.map((l) => [l.code, l]));
  const fresh = parsed.lines.filter((l) => !existing.has(l.code));
  const updates = parsed.lines.filter((l) => existing.has(l.code));

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const row = (l: (typeof parsed.lines)[number], i: number) => ({ mc_id: mcId, fy_start: fy, code: l.code, name: l.name, prev_budget: l.prevBudget, budget: l.budget, month_budgets: l.monthBudgets, sort_order: i });
      const order = new Map(parsed.lines.map((l, i) => [l.code, i]));
      const tops = fresh.filter((l) => !l.parentCode);
      const ids = new Map(lines.map((l) => [l.code, l.id]));
      if (tops.length) {
        const ins = await supabase.from("mc_budget_lines").insert(tops.map((l) => row(l, order.get(l.code)!))).select("id, code");
        if (ins.error) throw new Error(ins.error.message);
        for (const r of (ins.data ?? []) as { id: string; code: string }[]) ids.set(r.code, r.id);
      }
      const kids = fresh.filter((l) => l.parentCode);
      if (kids.length) {
        const ins = await supabase.from("mc_budget_lines").insert(kids.map((l) => ({ ...row(l, order.get(l.code)!), parent_id: ids.get(l.parentCode!) ?? null })));
        if (ins.error) throw new Error(ins.error.message);
      }
      for (const l of updates) {
        const res = await supabase.from("mc_budget_lines").update({ name: l.name, prev_budget: l.prevBudget, budget: l.budget, ...(l.monthBudgets ? { month_budgets: l.monthBudgets } : {}) }).eq("id", existing.get(l.code)!.id);
        if (res.error) throw new Error(res.error.message);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Paste budget lines for ${fyLabel(fy)}`} onClose={onClose} width={680}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={run} disabled={busy || parsed.lines.length === 0}>{busy ? "Adding…" : `Add ${fresh.length} line${fresh.length === 1 ? "" : "s"}${updates.length ? `, update ${updates.length}` : ""}`}</Button>
      </>}>
      <p style={{ fontSize: 13, color: "var(--color-body)", margin: "0 0 10px", lineHeight: 1.5 }}>
        In your sheet, select the budget rows and copy them. Columns: code, account, budget {fyLabel(fy - 1)}, budget {fyLabel(fy)}, then July to June if you plan by month. ACTUALS and total rows are skipped, and 6251-01 goes under 6251.
      </p>
      <textarea aria-label="Rows from your budget sheet" value={text} onChange={(e) => setText(e.target.value)} rows={8}
        placeholder={"6251\tStrategic Fund\t5000\t6000\n6251-01\tNational projects\t2000\t2500\n6300\tConference Hotel\t12000\t13500"}
        style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", fontSize: 12, resize: "vertical" }} />
      {parsed.lines.length > 0 && (
        <div style={{ maxHeight: 220, overflow: "auto", marginTop: 10, border: "1px solid var(--color-border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>{["Code", "Account", `Budget ${fyLabel(fy - 1)}`, `Budget ${fyLabel(fy)}`, ""].map((h) => <th key={h} scope="col" style={{ textAlign: "left", padding: "6px 8px", color: "var(--color-secondary)", fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>
              {parsed.lines.map((l) => (
                <tr key={l.code} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "4px 8px", paddingLeft: l.parentCode ? 20 : 8 }}>{l.code}</td>
                  <td style={{ padding: "4px 8px" }}>{l.name}</td>
                  <td style={{ padding: "4px 8px", fontVariantNumeric: "tabular-nums" }}>{l.prevBudget ?? "–"}</td>
                  <td style={{ padding: "4px 8px", fontVariantNumeric: "tabular-nums" }}>{l.budget}{l.monthBudgets ? " · by month" : ""}</td>
                  <td style={{ padding: "4px 8px", color: "var(--color-secondary)" }}>{existing.has(l.code) ? "Updates" : "New"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {parsed.skipped > 0 && <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "8px 0 0" }}>{parsed.skipped} row{parsed.skipped === 1 ? "" : "s"} skipped (headers, totals or ACTUALS).</p>}
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
