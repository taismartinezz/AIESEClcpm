"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { RECEIPT_BUCKET, RECEIPT_MAX_BYTES, RECEIPT_TYPES, receiptExtension } from "@/lib/finance";
import type { Department, FinanceCategory } from "@/types";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";

/**
 * Any member submits an expense claim with a receipt. The receipt is uploaded
 * to receipts/<lc>/<me>/<uuid>.<ext> first; if saving the claim then fails the
 * upload is removed again.
 */
export default function ClaimModal({
  projectId, userId, currency, departments, categories, defaultDepartmentId, onClose, onSaved,
}: {
  projectId: string; userId: string; currency: string;
  departments: Department[]; categories: FinanceCategory[]; defaultDepartmentId: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount);
  const valid = value > 0 && description.trim() && file;

  async function submit() {
    if (!file) { setError("Attach a photo or PDF of the receipt."); return; }
    if (!(value > 0)) { setError("Enter an amount greater than zero."); return; }
    if (!RECEIPT_TYPES.includes(file.type)) { setError("Receipts must be a JPG, PNG, WebP, HEIC or PDF file."); return; }
    if (file.size > RECEIPT_MAX_BYTES) { setError("Receipts can be at most 10 MB."); return; }

    setSaving(true);
    setError(null);
    const path = `${projectId}/${userId}/${crypto.randomUUID()}.${receiptExtension(file)}`;
    let uploaded = false;
    try {
      const { error: upErr } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(`receipt upload failed: ${upErr.message}`);
      uploaded = true;
      const { error: insErr } = await supabase.from("expense_claims").insert({
        project_id: projectId, submitted_by: userId, amount: Math.round(value * 100) / 100, currency,
        expense_date: date, description: description.trim(),
        department_id: departmentId || null, category_id: categoryId || null, receipt_path: path,
      });
      if (insErr) throw new Error(insErr.message);
      onSaved();
    } catch (e) {
      if (uploaded) await supabase.storage.from(RECEIPT_BUCKET).remove([path]).catch(() => {});
      setError(`Couldn't submit the claim: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Submit an expense claim" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!valid || saving}>{saving ? "Submitting…" : "Submit claim"}</Button>
      </>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={`Amount (${currency})`} htmlFor="claim-amount">
          <input id="claim-amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Date of the expense" htmlFor="claim-date">
          <input id="claim-date" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <Field label="What was it for?" htmlFor="claim-description">
        <input id="claim-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Printing posters for the info session" style={inputStyle} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Department" htmlFor="claim-department">
          <select id="claim-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={selectStyle}>
            <option value="">No department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Category (optional)" htmlFor="claim-category">
          <select id="claim-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={selectStyle}>
            <option value="">Choose…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Receipt" htmlFor="claim-receipt" hint="Photo or PDF, up to 10 MB. Only you, the person in charge of finance and your department's VP can open it.">
        <input id="claim-receipt" type="file" accept={RECEIPT_TYPES.join(",")} capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
      </Field>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
