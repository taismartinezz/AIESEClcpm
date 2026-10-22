"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AUDIENCE_ROLE_LABELS } from "@/lib/attendance";
import { authedPost, describeSend, type SendResult } from "@/lib/api-client";
import type { Department } from "@/types";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";
import { formatDay } from "@/lib/dates";

interface Past { id: string; subject: string; sent_at: string | null; sent_count: number | null; created_at: string }

/** President / VPs: a one-off email to the LC, a department or a role. Replies go to the author. */
export default function AnnouncementModal({ projectId, userId, departments, ledDepartmentIds, isPresident, onClose }: {
  projectId: string; userId: string; departments: Department[]; ledDepartmentIds: string[]; isPresident: boolean; onClose: () => void;
}) {
  const [audience, setAudience] = useState<"lc" | "department" | "role">(isPresident ? "lc" : "department");
  const allowedDepartments = isPresident ? departments : departments.filter((d) => ledDepartmentIds.includes(d.id));
  const [departmentId, setDepartmentId] = useState(allowedDepartments[0]?.id ?? "");
  const [role, setRole] = useState<keyof typeof AUDIENCE_ROLE_LABELS>("member");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [past, setPast] = useState<Past[]>([]);

  useEffect(() => {
    let cancelled = false;
    supabase.from("announcements").select("id, subject, sent_at, sent_count, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(5)
      .then(({ data }) => { if (!cancelled) setPast((data ?? []) as Past[]); });
    return () => { cancelled = true; };
  }, [projectId, result]);

  async function send() {
    if (!subject.trim() || !body.trim()) { setError("Add a subject and a message."); return; }
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.from("announcements").insert({
        project_id: projectId, author_id: userId, audience, subject: subject.trim(), body: body.trim(),
        department_id: audience === "department" ? departmentId : null, audience_role: audience === "role" ? role : null,
      }).select("id").single();
      if (err) throw new Error(err.message);
      const r = await authedPost<SendResult>("/api/announcements/send", { announcementId: data.id });
      setResult(describeSend(r));
      setSubject("");
      setBody("");
    } catch (e) {
      setError(`Couldn't send: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Send an announcement" onClose={onClose} width={540} footer={<>
      <Button variant="ghost" onClick={onClose}>Done</Button>
      <Button onClick={send} disabled={busy || !subject.trim() || !body.trim()}>{busy ? "Sending…" : "Send email"}</Button>
    </>}>
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 12px" }}>
        Sent by email from your LC&apos;s name; replies come to you. Everyone gets announcements, whatever their email preferences.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="To" htmlFor="ann-audience">
          <select id="ann-audience" value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} style={selectStyle}>
            {isPresident && <option value="lc">The whole LC</option>}
            <option value="department">A department</option>
            {isPresident && <option value="role">A role</option>}
          </select>
        </Field>
        {audience === "department" && (
          <Field label="Department" htmlFor="ann-dept">
            <select id="ann-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={selectStyle}>
              {allowedDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        )}
        {audience === "role" && (
          <Field label="Role" htmlFor="ann-role">
            <select id="ann-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} style={selectStyle}>
              {Object.entries(AUDIENCE_ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Field label="Subject" htmlFor="ann-subject"><input id="ann-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} placeholder="GA moves to Thursday" style={inputStyle} /></Field>
      <Field label="Message" htmlFor="ann-body">
        <textarea id="ann-body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={5000} style={{ ...inputStyle, height: "auto", padding: 10, fontFamily: "inherit", resize: "vertical" }} />
      </Field>
      {result && <p role="status" style={{ fontSize: 13, color: "var(--color-body)", margin: "0 0 8px" }}>{result}</p>}
      <ErrorText>{error}</ErrorText>
      {past.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: "0 0 4px" }}>Recent</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12, color: "var(--color-body)" }}>
            {past.map((a) => <li key={a.id}>{a.subject} <span style={{ color: "var(--color-secondary)" }}>· {a.sent_at ? `${a.sent_count ?? 0} sent ${formatDay(a.sent_at)}` : "not sent"}</span></li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}
