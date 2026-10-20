"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { useProject } from "@/context/ProjectContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { isExec, isPresident } from "@/lib/permissions";
import SimpleMarkdown from "@/components/ui/SimpleMarkdown";
import { HANDOVER_TEMPLATE, mapHandoverNote, termLabel, termOptions, type HandoverNote } from "@/lib/handover";
import { useLcMembers } from "@/hooks/useLcMembers";
import { Button, ErrorText, Panel, inputStyle, selectStyle } from "@/components/lc/ui";

interface Section { departmentId: string | null; name: string }

/**
 * Term handover: each VP leaves a note for the next VP of their department, and
 * the president leaves an LC-wide one. The exec board reads all of them; members
 * read their own department's.
 */
export default function HandoverPage() {
  const { projectId, userId, role, departments, departmentId, ledDepartmentIds, isLoading } = useProject();
  const exec = isExec(role);
  const president = isPresident(role);
  const { names } = useLcMembers(projectId);

  const [currentTerm, setCurrentTerm] = useState(() => termLabel(`${new Date().getFullYear()}-02-01`));
  const [term, setTerm] = useState<string | null>(null);
  const [notes, setNotes] = useState<HandoverNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<{ section: Section; note?: HandoverNote; body: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const enabled = Boolean(projectId) && isSupabaseConfigured;

  useEffect(() => {
    if (isLoading || !enabled || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const [t, n] = await Promise.all([
          supabase.rpc("lc_term_start", { p_project_id: projectId }),
          supabase.from("handover_notes").select("*").eq("project_id", projectId),
        ]);
        if (n.error) throw new Error(n.error.message);
        if (cancelled) return;
        if (!t.error && t.data) setCurrentTerm(termLabel(t.data as string));
        setNotes((n.data ?? []).map(mapHandoverNote));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(`Couldn't load handover notes: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, isLoading, enabled, version]);

  const selectedTerm = term ?? currentTerm;
  const terms = termOptions(currentTerm, notes.map((n) => n.termLabel));
  const canWrite = (s: Section) => president || (s.departmentId !== null && ledDepartmentIds.includes(s.departmentId));

  const sections: Section[] = [
    ...(exec ? [{ departmentId: null, name: "LC-wide (president)" }] : []),
    ...departments
      .filter((d) => exec || d.id === departmentId)
      .map((d) => ({ departmentId: d.id, name: d.name })),
  ];

  async function save() {
    if (!editing || !projectId) return;
    setSaving(true);
    setError(null);
    try {
      const { section, note, body } = editing;
      const { error: err } = note
        ? await supabase.from("handover_notes").update({ body, updated_by: userId }).eq("id", note.id)
        : await supabase.from("handover_notes").insert({
            project_id: projectId, department_id: section.departmentId, term_label: selectedTerm,
            title: `${section.name} handover ${selectedTerm}`, body, updated_by: userId,
          });
      if (err) throw new Error(err.message);
      setEditing(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(`Couldn't save the handover: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const loading = isLoading || (enabled && !loaded);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Handover"
        subtitle="What the next exec board needs to know: one note per department, per term."
        action={
          <select aria-label="Term" value={selectedTerm} onChange={(e) => { setTerm(e.target.value); setEditing(null); }} style={{ ...selectStyle, width: 130, height: 34 }}>
            {terms.map((t) => <option key={t} value={t}>{t}{t === currentTerm ? " (current)" : ""}</option>)}
          </select>
        }
      />
      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px)", maxWidth: 900, width: "100%" }}>
        <ErrorText>{error}</ErrorText>
        {loading ? (
          <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
        ) : !enabled || !projectId || !userId ? (
          <NeedsDatabase what="Handover">One note per department per term, so the next exec board doesn&apos;t start from zero.</NeedsDatabase>
        ) : sections.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>Join a department to read its handover.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sections.map((s) => {
              const note = notes.find((n) => n.departmentId === s.departmentId && n.termLabel === selectedTerm);
              const writable = canWrite(s);
              const isEditing = editing?.section.departmentId === s.departmentId;
              return (
                <Panel
                  key={s.departmentId ?? "lc"} title={s.name}
                  action={writable && !isEditing ? (
                    <Button variant="secondary" onClick={() => setEditing({ section: s, note, body: note?.body || HANDOVER_TEMPLATE })}>
                      {note ? <><Pencil size={13} aria-hidden="true" /> Edit</> : <><Plus size={13} aria-hidden="true" /> Write handover</>}
                    </Button>
                  ) : undefined}
                >
                  <div style={{ padding: 14 }}>
                    {isEditing ? (
                      <>
                        <label htmlFor={`handover-${s.departmentId ?? "lc"}`} className="sr-only">Handover for {s.name}</label>
                        <textarea
                          id={`handover-${s.departmentId ?? "lc"}`} value={editing.body} rows={18}
                          onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                          style={{ ...inputStyle, height: "auto", padding: 12, fontFamily: "inherit", lineHeight: 1.5, resize: "vertical" }}
                        />
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                        </div>
                      </>
                    ) : note ? (
                      <>
                        <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--color-body)" }}>{note.body ? <SimpleMarkdown text={note.body} /> : "—"}</div>
                        <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "12px 0 0" }}>
                          Last updated {new Date(note.updatedAt).toLocaleDateString()}{note.updatedBy && names[note.updatedBy] ? ` by ${names[note.updatedBy]}` : ""}
                        </p>
                      </>
                    ) : (
                      <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>
                        No handover for {selectedTerm} yet.{writable ? " Start from the template so nothing gets lost." : ""}
                      </p>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
