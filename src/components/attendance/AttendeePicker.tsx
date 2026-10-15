"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ROLE_LABELS } from "@/lib/permissions";
import type { LcMember } from "@/hooks/useLcMembers";
import type { Department, LcEvent } from "@/types";
import { Button, ErrorText, Modal, inputStyle } from "@/components/lc/ui";

/**
 * VP / president picks who attended from the LC roster: searchable multi-select
 * plus "select whole department" shortcuts. Saves only the difference.
 */
export default function AttendeePicker({ event, userId, roster, departments, current, onClose, onSaved }: {
  event: LcEvent; userId: string; roster: LcMember[]; departments: Department[];
  /** Attendees already logged (that the caller can see). */
  current: string[];
  onClose: () => void; onSaved: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(current));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "";
  const shown = useMemo(() => roster.filter((m) =>
    !query || m.name.toLowerCase().includes(query.toLowerCase()) || deptName(m.departmentId).toLowerCase().includes(query.toLowerCase()),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [roster, query, departments]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectDepartment(departmentId: string) {
    const ids = roster.filter((m) => m.departmentId === departmentId).map((m) => m.id);
    const allIn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (allIn) next.delete(id); else next.add(id); }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const before = new Set(current);
    const toAdd = [...selected].filter((id) => !before.has(id));
    const toRemove = current.filter((id) => !selected.has(id));
    try {
      if (toAdd.length) {
        const { error: insErr } = await supabase.from("event_attendance").upsert(
          toAdd.map((uid) => ({ event_id: event.id, user_id: uid, project_id: event.projectId, recorded_by: userId })),
          { onConflict: "event_id,user_id", ignoreDuplicates: true },
        );
        if (insErr) throw new Error(insErr.message);
      }
      if (toRemove.length) {
        const { error: delErr } = await supabase.from("event_attendance").delete().eq("event_id", event.id).in("user_id", toRemove);
        if (delErr) throw new Error(delErr.message);
      }
      onSaved();
    } catch (e) {
      setError(`Couldn't save attendance: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const departmentsWithMembers = departments.filter((d) => roster.some((m) => m.departmentId === d.id));

  return (
    <Modal
      title={`Who attended ${event.name}?`} onClose={onClose} width={520}
      footer={<>
        <span style={{ marginRight: "auto", fontSize: 12, color: "var(--color-secondary)", alignSelf: "center" }}>{selected.size} selected</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save attendance"}</Button>
      </>}
    >
      <div style={{ position: "relative", marginBottom: 10 }}>
        <Search size={14} color="var(--color-secondary)" aria-hidden="true" style={{ position: "absolute", left: 10, top: 12 }} />
        <input
          aria-label="Search members" placeholder="Search by name or department…" value={query}
          onChange={(e) => setQuery(e.target.value)} style={{ ...inputStyle, paddingLeft: 30 }} autoFocus
        />
      </div>
      {departmentsWithMembers.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }} aria-label="Select a whole department">
          {departmentsWithMembers.map((d) => {
            const ids = roster.filter((m) => m.departmentId === d.id).map((m) => m.id);
            const allIn = ids.every((id) => selected.has(id));
            return (
              <button
                key={d.id} type="button" onClick={() => selectDepartment(d.id)} aria-pressed={allIn}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                  border: `1px solid ${allIn ? "var(--color-navy)" : "var(--color-border)"}`,
                  backgroundColor: allIn ? "var(--color-navy-dim)" : "transparent", color: "var(--color-body)",
                }}
              >
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: d.color }} />
                {allIn ? "✓ " : "+ "}{d.name} ({ids.length})
              </button>
            );
          })}
        </div>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 320, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 8 }}>
        {shown.length === 0 && <li style={{ padding: 12, fontSize: 13, color: "var(--color-secondary)" }}>No one matches.</li>}
        {shown.map((m) => (
          <li key={m.id} style={{ borderTop: "1px solid var(--color-border)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--color-body)" }}>
              <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} style={{ accentColor: "var(--color-navy)" }} />
              <span style={{ flex: 1 }}>{m.name}</span>
              <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>{m.role === "member" ? deptName(m.departmentId) || "No department" : ROLE_LABELS[m.role]}</span>
            </label>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
