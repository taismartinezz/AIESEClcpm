"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { PRODUCTS, STAGES, type ExchangeStage, type ProductCode } from "@/lib/products";
import type { LcMember } from "@/hooks/useLcMembers";
import type { Exchange } from "@/types";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";
import OutreachPanel from "@/components/pipeline/OutreachPanel";
import { askConfirm } from "@/components/ui/confirm";

/** Add or edit one exchange participant. */
export default function ExchangeModal({ projectId, userId, products, roster, exchange, defaultProduct, onClose, onSaved }: {
  projectId: string; userId: string; products: ProductCode[]; roster: LcMember[];
  exchange?: Exchange; defaultProduct: ProductCode;
  onClose: () => void; onSaved: () => void;
}) {
  const [product, setProduct] = useState<ProductCode>(exchange?.product ?? defaultProduct);
  const [stage, setStage] = useState<ExchangeStage>(exchange?.stage ?? "signed_up");
  const [personName, setPersonName] = useState(exchange?.personName ?? "");
  const [email, setEmail] = useState(exchange?.email ?? "");
  const [phone, setPhone] = useState(exchange?.phone ?? "");
  const [opportunity, setOpportunity] = useState(exchange?.opportunity ?? "");
  const [hostEntity, setHostEntity] = useState(exchange?.hostEntity ?? "");
  const [expaId, setExpaId] = useState(exchange?.expaId ?? "");
  const [expaUrl, setExpaUrl] = useState(exchange?.expaUrl ?? "");
  // New exchanges start with you as owner; an existing unassigned one stays unassigned.
  const [ownerId, setOwnerId] = useState(exchange ? (exchange.ownerId ?? "") : userId);
  const [notes, setNotes] = useState(exchange?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const incoming = product.startsWith("i");

  async function save() {
    if (!personName.trim()) { setError("Add the person's name."); return; }
    if (expaUrl && !/^https:\/\//i.test(expaUrl.trim())) { setError("The EXPA link must start with https://"); return; }
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError("That email doesn't look right (e.g. name@example.com)."); return; }
    if (expaId.trim() && !/^\d+$/.test(expaId.trim())) { setError("The EXPA ID is a number (the digits in the application's EXPA link)."); return; }
    setSaving(true);
    setError(null);
    try {
      const fields = {
        product, stage, person_name: personName.trim(),
        email: email.trim() || null, phone: phone.trim() || null,
        opportunity: opportunity.trim() || null, host_entity: hostEntity.trim() || null,
        expa_id: expaId.trim() || null, expa_url: expaUrl.trim() || null,
        owner_id: ownerId || null, notes: notes.trim() || null,
      };
      const { error: err } = exchange
        ? await supabase.from("exchanges").update(fields).eq("id", exchange.id)
        : await supabase.from("exchanges").insert({ ...fields, project_id: projectId, created_by: userId });
      if (err) throw new Error(err.message);
      onSaved();
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!exchange || !(await askConfirm(`Remove ${exchange.personName} from the pipeline?`, { confirmLabel: "Remove" }))) return;
    setDeleting(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.from("exchanges").delete().eq("id", exchange.id).select("id");
      if (err) throw new Error(err.message);
      if (!data?.length) throw new Error("only the department's VP or the LCP can remove exchanges");
      onSaved();
    } catch (e) {
      setError(`Couldn't remove: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal
      title={exchange ? exchange.personName : "Add an exchange"} onClose={onClose} width={560}
      footer={<>
        {exchange && <Button variant="danger" onClick={remove} disabled={deleting} style={{ marginRight: "auto" }}>{deleting ? "Removing…" : "Remove"}</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !personName.trim()}>{saving ? "Saving…" : "Save"}</Button>
      </>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Product" htmlFor="ex-product">
          <select id="ex-product" value={product} onChange={(e) => setProduct(e.target.value as ProductCode)} style={selectStyle}>
            {PRODUCTS.filter((p) => products.includes(p.code) || p.code === product).map((p) => <option key={p.code} value={p.code}>{p.label} · {p.name}</option>)}
          </select>
        </Field>
        <Field label="Stage" htmlFor="ex-stage">
          <select id="ex-stage" value={stage} onChange={(e) => setStage(e.target.value as ExchangeStage)} style={selectStyle}>
            {STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label={incoming ? "Exchange participant (coming to your LC)" : "Exchange participant (from your LC)"} htmlFor="ex-name">
        <input id="ex-name" value={personName} onChange={(e) => setPersonName(e.target.value)} style={inputStyle} autoFocus={!exchange} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Email" htmlFor="ex-email"><input id="ex-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} /></Field>
        <Field label="Phone" htmlFor="ex-phone"><input id="ex-phone" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Project / position" htmlFor="ex-opp"><input id="ex-opp" value={opportunity} onChange={(e) => setOpportunity(e.target.value)} style={inputStyle} /></Field>
        <Field label={incoming ? "Home LC / country" : "Host LC / country"} htmlFor="ex-host"><input id="ex-host" value={hostEntity} onChange={(e) => setHostEntity(e.target.value)} style={inputStyle} /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
        <Field label="EXPA ID" htmlFor="ex-expa-id"><input id="ex-expa-id" inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 1234567" value={expaId} onChange={(e) => setExpaId(e.target.value)} style={inputStyle} /></Field>
        <Field label="EXPA link" htmlFor="ex-expa-url"><input id="ex-expa-url" type="url" placeholder="https://expa.aiesec.org/…" value={expaUrl} onChange={(e) => setExpaUrl(e.target.value)} style={inputStyle} /></Field>
      </div>
      <Field label="Responsible member" htmlFor="ex-owner">
        <select id="ex-owner" value={ownerId ?? ""} onChange={(e) => setOwnerId(e.target.value)} style={selectStyle}>
          <option value="">Unassigned</option>
          {roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      <Field label="Notes" htmlFor="ex-notes">
        <textarea id="ex-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, height: "auto", padding: 10 }} />
      </Field>
      <ErrorText>{error}</ErrorText>
      {exchange && <OutreachPanel exchangeId={exchange.id} />}
    </Modal>
  );
}
