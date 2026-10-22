"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { CHECKIN_QUESTIONS } from "@/lib/wellbeing";

const fieldStyle: React.CSSProperties = {
  width: 72, height: 34, border: "1px solid var(--color-border)", borderRadius: 6, padding: "0 8px",
  fontSize: 13, backgroundColor: "var(--color-canvas)", color: "var(--color-body)",
};

/**
 * President-only: privacy thresholds for Exec Pulse and Member Pulse, and which
 * check-in questions the LC asks. The database enforces a floor of 2.
 */
export default function WellbeingSettings({ projectId }: { projectId: string }) {
  const [execMin, setExecMin] = useState(3);
  const [deptMin, setDeptMin] = useState(3);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [cadence, setCadence] = useState<1 | 2>(2);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("min_exec_respondents, min_wellbeing_respondents, checkin_disabled_questions, checkin_period_weeks")
        .eq("id", projectId)
        .maybeSingle();
      if (cancelled) return;
      if (error) { setMessage({ text: `Couldn't load wellbeing settings: ${error.message}`, error: true }); return; }
      if (data) {
        setExecMin((data.min_exec_respondents as number) ?? 3);
        setDeptMin((data.min_wellbeing_respondents as number) ?? 3);
        setDisabled((data.checkin_disabled_questions as string[]) ?? []);
        setCadence((data.checkin_period_weeks as number) === 1 ? 1 : 2);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  async function save() {
    if (disabled.length >= CHECKIN_QUESTIONS.length) {
      setMessage({ text: "Keep at least one question switched on.", error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase.from("projects").update({
        min_exec_respondents: execMin,
        min_wellbeing_respondents: deptMin,
        checkin_disabled_questions: disabled,
        checkin_period_weeks: cadence,
      }).eq("id", projectId);
      if (error) throw new Error(error.message);
      setMessage({ text: "Wellbeing settings saved.", error: false });
    } catch (e) {
      setMessage({ text: `Couldn't save: ${e instanceof Error ? e.message : String(e)}`, error: true });
    } finally {
      setSaving(false);
    }
  }

  const clamp = (n: number) => Math.max(2, Math.min(50, Number.isFinite(n) ? Math.round(n) : 3));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", marginBottom: 8 }}>How often does your LC check in?</legend>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {([2, 1] as const).map((w) => (
            <label key={w} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-body)", cursor: "pointer" }}>
              <input type="radio" name="checkin-cadence" checked={cadence === w} onChange={() => setCadence(w)} style={{ accentColor: "var(--color-navy)" }} />
              {w === 2 ? "Every two weeks (recommended)" : "Every week"}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 10px", lineHeight: 1.5 }}>
          A check-in&apos;s average is only shown when at least this many people answered. Lower numbers show
          more check-ins but make it easier to guess who said what; 3 is the recommended minimum.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-body)" }}>
            <input type="number" min={2} max={50} value={execMin} onChange={(e) => setExecMin(clamp(e.target.valueAsNumber))} style={fieldStyle} />
            Exec Pulse (VPs)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-body)" }}>
            <input type="number" min={2} max={50} value={deptMin} onChange={(e) => setDeptMin(clamp(e.target.valueAsNumber))} style={fieldStyle} />
            Member Pulse (per department)
          </label>
        </div>
      </div>

      <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--color-secondary)", marginBottom: 8 }}>Questions your LC answers</legend>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {CHECKIN_QUESTIONS.map((q) => (
            <label key={q.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--color-body)", lineHeight: 1.4, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!disabled.includes(q.id)}
                onChange={(e) => setDisabled((prev) => e.target.checked ? prev.filter((id) => id !== q.id) : [...prev, q.id])}
                style={{ marginTop: 2, accentColor: "var(--color-navy)" }}
              />
              <span><strong style={{ fontWeight: 600 }}>{q.short}</strong>: {q.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button" onClick={save} disabled={saving}
          style={{ height: 38, padding: "0 18px", backgroundColor: "var(--color-btn-primary)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? "Saving…" : "Save wellbeing settings"}
        </button>
        {message && (
          <span role={message.error ? "alert" : "status"} style={{ fontSize: 12, color: message.error ? "var(--color-error)" : "var(--color-success)" }}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
