"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { MERGE_FIELDS, SAMPLE_VALUES, TEMPLATE_STATUS_LABEL, renderTemplate, unknownFields } from "@/lib/outreach";
import type { Department } from "@/types";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";

export interface OutreachTemplate {
  id: string; projectId: string; departmentId: string | null; name: string; subject: string; body: string;
  status: keyof typeof TEMPLATE_STATUS_LABEL; reviewNote: string | null; createdBy: string | null;
}

export function mapTemplate(r: Record<string, unknown>): OutreachTemplate {
  return {
    id: r.id as string, projectId: r.project_id as string, departmentId: (r.department_id as string | null) ?? null,
    name: r.name as string, subject: r.subject as string, body: r.body as string,
    status: r.status as OutreachTemplate["status"], reviewNote: (r.review_note as string | null) ?? null, createdBy: (r.created_by as string | null) ?? null,
  };
}

/** Write a template with merge fields and a live preview; approvers approve or ask for changes. */
export default function TemplateModal({ projectId, userId, departments, defaultDepartmentId, template, canApprove, onClose, onSaved }: {
  projectId: string; userId: string; departments: Department[]; defaultDepartmentId: string | null;
  template?: OutreachTemplate; canApprove: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [departmentId, setDepartmentId] = useState(template?.departmentId ?? defaultDepartmentId ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "Hi {first_name}, your {product} experience");
  const [body, setBody] = useState(template?.body ?? "Hi {first_name},\n\nI'm {sender_name} from {lc_name}. I saw you signed up for {product}; I'd love to help you find the right project.\n\nWhen would suit you for a 10-minute call this week?\n\n{sender_name}");
  const [note, setNote] = useState(template?.reviewNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typos = unknownFields(subject + " " + body);

  async function save(status: OutreachTemplate["status"]) {
    if (!name.trim() || !subject.trim() || !body.trim()) { setError("Give it a name, a subject and a message."); return; }
    if (typos.length) { setError(`Unknown merge field${typos.length > 1 ? "s" : ""}: ${typos.map((t) => `{${t}}`).join(", ")}`); return; }
    setBusy(true);
    setError(null);
    try {
      const fields = { name: name.trim(), department_id: departmentId || null, subject: subject.trim(), body: body.trim(), status, review_note: status === "rejected" ? note.trim() || null : null };
      const { error: err } = template
        ? await supabase.from("outreach_templates").update(fields).eq("id", template.id)
        : await supabase.from("outreach_templates").insert({ ...fields, project_id: projectId, created_by: userId });
      if (err) throw new Error(err.message);
      onSaved();
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const insert = (key: string) => setBody((b) => `${b}{${key}}`);

  return (
    <Modal title={template ? `Template: ${template.name}` : "New template"} onClose={onClose} width={720} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      {canApprove && template?.status === "pending" && <Button variant="secondary" disabled={busy || !note.trim()} onClick={() => save("rejected")}>Ask for changes</Button>}
      <Button variant="secondary" disabled={busy} onClick={() => save("draft")}>Save draft</Button>
      {canApprove
        ? <Button disabled={busy} onClick={() => save("approved")}>{template?.status === "approved" ? "Save (stays approved)" : "Approve"}</Button>
        : <Button disabled={busy} onClick={() => save("pending")}>Submit for approval</Button>}
    </>}>
      {template?.status === "rejected" && template.reviewNote && (
        <p role="status" style={{ fontSize: 13, padding: "8px 12px", borderRadius: 8, backgroundColor: "var(--color-warning-bg)", margin: "0 0 12px" }}>
          <strong>Changes requested:</strong> {template.reviewNote}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Template name" htmlFor="tpl-name"><input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="oGV sign-up: day 0" style={inputStyle} /></Field>
            <Field label="Department" htmlFor="tpl-dept">
              <select id="tpl-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={selectStyle}>
                <option value="">Whole LC</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Subject" htmlFor="tpl-subject"><input id="tpl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} style={inputStyle} /></Field>
          <Field label="Message" htmlFor="tpl-body">
            <textarea id="tpl-body" value={body} onChange={(e) => setBody(e.target.value)} rows={11} maxLength={5000} style={{ ...inputStyle, height: "auto", padding: 10, fontFamily: "inherit", lineHeight: 1.5, resize: "vertical" }} />
          </Field>
          <div role="group" aria-label="Insert a merge field" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {MERGE_FIELDS.map((f) => (
              <button key={f.key} type="button" onClick={() => insert(f.key)} title={f.label}
                style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, border: "1px solid var(--color-border)", background: "transparent", cursor: "pointer", color: "var(--color-navy)", fontFamily: "monospace" }}>
                {`{${f.key}}`}
              </button>
            ))}
          </div>
          {canApprove && template?.status === "pending" && (
            <Field label="Note for the author (when asking for changes)" htmlFor="tpl-note">
              <input id="tpl-note" value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
            </Field>
          )}
        </div>
        <section aria-label="Preview" style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 14, backgroundColor: "var(--color-canvas)" }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: "0 0 8px" }}>Preview with sample data</p>
          <p style={{ fontSize: 14, fontWeight: 700, color: "var(--color-body)", margin: "0 0 10px" }}>{renderTemplate(subject, SAMPLE_VALUES)}</p>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--color-body)", whiteSpace: "pre-wrap" }}>{renderTemplate(body, SAMPLE_VALUES)}</div>
          <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "12px 0 0" }}>An unsubscribe line is added at the bottom of every email. Replies go to the sender&apos;s own inbox.</p>
          {typos.length > 0 && <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: "8px 0 0" }}>Unknown: {typos.map((t) => `{${t}}`).join(", ")}</p>}
        </section>
      </div>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
