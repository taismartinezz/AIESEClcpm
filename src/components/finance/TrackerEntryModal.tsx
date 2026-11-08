"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { PAYMENT_METHODS, TRACKER_AREAS } from "@/lib/finance";
import type { FinanceAccount, FinanceEntry, FinanceEntryType } from "@/types";
import { Button, ErrorText, Field, Modal, inputStyle } from "@/components/lc/ui";

/** Add or edit a row of the National Finance Tracker, in its own columns. */
export default function TrackerEntryModal({ projectId, userId, currency, account, entry, onClose, onSaved }: {
  projectId: string; userId: string; currency: string; account: FinanceAccount;
  entry?: FinanceEntry; onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState<FinanceEntryType>(entry?.type ?? "expense");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [date, setDate] = useState(entry?.date ?? new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState(entry?.description ?? "");
  const [paymentMethod, setPaymentMethod] = useState(entry?.paymentMethod ?? "");
  const [area, setArea] = useState(entry?.area ?? "");
  const [processedVia, setProcessedVia] = useState(entry?.processedVia ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(amount);
  const listId = `tracker-${account}`;

  async function save() {
    if (!(value > 0)) { setError("Enter an amount greater than zero."); return; }
    if (type !== "opening" && !description.trim()) { setError("Add a description."); return; }
    setSaving(true);
    setError(null);
    const fields = {
      type, amount: Math.round(value * 100) / 100, entry_date: date,
      description: description.trim() || (type === "opening" ? "Opening balance" : ""),
      payment_method: paymentMethod.trim() || null, area: area.trim() || null,
      processed_via: processedVia.trim() || null, notes: notes.trim() || null,
    };
    const { error: err } = entry
      ? await supabase.from("finance_entries").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", entry.id)
      : await supabase.from("finance_entries").insert({ ...fields, project_id: projectId, currency, account, recorded_by: userId });
    setSaving(false);
    if (err) { setError(`Couldn't save: ${err.message}`); return; }
    onSaved();
  }

  const two: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
  return (
    <Modal
      title={entry ? "Edit transaction" : account === "university" ? "Add university money" : "Add a transaction"} onClose={onClose} width={520}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !(value > 0)}>{saving ? "Saving…" : "Save"}</Button>
      </>}
    >
      <div role="radiogroup" aria-label="Income or expense" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {([["income", "Income"], ["expense", "Expense"], ["opening", "Opening balance"]] as const).map(([t, label]) => (
          <Button key={t} variant={type === t ? "primary" : "secondary"} role="radio" aria-checked={type === t} onClick={() => setType(t)} style={{ flex: 1 }}>{label}</Button>
        ))}
      </div>
      <div style={two}>
        <Field label="Date" htmlFor="tr-date"><input id="tr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></Field>
        <Field label={`Amount (${entry?.currency ?? currency})`} htmlFor="tr-amount">
          <input id="tr-amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <Field label="Description" htmlFor="tr-description">
        <input id="tr-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200}
          placeholder={account === "university" ? "e.g. Northwestern reimbursement" : "e.g. Plane tickets for 4 delegates to FallCo"} style={inputStyle} />
      </Field>
      <div style={two}>
        <Field label="Payment method" htmlFor="tr-method">
          <input id="tr-method" list={`${listId}-methods`} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Department / Area" htmlFor="tr-area">
          <input id="tr-area" list={`${listId}-areas`} value={area} onChange={(e) => setArea(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <div style={two}>
        <Field label="Processed on" htmlFor="tr-via" hint="How it was paid or reimbursed">
          <input id="tr-via" list={`${listId}-methods`} value={processedVia} onChange={(e) => setProcessedVia(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Notes / observations" htmlFor="tr-notes">
          <input id="tr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="e.g. 70% LC - 30% MC" style={inputStyle} />
        </Field>
      </div>
      <datalist id={`${listId}-methods`}>{PAYMENT_METHODS.map((m) => <option key={m} value={m} />)}</datalist>
      <datalist id={`${listId}-areas`}>{TRACKER_AREAS.map((a) => <option key={a} value={a} />)}</datalist>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
