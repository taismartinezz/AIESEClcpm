"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Department } from "@/types";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";

/** VPs / president create one slot or a weekly series (create_tabling_slots does the work). */
export default function SlotModal({ projectId, departments, defaultDepartmentId, onClose, onSaved }: {
  projectId: string; departments: Department[]; defaultDepartmentId: string | null;
  onClose: () => void; onSaved: (count: number) => void;
}) {
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [date, setDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("14:00");
  const [location, setLocation] = useState("");
  const [purpose, setPurpose] = useState("");
  const [capacity, setCapacity] = useState(3);
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId ?? "");
  const [repeat, setRepeat] = useState(false);
  const [until, setUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    // Times are entered in the browser's local time zone and stored as UTC.
    const startsAt = new Date(`${date}T${start}`);
    const endsAt = new Date(`${date}T${end}`);
    if (!location.trim() || !purpose.trim()) { setError("Add a location and a purpose."); return; }
    if (!(endsAt > startsAt)) { setError("The end time must be after the start time."); return; }
    if (startsAt <= new Date()) { setError("Slots must start in the future."); return; }
    if (repeat && (!until || until < date)) { setError("Pick a repeat-until date on or after the first slot."); return; }
    setSaving(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc("create_tabling_slots", {
        p_project_id: projectId, p_starts_at: startsAt.toISOString(), p_ends_at: endsAt.toISOString(),
        p_location: location.trim(), p_purpose: purpose.trim(), p_capacity: capacity,
        p_department_id: departmentId || null, p_repeat_until: repeat ? until : null,
      });
      if (err) throw new Error(err.message);
      onSaved((data as number) ?? 1);
    } catch (e) {
      setError(`Couldn't create the slot: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="New tabling slot" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Creating…" : repeat ? "Create slots" : "Create slot"}</Button>
      </>}
    >
      <Field label="Purpose" htmlFor="slot-purpose">
        <input id="slot-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. oGV recruitment" style={inputStyle} autoFocus />
      </Field>
      <Field label="Location" htmlFor="slot-location">
        <input id="slot-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Library entrance" style={inputStyle} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 12 }}>
        <Field label="Date" htmlFor="slot-date"><input id="slot-date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></Field>
        <Field label="Starts" htmlFor="slot-start"><input id="slot-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} /></Field>
        <Field label="Ends" htmlFor="slot-end"><input id="slot-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 12 }}>
        <Field label="People needed" htmlFor="slot-capacity">
          <input id="slot-capacity" type="number" min={1} max={50} value={capacity} onChange={(e) => setCapacity(Math.max(1, Math.min(50, e.target.valueAsNumber || 1)))} style={inputStyle} />
        </Field>
        <Field label="Department (optional)" htmlFor="slot-department">
          <select id="slot-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={selectStyle}>
            <option value="">Whole LC</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-body)", marginBottom: repeat ? 8 : 0 }}>
        <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} style={{ accentColor: "var(--color-navy)" }} />
        Repeat weekly
      </label>
      {repeat && (
        <Field label="Until" htmlFor="slot-until" hint="Creates one slot per week up to and including this date (max 52).">
          <input id="slot-until" type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} style={inputStyle} />
        </Field>
      )}
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
