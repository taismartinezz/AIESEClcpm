"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AUDIENCE_ROLE_LABELS, EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/attendance";
import { authedPost, describeSend, type SendResult } from "@/lib/api-client";
import type { Department, LcEvent, LcEventType } from "@/types";
import type { LcMember } from "@/hooks/useLcMembers";
import { Button, ErrorText, Field, Modal, inputStyle, selectStyle } from "@/components/lc/ui";

const localTime = (iso: string | null) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "");
/** Date + "HH:MM" in the organiser's time zone → ISO instant. */
const toInstant = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();

export default function EventModal({ projectId, userId, departments, roster, event, onClose, onSaved }: {
  projectId: string; userId: string; departments: Department[]; roster: LcMember[]; event?: LcEvent;
  onClose: () => void; onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState(event?.name ?? "");
  const [type, setType] = useState<LcEventType>(event?.type ?? "local_event");
  const [startsOn, setStartsOn] = useState(event?.startsOn ?? today);
  const [endsOn, setEndsOn] = useState(event?.endsOn ?? today);
  const [startTime, setStartTime] = useState(localTime(event?.startsAt ?? null));
  const [endTime, setEndTime] = useState(localTime(event?.endsAt ?? null));
  const [location, setLocation] = useState(event?.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState(event?.meetingUrl ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [audience, setAudience] = useState<LcEvent["audience"]>(event?.audience ?? "lc");
  const [departmentId, setDepartmentId] = useState(event?.departmentId ?? departments[0]?.id ?? "");
  const [audienceRole, setAudienceRole] = useState<NonNullable<LcEvent["audienceRole"]>>(event?.audienceRole ?? "exec");
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [emailInvite, setEmailInvite] = useState(!event);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (!event || event.audience !== "people") return;
    let cancelled = false;
    supabase.from("event_invitees").select("user_id").eq("event_id", event.id).then(({ data }) => {
      if (!cancelled) setPeople(new Set((data ?? []).map((r) => r.user_id as string)));
    });
    return () => { cancelled = true; };
  }, [event]);

  async function save() {
    if (!name.trim()) { setError("Give the event a name."); return; }
    if (endsOn < startsOn) { setError("The end date can't be before the start date."); return; }
    if (meetingUrl && !/^https:\/\//i.test(meetingUrl.trim())) { setError("The online link must start with https://"); return; }
    if (endTime && !startTime) { setError("Add a start time too, or clear the end time."); return; }
    if (audience === "people" && people.size === 0) { setError("Choose who the event is for."); return; }
    setSaving(true);
    setError(null);
    try {
      const fields = {
        name: name.trim(), type, starts_on: startsOn, ends_on: endsOn,
        starts_at: startTime ? toInstant(startsOn, startTime) : null,
        ends_at: startTime && endTime ? toInstant(endsOn, endTime) : null,
        location: location.trim() || null, meeting_url: meetingUrl.trim() || null, description: description.trim() || null,
        audience, department_id: audience === "department" ? departmentId || null : null,
        audience_role: audience === "role" ? audienceRole : null,
      };
      const res = event
        ? await supabase.from("lc_events").update(fields).eq("id", event.id).select("id").single()
        : await supabase.from("lc_events").insert({ ...fields, project_id: projectId, created_by: userId }).select("id").single();
      if (res.error) throw new Error(res.error.message);
      const id = res.data.id as string;
      if (audience === "people") {
        const { error: delErr } = await supabase.from("event_invitees").delete().eq("event_id", id);
        if (delErr) throw new Error(delErr.message);
        const { error: insErr } = await supabase.from("event_invitees").insert([...people].map((u) => ({ event_id: id, user_id: u })));
        if (insErr) throw new Error(insErr.message);
      }
      if (emailInvite) {
        try {
          const r = await authedPost<SendResult>("/api/events/invite", { eventId: id });
          setSent(`Event saved. ${describeSend(r)}`);
          return;   // keep the dialog open so the result is visible
        } catch (e) {
          setError(`The event is saved, but the invites weren't sent: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
      }
      onSaved();
    } catch (e) {
      setError(`Couldn't save the event: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const toggle = (id: string) => setPeople((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Modal
      title={event ? "Edit event" : "New event"} onClose={sent ? onSaved : onClose} width={560}
      footer={sent ? <Button onClick={onSaved}>Done</Button> : <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : emailInvite ? "Save and email invites" : "Save event"}</Button>
      </>}
    >
      {sent ? <p role="status" style={{ fontSize: 14, color: "var(--color-body)", margin: 0 }}>{sent}</p> : <>
        <Field label="Name" htmlFor="event-name">
          <input id="event-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. General Assembly" style={inputStyle} autoFocus />
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
          <Field label="Start time (optional)" htmlFor="event-start-time" hint="Leave empty for an all-day event.">
            <input id="event-start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="End time" htmlFor="event-end-time">
            <input id="event-end-time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} disabled={!startTime} />
          </Field>
        </div>
        <Field label="Location" htmlFor="event-location">
          <input id="event-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Faculty of Economics, room 2.1" style={inputStyle} />
        </Field>
        <Field label="Online link (optional)" htmlFor="event-url">
          <input id="event-url" type="url" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://zoom.us/j/…" style={inputStyle} />
        </Field>
        <Field label="Details (optional)" htmlFor="event-description">
          <textarea id="event-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...inputStyle, height: "auto", padding: 10, fontFamily: "inherit", resize: "vertical" }} />
        </Field>
        <Field label="Who is it for?" htmlFor="event-audience">
          <select id="event-audience" value={audience} onChange={(e) => setAudience(e.target.value as LcEvent["audience"])} style={selectStyle}>
            <option value="lc">The whole LC</option>
            <option value="department">One department</option>
            <option value="role">A role</option>
            <option value="people">Chosen people</option>
          </select>
        </Field>
        {audience === "department" && (
          <Field label="Department" htmlFor="event-department">
            <select id="event-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={selectStyle}>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        )}
        {audience === "role" && (
          <Field label="Role" htmlFor="event-role">
            <select id="event-role" value={audienceRole} onChange={(e) => setAudienceRole(e.target.value as typeof audienceRole)} style={selectStyle}>
              {Object.entries(AUDIENCE_ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        )}
        {audience === "people" && (
          <fieldset style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "8px 12px", margin: "0 0 14px", maxHeight: 180, overflowY: "auto" }}>
            <legend style={{ fontSize: 12, color: "var(--color-secondary)" }}>People ({people.size})</legend>
            {roster.map((m) => (
              <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}>
                <input type="checkbox" checked={people.has(m.id)} onChange={() => toggle(m.id)} style={{ accentColor: "var(--color-navy)" }} /> {m.name}
              </label>
            ))}
          </fieldset>
        )}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--color-body)" }}>
          <input type="checkbox" checked={emailInvite} onChange={(e) => setEmailInvite(e.target.checked)} style={{ accentColor: "var(--color-navy)", marginTop: 2 }} />
          <span>Email the invite now, with Going / Not going buttons and a calendar file. People get reminders 24 h and 1 h before.{event?.invitesSentAt ? " Only people who haven't had it yet get it." : ""}</span>
        </label>
        <ErrorText>{error}</ErrorText>
      </>}
    </Modal>
  );
}
