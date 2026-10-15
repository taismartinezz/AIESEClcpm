"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { RECEIPT_BUCKET, RECEIPT_MAX_BYTES, RECEIPT_TYPES, receiptExtension } from "@/lib/finance";
import type { Department, FinanceCategory, FinanceEntry, FinanceEntryType } from "@/types";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";

/** Finance lead adds or edits a manual ledger entry (claim-created entries are read-only). */
export default function EntryModal({
  projectId, userId, currency, departments, categories, entry, onClose, onSaved,
}: {
  projectId: string; userId: string; currency: string;
  departments: Department[]; categories: FinanceCategory[];
  entry?: FinanceEntry; onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState<FinanceEntryType>(entry?.type ?? "expense");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [date, setDate] = useState(entry?.date ?? new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? "");
  const [departmentId, setDepartmentId] = useState(entry?.departmentId ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(amount);

  async function save() {
    if (!(value > 0)) { setError("Enter an amount greater than zero."); return; }
    if (file && (!RECEIPT_TYPES.includes(file.type) || file.size > RECEIPT_MAX_BYTES)) {
      setError("Receipts must be a JPG, PNG, WebP, HEIC or PDF file of at most 10 MB.");
      return;
    }
    setSaving(true);
    setError(null);
    let uploadedPath: string | null = null;
    try {
      if (file) {
        uploadedPath = `${projectId}/${userId}/${crypto.randomUUID()}.${receiptExtension(file)}`;
        const { error: upErr } = await supabase.storage.from(RECEIPT_BUCKET).upload(uploadedPath, file, { contentType: file.type });
        if (upErr) { uploadedPath = null; throw new Error(`receipt upload failed: ${upErr.message}`); }
      }
      const fields = {
        type, amount: Math.round(value * 100) / 100, entry_date: date,
        category_id: categoryId || null, department_id: departmentId || null, description: description.trim(),
        ...(uploadedPath ? { receipt_path: uploadedPath } : {}),
      };
      const { error: dbErr } = entry
        ? await supabase.from("finance_entries").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", entry.id)
        : await supabase.from("finance_entries").insert({ ...fields, project_id: projectId, currency, recorded_by: userId });
      if (dbErr) throw new Error(dbErr.message);
      onSaved();
    } catch (e) {
      if (uploadedPath) await supabase.storage.from(RECEIPT_BUCKET).remove([uploadedPath]).catch(() => {});
      setError(`Couldn't save the entry: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={entry ? "Edit entry" : "Add an entry"} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !(value > 0)}>{saving ? "Saving…" : "Save"}</Button>
      </>}
    >
      <div role="radiogroup" aria-label="Type" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(["income", "expense"] as const).map((t) => (
          <Button key={t} variant={type === t ? "primary" : "secondary"} aria-pressed={type === t} onClick={() => setType(t)} style={{ flex: 1 }}>
            {t === "income" ? "Income" : "Expense"}
          </Button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={`Amount (${entry?.currency ?? currency})`} htmlFor="entry-amount">
          <input id="entry-amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Date" htmlFor="entry-date">
          <input id="entry-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <Field label="Description" htmlFor="entry-description">
        <input id="entry-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Sponsorship from Partner Co." style={inputStyle} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Category" htmlFor="entry-category">
          <select id="entry-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={selectStyle}>
            <option value="">Uncategorised</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Department (optional)" htmlFor="entry-department">
          <select id="entry-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={selectStyle}>
            <option value="">Whole LC</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label={entry?.receiptPath ? "Replace receipt (optional)" : "Receipt (optional)"} htmlFor="entry-receipt">
        <input id="entry-receipt" type="file" accept={RECEIPT_TYPES.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
      </Field>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
