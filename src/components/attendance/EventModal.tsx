"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/attendance";
import type { Department, LcEvent, LcEventType } from "@/types";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";

export default function EventModal({ projectId, userId, departments, event, onClose, onSaved }: {
  projectId: string; userId: string; departments: Department[]; event?: LcEvent;
  onClose: () => void; onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState(event?.name ?? "");
  const [type, setType] = useState<LcEventType>(event?.type ?? "local_event");
  const [startsOn, setStartsOn] = useState(event?.startsOn ?? today);
  const [endsOn, setEndsOn] = useState(event?.endsOn ?? today);
  const [location, setLocation] = useState(event?.location ?? "");
  const [departmentId, setDepartmentId] = useState(event?.departmentId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError("Give the event a name."); return; }
    if (endsOn < startsOn) { setError("The end date can't be before the start date."); return; }
    setSaving(true);
    setError(null);
    try {
      const fields = {
        name: name.trim(), type, starts_on: startsOn, ends_on: endsOn,
        location: location.trim() || null, department_id: departmentId || null,
      };
      const { error: err } = event
        ? await supabase.from("lc_events").update(fields).eq("id", event.id)
        : await supabase.from("lc_events").insert({ ...fields, project_id: projectId, created_by: userId });
      if (err) throw new Error(err.message);
      onSaved();
    } catch (e) {
      setError(`Couldn't save the event: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={event ? "Edit event" : "New event"} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save event"}</Button>
      </>}
    >
      <Field label="Name" htmlFor="event-name">
        <input id="event-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring national conference" style={inputStyle} autoFocus />
      </Field>
      <Field label="Type" htmlFor="event-type">
        <select id="event-type" value={type} onChange={(e) => setType(e.target.value as LcEventType)} style={selectStyle}>
          {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
        </select>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Starts" htmlFor="event-start">
          <input id="event-start" type="date" value={startsOn} onChange={(e) => { setStartsOn(e.target.value); if (endsOn < e.target.value) setEndsOn(e.target.value); }} style={inputStyle} />
        </Field>
        <Field label="Ends" htmlFor="event-end">
          <input id="event-end" type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <Field label="Location" htmlFor="event-location">
        <input id="event-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Faculty of Economics, room 2.1" style={inputStyle} />
      </Field>
      <Field label="Department (optional)" htmlFor="event-department">
        <select id="event-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={selectStyle}>
          <option value="">Whole LC</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
