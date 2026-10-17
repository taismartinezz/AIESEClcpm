"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PRODUCTS, STAGE_LABEL, type ProductCode } from "@/lib/products";
import type { OutreachTemplate } from "@/components/outreach/TemplateModal";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";

export interface Sequence {
  id: string; name: string; product: ProductCode; triggerStage: "signed_up" | "applied" | "accepted"; active: boolean; departmentId: string | null;
  steps: { stepNo: number; delayDays: number; templateId: string }[];
}

export function mapSequence(r: Record<string, unknown>): Sequence {
  const steps = ((r.outreach_steps as Record<string, unknown>[] | null) ?? [])
    .map((s) => ({ stepNo: s.step_no as number, delayDays: s.delay_days as number, templateId: s.template_id as string }))
    .sort((a, b) => a.stepNo - b.stepNo);
  return { id: r.id as string, name: r.name as string, product: r.product as ProductCode, triggerStage: r.trigger_stage as Sequence["triggerStage"], active: Boolean(r.active), departmentId: (r.department_id as string | null) ?? null, steps };
}

/** Build a sequence: which product and stage it's for, and which approved template goes out on which day. */
export function SequenceModal({ projectId, userId, products, templates, sequence, onClose, onSaved }: {
  projectId: string; userId: string; products: ProductCode[]; templates: OutreachTemplate[]; sequence?: Sequence;
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(sequence?.name ?? "");
  const [product, setProduct] = useState<ProductCode>(sequence?.product ?? products[0] ?? "ogv");
  const [stage, setStage] = useState<Sequence["triggerStage"]>(sequence?.triggerStage ?? "signed_up");
  const [steps, setSteps] = useState(sequence?.steps.length ? sequence.steps : [
    { stepNo: 1, delayDays: 0, templateId: "" }, { stepNo: 2, delayDays: 3, templateId: "" }, { stepNo: 3, delayDays: 7, templateId: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError("Name the sequence."); return; }
    if (steps.some((s) => !s.templateId)) { setError("Choose a template for every step."); return; }
    setBusy(true);
    setError(null);
    try {
      let id = sequence?.id;
      if (id) {
        const { error: err } = await supabase.from("outreach_sequences").update({ name: name.trim(), product, trigger_stage: stage, active: false }).eq("id", id);
        if (err) throw new Error(err.message);
        const { error: delErr } = await supabase.from("outreach_steps").delete().eq("sequence_id", id);
        if (delErr) throw new Error(delErr.message);
      } else {
        const { data, error: err } = await supabase.from("outreach_sequences").insert({ project_id: projectId, name: name.trim(), product, trigger_stage: stage, created_by: userId }).select("id").single();
        if (err) throw new Error(err.message);
        id = data.id as string;
      }
      const { error: stepErr } = await supabase.from("outreach_steps").insert(steps.map((s, i) => ({ sequence_id: id, step_no: i + 1, delay_days: s.delayDays, template_id: s.templateId })));
      if (stepErr) throw new Error(stepErr.message);
      onSaved();
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const usable = templates.filter((t) => t.status !== "rejected");
  return (
    <Modal title={sequence ? `Edit ${sequence.name}` : "New sequence"} onClose={onClose} width={560} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save (paused)"}</Button>
    </>}>
      <Field label="Name" htmlFor="seq-name"><input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="oGV new sign-ups" style={inputStyle} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Product" htmlFor="seq-product">
          <select id="seq-product" value={product} onChange={(e) => setProduct(e.target.value as ProductCode)} style={selectStyle}>
            {PRODUCTS.filter((p) => products.includes(p.code)).map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="For people at" htmlFor="seq-stage" hint="Moving them to another stage stops the emails.">
          <select id="seq-stage" value={stage} onChange={(e) => setStage(e.target.value as Sequence["triggerStage"])} style={selectStyle}>
            {(["signed_up", "applied", "accepted"] as const).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </Field>
      </div>
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-body)", margin: "4px 0 6px" }}>Steps</p>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, width: 34, color: "var(--color-secondary)" }}>Day</span>
          <input aria-label={`Day for step ${i + 1}`} type="number" min={0} max={60} value={s.delayDays}
            onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, delayDays: Math.max(0, Math.min(60, Number(e.target.value) || 0)) } : x)))}
            style={{ ...inputStyle, width: 64, height: 32 }} />
          <select aria-label={`Template for step ${i + 1}`} value={s.templateId} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, templateId: e.target.value } : x)))}
            style={{ ...selectStyle, flex: 1, height: 32 }}>
            <option value="">Choose a template…</option>
            {usable.map((t) => <option key={t.id} value={t.id}>{t.name}{t.status !== "approved" ? " (not approved yet)" : ""}</option>)}
          </select>
          <button type="button" aria-label={`Remove step ${i + 1}`} disabled={steps.length === 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <Trash2 size={13} color="var(--color-secondary)" />
          </button>
        </div>
      ))}
      {steps.length < 10 && <Button variant="ghost" onClick={() => setSteps([...steps, { stepNo: steps.length + 1, delayDays: (steps.at(-1)?.delayDays ?? 0) + 3, templateId: "" }])}><Plus size={13} aria-hidden="true" /> Add step</Button>}
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "8px 0 0" }}>
        A sequence can be started once every template is approved. It stops for someone as soon as they move stage, reply (mark it on their card) or unsubscribe.
      </p>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}

interface Candidate { id: string; person_name: string; email: string | null; email_consent: boolean; unsubscribed_at: string | null }

/** Pick sign-ups to enroll. Only people with an email who agreed to be contacted can be chosen. */
export function EnrollModal({ projectId, sequence, onClose, onDone }: { projectId: string; sequence: Sequence; onClose: () => void; onDone: () => void }) {
  const [people, setPeople] = useState<Candidate[]>([]);
  const [enrolled, setEnrolled] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ex, en] = await Promise.all([
        supabase.from("exchanges").select("id, person_name, email, email_consent, unsubscribed_at").eq("project_id", projectId).eq("product", sequence.product).eq("stage", sequence.triggerStage).order("signed_up_at", { ascending: false }),
        supabase.from("outreach_enrollments").select("exchange_id").eq("sequence_id", sequence.id),
      ]);
      if (cancelled) return;
      if (ex.error) { setError(ex.error.message); return; }
      setPeople((ex.data ?? []) as Candidate[]);
      setEnrolled(new Set((en.data ?? []).map((r) => r.exchange_id as string)));
    })();
    return () => { cancelled = true; };
  }, [projectId, sequence]);

  const eligible = (p: Candidate) => Boolean(p.email && p.email_consent && !p.unsubscribed_at && !enrolled.has(p.id));
  const why = (p: Candidate) => enrolled.has(p.id) ? "already in this sequence" : !p.email ? "no email" : !p.email_consent ? "no consent to be contacted" : p.unsubscribed_at ? "unsubscribed" : "";

  async function enroll() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc("enroll_in_sequence", { p_sequence_id: sequence.id, p_exchange_ids: [...chosen] });
      if (err) throw new Error(err.message);
      const r = (Array.isArray(data) ? data[0] : data) as { enrolled: number; skipped: number };
      setResult(`${r.enrolled} enrolled${r.skipped ? `, ${r.skipped} skipped` : ""}. The first emails go out with the next reminder run, from your name.`);
      onDone();
    } catch (e) {
      setError(`Couldn't enroll: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Enroll in ${sequence.name}`} onClose={onClose} width={520} footer={result ? <Button onClick={onClose}>Done</Button> : <>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button onClick={enroll} disabled={busy || chosen.size === 0}>Enroll {chosen.size || ""}</Button>
    </>}>
      {result ? <p role="status" style={{ fontSize: 14, margin: 0 }}>{result}</p> : (
        <>
          <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 10px" }}>
            {STAGE_LABEL[sequence.triggerStage]} in {PRODUCTS.find((p) => p.code === sequence.product)?.label}. Emails go out from your name and replies come to you.
            Only people who signed up with AIESEC and agreed to be contacted can be enrolled.
          </p>
          {people.length === 0 ? <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>Nobody at this stage.</p> : (
            <>
              <label style={{ display: "flex", gap: 8, fontSize: 12, marginBottom: 6 }}>
                <input type="checkbox" checked={people.filter(eligible).length > 0 && people.filter(eligible).every((p) => chosen.has(p.id))}
                  onChange={(e) => setChosen(e.target.checked ? new Set(people.filter(eligible).map((p) => p.id)) : new Set())} style={{ accentColor: "var(--color-navy)" }} />
                Select everyone who can be emailed
              </label>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 300, overflowY: "auto" }}>
                {people.map((p) => (
                  <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: "1px solid var(--color-border)", fontSize: 13 }}>
                    <input type="checkbox" aria-label={p.person_name} disabled={!eligible(p)} checked={chosen.has(p.id)}
                      onChange={() => setChosen((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} style={{ accentColor: "var(--color-navy)" }} />
                    <span style={{ flex: 1 }}>{p.person_name} <span style={{ color: "var(--color-secondary)", fontSize: 11 }}>{p.email ?? ""}</span></span>
                    {!eligible(p) && <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{why(p)}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
