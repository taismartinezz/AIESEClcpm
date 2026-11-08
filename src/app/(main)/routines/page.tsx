"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Repeat, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { useProject } from "@/context/ProjectContext";
import { useLcMembers } from "@/hooks/useLcMembers";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { askConfirm } from "@/components/ui/confirm";
import { Button, ErrorText, Field, Panel, inputStyle } from "@/components/lc/ui";
import { formatDay } from "@/lib/dates";
import {
  AREA_LABEL, departmentForArea, describe, nextDue, ROUTINE_TEMPLATES,
  type Area, type Assignee, type Freq, type RoutineTemplate, type Schedule,
} from "@/lib/routines";

interface Routine extends Schedule {
  id: string; title: string; why: string | null; department_id: string | null;
  assignee: Assignee; assignee_user_id: string | null; lead_days: number; active: boolean; template_key: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * What repeats in the LC, who does it and why (the planning template's
 * "Calendar suggestions"). The database turns each routine into a task a few
 * days before it's due (run_routines, daily and after every change here).
 */
export default function RoutinesPage() {
  const { projectId, userId, role, departments, isLoading } = useProject();
  const { members } = useLcMembers(projectId);
  const exec = role === "president" || role === "vp";
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const enabled = isSupabaseConfigured && Boolean(projectId);

  useEffect(() => {
    if (!enabled || isLoading) return;
    let cancelled = false;
    supabase.from("routines").select("*").eq("project_id", projectId!).order("created_at").then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setError(`Couldn't load routines: ${err.message}`);
      else { setRoutines((data ?? []) as Routine[]); setError(null); }
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [enabled, isLoading, projectId, version]);

  /** Create any tasks now due, so a new routine doesn't wait for tomorrow's job. */
  async function runNow(message: string) {
    const { data, error: err } = await supabase.rpc("run_routines", { p_project_id: projectId });
    const n = typeof data === "number" ? data : 0;
    setNote(err ? message : `${message}${n ? ` ${n} ${n === 1 ? "task" : "tasks"} created for what's due soon.` : ""}`);
    setVersion((v) => v + 1);
  }

  async function add(rows: Record<string, unknown>[], message: string) {
    setError(null);
    setNote(null);
    const { error: err } = await supabase.from("routines").insert(rows.map((r) => ({ ...r, project_id: projectId, created_by: userId })));
    if (err) { setError(`Couldn't add: ${err.message}`); return false; }
    await runNow(message);
    return true;
  }

  const fromTemplate = (t: RoutineTemplate) => ({
    title: t.title, why: t.why, assignee: t.assignee, freq: t.freq, weekday: t.weekday ?? null, anchor: t.anchor ?? null,
    month_day: t.month_day ?? null, nth: t.nth ?? null, months: t.months ?? null, lead_days: t.lead_days, template_key: t.key,
    department_id: departmentForArea(t.area, departments),
  });

  async function toggle(r: Routine) {
    const { error: err } = await supabase.from("routines").update({ active: !r.active }).eq("id", r.id);
    if (err) { setError(`Couldn't change it: ${err.message}`); return; }
    if (!r.active) await runNow(`"${r.title}" is back on.`); else setVersion((v) => v + 1);
  }

  async function remove(r: Routine) {
    if (!(await askConfirm(`Delete the routine "${r.title}"? Tasks it already created stay.`, { confirmLabel: "Delete" }))) return;
    const { error: err } = await supabase.from("routines").delete().eq("id", r.id);
    if (err) setError(`Couldn't delete: ${err.message}`); else setVersion((v) => v + 1);
  }

  const deptName = (id: string | null) => (id ? departments.find((d) => d.id === id)?.name ?? "Department" : "LC-wide");
  const who = (r: Routine) => {
    if (r.assignee === "person") return members.find((m) => m.id === r.assignee_user_id)?.name ?? "Someone";
    if (r.assignee === "president") return "The LCP";
    const vp = departments.find((d) => d.id === r.department_id)?.vpUserId;
    return vp ? `${members.find((m) => m.id === vp)?.name ?? "The VP"} (VP)` : "The LCP (no VP yet)";
  };
  const groups = useMemo(() => {
    const by = new Map<string, Routine[]>();
    for (const r of routines) by.set(r.department_id ?? "", [...(by.get(r.department_id ?? "") ?? []), r]);
    return [...by.entries()];
  }, [routines]);
  const added = new Set(routines.map((r) => r.template_key).filter(Boolean));

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Routines" subtitle="What repeats in your LC, who does it and why. Each one becomes a task a few days before it's due."
        action={exec && enabled ? <Button onClick={() => setCreating((v) => !v)}><Plus size={14} aria-hidden="true" /> New routine</Button> : undefined} />
      <div className="flex-1 overflow-auto" style={{ padding: "16px clamp(16px, 3vw, 28px)", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
        {!isSupabaseConfigured ? (
          <NeedsDatabase what="Routines">The weekly EB meeting, SONA to the MC by the 1st, the semester audit: routines that turn into tasks for the right person, on time.</NeedsDatabase>
        ) : (
          <>
            <ErrorText>{error}</ErrorText>
            {note && <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--color-body)", backgroundColor: "var(--color-navy-dim)", borderRadius: 8, padding: "8px 12px" }}>{note}</p>}
            {creating && exec && (
              <NewRoutine departments={departments} members={members}
                onCancel={() => setCreating(false)}
                onSave={async (row) => { if (await add([row], `"${row.title}" added.`)) setCreating(false); }} />
            )}
            {!loaded ? (
              <div className="animate-pulse" style={{ height: 120, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
            ) : routines.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>
                {exec ? "No routines yet. Start from the AIESEC routines below, or make your own." : "Your LC hasn't set up routines yet."}
              </p>
            ) : groups.map(([dept, list]) => (
              <Panel key={dept || "lc"} title={deptName(dept || null)}>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {list.map((r) => {
                    const next = r.active ? nextDue(r, today()) : null;
                    return (
                      <li key={r.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 14px", borderTop: "1px solid var(--color-border)", opacity: r.active ? 1 : 0.6 }}>
                        <Repeat size={14} color="var(--color-navy)" aria-hidden="true" style={{ marginTop: 3, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong style={{ fontSize: 13 }}>{r.title}</strong>
                          <span style={{ display: "block", fontSize: 12, color: "var(--color-body)" }}>
                            {describe(r)} · {who(r)}{next ? ` · next: ${formatDay(next)}` : r.active ? "" : " · paused"}
                          </span>
                          {r.why && <span style={{ display: "block", fontSize: 12, color: "var(--color-secondary)", marginTop: 2 }}>{r.why}</span>}
                        </div>
                        {exec && (
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                            <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, color: "var(--color-secondary)" }}>
                              <input type="checkbox" checked={r.active} onChange={() => toggle(r)} aria-label={`${r.title} on`} /> On
                            </label>
                            <button type="button" aria-label={`Delete ${r.title}`} onClick={() => remove(r)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                              <Trash2 size={13} color="var(--color-secondary)" />
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            ))}
            {exec && <Templates added={added} departments={departments} onAdd={(ts) => add(ts.map(fromTemplate), ts.length === 1 ? `"${ts[0].title}" added.` : `${ts.length} routines added.`)} />}
          </>
        )}
      </div>
    </div>
  );
}

/** The AIESEC routines from the LC planning template, by area. */
function Templates({ added, departments, onAdd }: {
  added: Set<string | null>; departments: { id: string; name: string; products: string[] }[]; onAdd: (t: RoutineTemplate[]) => void;
}) {
  const areas = [...new Set(ROUTINE_TEMPLATES.map((t) => t.area))] as Area[];
  return (
    <Panel title="AIESEC routines">
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0, padding: "10px 14px 0" }}>
        From the LC planning template. Each goes to the matching department&apos;s VP (or the LCP); you can turn any off or delete it later.
      </p>
      {areas.map((area) => {
        const list = ROUTINE_TEMPLATES.filter((t) => t.area === area);
        const missing = list.filter((t) => !added.has(t.key));
        const dept = departmentForArea(area, departments);
        return (
          <div key={area} style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border)", marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <strong style={{ flex: 1, fontSize: 13 }}>{AREA_LABEL[area]}
                {area !== "lcp" && <span style={{ fontWeight: 400, fontSize: 12, color: "var(--color-secondary)" }}> · {dept ? departments.find((d) => d.id === dept)?.name : "no matching department: goes to the LCP"}</span>}
              </strong>
              {missing.length > 1 && <Button variant="secondary" onClick={() => onAdd(missing)}>Add all {missing.length}</Button>}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {list.map((t) => (
                <li key={t.key} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13 }}>{t.title}</span>
                    <span style={{ fontSize: 12, color: "var(--color-secondary)" }}> · {describe(t)}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--color-secondary)" }}>{t.why}</span>
                  </div>
                  {added.has(t.key)
                    ? <span style={{ fontSize: 12, color: "var(--color-secondary)", flexShrink: 0 }}>Added</span>
                    : <Button variant="secondary" onClick={() => onAdd([t])} aria-label={`Add ${t.title}`}>Add</Button>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </Panel>
  );
}

/** A routine of the LC's own. */
function NewRoutine({ departments, members, onSave, onCancel }: {
  departments: { id: string; name: string; vpUserId: string | null }[]; members: { id: string; name: string }[];
  onSave: (row: Record<string, unknown> & { title: string }) => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [dept, setDept] = useState("");
  const [assignee, setAssignee] = useState<Assignee>("president");
  const [person, setPerson] = useState("");
  const [freq, setFreq] = useState<Freq>("weekly");
  const [weekday, setWeekday] = useState(1);
  const [anchor, setAnchor] = useState(today());
  const [monthly, setMonthly] = useState<"day" | "nth" | "last">("day");
  const [monthDay, setMonthDay] = useState(1);
  const [nth, setNth] = useState(1);
  const [months, setMonths] = useState<number[]>([]);
  const [lead, setLead] = useState(3);
  const [error, setError] = useState<string | null>(null);

  // Biweekly: the start date has to be the chosen weekday; move it forward to the next one.
  const anchorOnWeekday = (() => {
    const d = new Date(`${anchor}T00:00:00Z`);
    while (((d.getUTCDay() + 6) % 7) + 1 !== weekday) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const schedule: Schedule = freq === "weekly" ? { freq, weekday }
    : freq === "biweekly" ? { freq, weekday, anchor: anchorOnWeekday }
    : { freq, months: months.length ? months : null, ...(monthly === "day" ? { month_day: monthDay } : monthly === "last" ? { month_day: -1 } : { nth, weekday }) };

  function submit() {
    if (!title.trim()) { setError("Give it a title."); return; }
    if (assignee === "department_vp" && !dept) { setError("Pick the department whose VP does it."); return; }
    if (assignee === "person" && !person) { setError("Pick who does it."); return; }
    onSave({
      title: title.trim(), why: why.trim() || null, department_id: dept || null, assignee, assignee_user_id: assignee === "person" ? person : null,
      freq, weekday: schedule.weekday ?? null, anchor: schedule.anchor ?? null, month_day: schedule.month_day ?? null, nth: schedule.nth ?? null,
      months: schedule.months ?? null, lead_days: lead,
    });
  }

  const select = { ...inputStyle, width: "auto", minWidth: 140 };
  return (
    <Panel title="New routine">
      <div style={{ padding: 14, display: "grid", gap: 4 }}>
        <Field label="What" htmlFor="rt-title"><input id="rt-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Partner check-in call" style={inputStyle} /></Field>
        <Field label="Why it matters (optional)" htmlFor="rt-why"><input id="rt-why" value={why} maxLength={1000} onChange={(e) => setWhy(e.target.value)} style={inputStyle} /></Field>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Field label="Area" htmlFor="rt-dept">
            <select id="rt-dept" value={dept} onChange={(e) => setDept(e.target.value)} style={select}>
              <option value="">LC-wide</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Who does it" htmlFor="rt-who">
            <select id="rt-who" value={assignee} onChange={(e) => setAssignee(e.target.value as Assignee)} style={select}>
              <option value="president">The LCP</option>
              <option value="department_vp">The area&apos;s VP</option>
              <option value="person">Someone specific</option>
            </select>
          </Field>
          {assignee === "person" && (
            <Field label="Person" htmlFor="rt-person">
              <select id="rt-person" value={person} onChange={(e) => setPerson(e.target.value)} style={select}>
                <option value="">Choose…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="How often" htmlFor="rt-freq">
            <select id="rt-freq" value={freq} onChange={(e) => setFreq(e.target.value as Freq)} style={select}>
              <option value="weekly">Every week</option>
              <option value="biweekly">Every other week</option>
              <option value="monthly">Every month (or some months)</option>
            </select>
          </Field>
          {freq !== "monthly" && (
            <Field label="On" htmlFor="rt-weekday">
              <select id="rt-weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} style={select}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select>
            </Field>
          )}
          {freq === "biweekly" && (
            <Field label="Starting" htmlFor="rt-anchor"><input id="rt-anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} style={select} /></Field>
          )}
          {freq === "monthly" && (
            <>
              <Field label="When in the month" htmlFor="rt-monthly">
                <select id="rt-monthly" value={monthly} onChange={(e) => setMonthly(e.target.value as "day" | "nth" | "last")} style={select}>
                  <option value="day">A day of the month</option>
                  <option value="nth">A weekday (e.g. last Monday)</option>
                  <option value="last">The last day</option>
                </select>
              </Field>
              {monthly === "day" && (
                <Field label="Day" htmlFor="rt-day">
                  <select id="rt-day" value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))} style={select}>
                    {Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                  </select>
                </Field>
              )}
              {monthly === "nth" && (
                <>
                  <Field label="Which" htmlFor="rt-nth">
                    <select id="rt-nth" value={nth} onChange={(e) => setNth(Number(e.target.value))} style={select}>
                      <option value={1}>First</option><option value={2}>Second</option><option value={3}>Third</option><option value={4}>Fourth</option><option value={-1}>Last</option>
                    </select>
                  </Field>
                  <Field label="Weekday" htmlFor="rt-weekday-m">
                    <select id="rt-weekday-m" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} style={select}>
                      {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                    </select>
                  </Field>
                </>
              )}
            </>
          )}
          <Field label="Task created (days before)" htmlFor="rt-lead">
            <input id="rt-lead" type="number" min={0} max={30} value={lead} onChange={(e) => setLead(Math.max(0, Math.min(30, Number(e.target.value) || 0)))} style={{ ...select, minWidth: 80, width: 80 }} />
          </Field>
        </div>
        {freq === "monthly" && (
          <fieldset style={{ border: "none", padding: 0, margin: "0 0 10px" }}>
            <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", marginBottom: 6 }}>Only in these months (none ticked = every month)</legend>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {MONTHS.map((m, i) => (
                <label key={m} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
                  <input type="checkbox" checked={months.includes(i + 1)} onChange={(e) => setMonths((ms) => (e.target.checked ? [...ms, i + 1].sort((a, b) => a - b) : ms.filter((x) => x !== i + 1)))} /> {m}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <p style={{ fontSize: 13, margin: "0 0 10px" }}>
          <strong>{describe(schedule)}</strong>{(() => { const n = nextDue(schedule, today()); return n ? `, next on ${formatDay(n)}` : ""; })()}
        </p>
        <ErrorText>{error}</ErrorText>
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={submit}>Add routine</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Panel>
  );
}
