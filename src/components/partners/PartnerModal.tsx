"use client";

import { useEffect, useState } from "react";
import { Mail, Phone, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PARTNER_STAGES, mapActivity, mapContact } from "@/lib/partners";
import type { LcMember } from "@/hooks/useLcMembers";
import type { Department, Partner, PartnerActivity, PartnerContact, PartnerStage } from "@/types";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";

/** Add a partner, or edit one with its contacts and activity log. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function PartnerModal({ projectId, userId, departments, allowedDepartmentIds, allowNoDepartment = false, roster, partner, onClose, onSaved }: {
  projectId: string; userId: string; departments: Department[];
  /** Departments this person may file a new partner under. */
  allowedDepartmentIds: string[];
  /** The exec board may leave the department empty (e.g. before departments exist). */
  allowNoDepartment?: boolean;
  roster: LcMember[]; partner?: Partner; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(partner?.name ?? "");
  const [industry, setIndustry] = useState(partner?.industry ?? "");
  const [website, setWebsite] = useState(partner?.website ?? "");
  const [stage, setStage] = useState<PartnerStage>(partner?.stage ?? "lead");
  const [departmentId, setDepartmentId] = useState(partner?.departmentId ?? allowedDepartmentIds[0] ?? "");
  const [ownerId, setOwnerId] = useState(partner?.ownerId ?? userId);
  const [nextFollowUp, setNextFollowUp] = useState(partner?.nextFollowUp ?? "");
  const [notes, setNotes] = useState(partner?.notes ?? "");
  const [contacts, setContacts] = useState<PartnerContact[]>([]);
  const [activities, setActivities] = useState<PartnerActivity[]>([]);
  const [newContact, setNewContact] = useState({ name: "", roleTitle: "", email: "", phone: "" });
  // The person at the organisation you're talking to, captured when adding the partner.
  const [firstContact, setFirstContact] = useState({ name: "", roleTitle: "", email: "", phone: "" });
  const [newActivity, setNewActivity] = useState<{ kind: PartnerActivity["kind"]; body: string }>({ kind: "call", body: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const names = Object.fromEntries(roster.map((m) => [m.id, m.name]));

  useEffect(() => {
    if (!partner) return;
    let cancelled = false;
    (async () => {
      const [c, a] = await Promise.all([
        supabase.from("partner_contacts").select("*").eq("partner_id", partner.id).order("created_at"),
        supabase.from("partner_activities").select("*").eq("partner_id", partner.id).order("happened_on", { ascending: false }),
      ]);
      if (cancelled) return;
      if (c.error || a.error) { setError(`Couldn't load details: ${(c.error ?? a.error)!.message}`); return; }
      setContacts((c.data ?? []).map(mapContact));
      setActivities((a.data ?? []).map(mapActivity));
    })();
    return () => { cancelled = true; };
  }, [partner, version]);

  async function run(key: string, action: () => PromiseLike<{ error: { message: string } | null }>, after?: () => void) {
    setBusy(key);
    setError(null);
    try {
      const { error: err } = await action();
      if (err) throw new Error(err.message);
      after?.();
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  function save() {
    if (!name.trim()) { setError("Add the organisation's name."); return; }
    if (website && !/^https?:\/\//i.test(website.trim())) { setError("The website must start with http:// or https://"); return; }
    if (!partner && firstContact.email.trim() && !EMAIL.test(firstContact.email.trim())) { setError("The contact's email doesn't look right."); return; }
    if (!partner && (firstContact.email.trim() || firstContact.phone.trim()) && !firstContact.name.trim()) { setError("Add the contact's name."); return; }
    const fields = {
      name: name.trim(), industry: industry.trim() || null, website: website.trim() || null, stage,
      department_id: departmentId || null, owner_id: ownerId || null, next_follow_up: nextFollowUp || null, notes: notes.trim() || null,
    };
    void run("save", async () => {
      if (partner) return supabase.from("partners").update(fields).eq("id", partner.id);
      const { data, error: err } = await supabase.from("partners").insert({ ...fields, project_id: projectId, created_by: userId }).select("id").single();
      if (err || !data) return { error: err ?? { message: "no partner returned" } };
      if (firstContact.name.trim()) {
        const { error: cErr } = await supabase.from("partner_contacts").insert({
          partner_id: data.id, name: firstContact.name.trim(), role_title: firstContact.roleTitle.trim() || null,
          email: firstContact.email.trim() || null, phone: firstContact.phone.trim() || null,
        });
        if (cErr) return { error: { message: `the partner was added, but not the contact: ${cErr.message}` } };
      }
      return { error: null };
    }, onSaved);
  }

  function remove() {
    if (!partner || !window.confirm(`Delete ${partner.name} and its contacts and history?`)) return;
    void run("delete", async () => {
      const { data, error: err } = await supabase.from("partners").delete().eq("id", partner.id).select("id");
      if (!err && !data?.length) return { error: { message: "only the LCP, the department's VP or whoever added it can delete a partner" } };
      return { error: err };
    }, onSaved);
  }

  return (
    <Modal
      title={partner ? partner.name : "Add a partner"} onClose={onClose} width={620}
      footer={<>
        {partner && <Button variant="danger" onClick={remove} disabled={busy === "delete"} style={{ marginRight: "auto" }}>Delete</Button>}
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button onClick={save} disabled={busy === "save" || !name.trim()}>{busy === "save" ? "Saving…" : "Save"}</Button>
      </>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <Field label="Organisation" htmlFor="p-name"><input id="p-name" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus={!partner} /></Field>
        <Field label="Stage" htmlFor="p-stage">
          <select id="p-stage" value={stage} onChange={(e) => setStage(e.target.value as PartnerStage)} style={selectStyle}>
            {PARTNER_STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Industry" htmlFor="p-industry"><input id="p-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} style={inputStyle} /></Field>
        <Field label="Website" htmlFor="p-web"><input id="p-web" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" style={inputStyle} /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label="Department" htmlFor="p-dept">
          <select id="p-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={selectStyle} disabled={!!partner && !!departmentId && !allowedDepartmentIds.includes(departmentId)}>
            {(allowNoDepartment || !departmentId) && <option value="">No department</option>}
            {departments.filter((d) => allowedDepartmentIds.includes(d.id) || d.id === departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Owner" htmlFor="p-owner">
          <select id="p-owner" value={ownerId ?? ""} onChange={(e) => setOwnerId(e.target.value)} style={selectStyle}>
            <option value="">Nobody</option>
            {roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Next follow-up" htmlFor="p-follow"><input id="p-follow" type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} style={inputStyle} /></Field>
      </div>
      <Field label="Notes" htmlFor="p-notes"><textarea id="p-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, height: "auto", padding: 10 }} /></Field>

      {!partner && (
        <fieldset style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 12px 2px", margin: "0 0 12px" }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--color-body)", padding: "0 4px" }}>Contact person (optional)</legend>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Name" htmlFor="p-c-name"><input id="p-c-name" value={firstContact.name} onChange={(e) => setFirstContact({ ...firstContact, name: e.target.value })} placeholder="Rita Silva" style={inputStyle} /></Field>
            <Field label="Role" htmlFor="p-c-role"><input id="p-c-role" value={firstContact.roleTitle} onChange={(e) => setFirstContact({ ...firstContact, roleTitle: e.target.value })} placeholder="Head of HR" style={inputStyle} /></Field>
            <Field label="Email" htmlFor="p-c-email"><input id="p-c-email" type="email" value={firstContact.email} onChange={(e) => setFirstContact({ ...firstContact, email: e.target.value })} placeholder="rita@company.com" style={inputStyle} /></Field>
            <Field label="Phone" htmlFor="p-c-phone"><input id="p-c-phone" type="tel" value={firstContact.phone} onChange={(e) => setFirstContact({ ...firstContact, phone: e.target.value })} style={inputStyle} /></Field>
          </div>
        </fieldset>
      )}

      {partner && (
        <>
          <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: "8px 0" }}>Contacts</h3>
          <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0 }}>
            {contacts.map((c) => (
              <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--color-border)", fontSize: 13 }}>
                <span style={{ flex: 1 }}><strong>{c.name}</strong>{c.roleTitle && <span style={{ color: "var(--color-secondary)" }}> · {c.roleTitle}</span>}</span>
                {c.email && <a href={`mailto:${c.email}`} aria-label={`Email ${c.name}`} style={{ color: "var(--color-navy)", display: "flex" }}><Mail size={14} /></a>}
                {c.phone && <a href={`tel:${c.phone}`} aria-label={`Call ${c.name}`} style={{ color: "var(--color-navy)", display: "flex" }}><Phone size={14} /></a>}
                <button type="button" aria-label={`Remove ${c.name}`} disabled={busy === c.id}
                  onClick={() => run(c.id, () => supabase.from("partner_contacts").delete().eq("id", c.id), () => setVersion((v) => v + 1))}
                  style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><Trash2 size={13} color="var(--color-secondary)" /></button>
              </li>
            ))}
          </ul>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.3fr 1fr auto", gap: 6, marginBottom: 14 }}>
            <input aria-label="Contact name" placeholder="Name" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} style={{ ...inputStyle, height: 32 }} />
            <input aria-label="Contact role" placeholder="Role" value={newContact.roleTitle} onChange={(e) => setNewContact({ ...newContact, roleTitle: e.target.value })} style={{ ...inputStyle, height: 32 }} />
            <input aria-label="Contact email" placeholder="Email" type="email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} style={{ ...inputStyle, height: 32 }} />
            <input aria-label="Contact phone" placeholder="Phone" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} style={{ ...inputStyle, height: 32 }} />
            <Button disabled={!newContact.name.trim() || busy === "contact"} style={{ height: 32 }} aria-label="Add contact"
              onClick={() => newContact.email.trim() && !EMAIL.test(newContact.email.trim()) ? setError("The contact's email doesn't look right.") : run("contact", () => supabase.from("partner_contacts").insert({
                partner_id: partner.id, name: newContact.name.trim(), role_title: newContact.roleTitle.trim() || null,
                email: newContact.email.trim() || null, phone: newContact.phone.trim() || null,
              }), () => { setNewContact({ name: "", roleTitle: "", email: "", phone: "" }); setVersion((v) => v + 1); })}>
              <Plus size={13} aria-hidden="true" />
            </Button>
          </div>

          <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: "8px 0" }}>History</h3>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <select aria-label="Activity type" value={newActivity.kind} onChange={(e) => setNewActivity({ ...newActivity, kind: e.target.value as PartnerActivity["kind"] })} style={{ ...selectStyle, width: 110, height: 32 }}>
              <option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="note">Note</option>
            </select>
            <input aria-label="What happened" placeholder="What happened? e.g. Sent the sponsorship deck" value={newActivity.body} onChange={(e) => setNewActivity({ ...newActivity, body: e.target.value })} style={{ ...inputStyle, height: 32 }} />
            <Button disabled={!newActivity.body.trim() || busy === "activity"} style={{ height: 32 }}
              onClick={() => run("activity", () => supabase.from("partner_activities").insert({
                partner_id: partner.id, kind: newActivity.kind, body: newActivity.body.trim(), author_id: userId,
              }), () => { setNewActivity({ kind: newActivity.kind, body: "" }); setVersion((v) => v + 1); })}>
              Log
            </Button>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {activities.length === 0 && <li style={{ fontSize: 12, color: "var(--color-secondary)" }}>Nothing logged yet.</li>}
            {activities.map((a) => (
              <li key={a.id} style={{ fontSize: 13, padding: "5px 0", borderTop: "1px solid var(--color-border)" }}>
                <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{a.happenedOn} · {a.kind}{a.authorId && names[a.authorId] ? ` · ${names[a.authorId]}` : ""}</span>
                <div style={{ color: "var(--color-body)" }}>{a.body}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
