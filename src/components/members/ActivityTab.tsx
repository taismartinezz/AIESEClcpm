"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { activityFlags, mapActivity, type MemberActivity } from "@/lib/lifecycle";
import type { Department } from "@/types";
import { ErrorText, Panel } from "@/components/lc/ui";

/**
 * Activity signals per member (president: everyone; VP: their departments) and
 * term dates. Check-in participation is deliberately not shown: the check-in
 * promises nobody can see who answered.
 */
export default function ActivityTab({ projectId, names, departments }: { projectId: string; names: Record<string, string>; departments: Department[] }) {
  const [rows, setRows] = useState<MemberActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await supabase.rpc("member_activity", { p_project_id: projectId });
        if (err) throw new Error(err.message);
        if (!cancelled) { setRows(((data ?? []) as Record<string, unknown>[]).map(mapActivity)); setError(null); }
      } catch (e) {
        if (!cancelled) setError(`Couldn't load activity: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, version]);

  async function setTerm(a: MemberActivity, start: string | null, end: string | null) {
    setSavingId(a.userId);
    setError(null);
    try {
      const { error: err } = await supabase.rpc("set_member_term", { p_project_id: projectId, p_user_id: a.userId, p_start: start || null, p_end: end || null });
      if (err) throw new Error(err.message);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(`Couldn't save the term dates: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingId(null);
    }
  }

  const withFlags = rows.map((a) => ({ a, flags: activityFlags(a) })).sort((x, y) => y.flags.length - x.flags.length);
  const shown = onlyFlagged ? withFlags.filter((x) => x.flags.length > 0) : withFlags;
  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderTop: "1px solid var(--color-border)", verticalAlign: "top" };
  const dateInput: React.CSSProperties = { height: 28, fontSize: 12, border: "1px solid var(--color-border)", borderRadius: 6, padding: "0 6px", backgroundColor: "var(--color-canvas)", color: "var(--color-body)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
        Signals from the last 60 days: when someone last opened the app, events attended, tabling no-shows and overdue tasks.
        Use them to start a conversation. Check-in answers and who did the check-in are never shown here.
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-body)" }}>
        <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} style={{ accentColor: "var(--color-navy)" }} /> Only people with a signal
      </label>
      <ErrorText>{error}</ErrorText>
      <Panel>
        {!loaded ? <div className="animate-pulse" style={{ height: 120, backgroundColor: "var(--color-dimmed-bg)" }} /> : shown.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>{rows.length === 0 ? "No members you look after yet." : "Nobody needs a check-in right now."}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th scope="col" style={th}>Member</th><th scope="col" style={th}>Signals</th><th scope="col" style={th}>Events</th><th scope="col" style={th}>Onboarding</th><th scope="col" style={th}>Term</th></tr></thead>
              <tbody>
                {shown.map(({ a, flags }) => (
                  <tr key={a.userId} style={{ opacity: savingId === a.userId ? 0.6 : 1 }}>
                    <td style={td}>
                      <strong style={{ fontWeight: 600 }}>{names[a.userId] ?? "Member"}</strong>
                      <div style={{ fontSize: 11, color: "var(--color-secondary)" }}>{departments.find((d) => d.id === a.departmentId)?.name ?? "No department"} · {a.role}</div>
                    </td>
                    <td style={td}>
                      {flags.length === 0 ? <span style={{ color: "var(--color-secondary)" }}>-</span> : flags.map((f) => (
                        <div key={f.kind} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--color-warning)" }}>
                          <AlertTriangle size={11} aria-hidden="true" /> {f.label}
                        </div>
                      ))}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{a.eventsAttended} / {a.eventsHeld}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{a.onboardingDone} / {a.onboardingTotal}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <input type="date" aria-label={`Term start for ${names[a.userId] ?? "member"}`} defaultValue={a.termStart ?? ""} style={dateInput}
                        onBlur={(e) => { if ((e.target.value || null) !== a.termStart) setTerm(a, e.target.value, a.termEnd); }} />
                      {" – "}
                      <input type="date" aria-label={`Term end for ${names[a.userId] ?? "member"}`} defaultValue={a.termEnd ?? ""} style={dateInput}
                        onBlur={(e) => { if ((e.target.value || null) !== a.termEnd) setTerm(a, a.termStart, e.target.value); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
