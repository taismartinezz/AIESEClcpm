"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ShieldCheck, HeartPulse, ArrowRight } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  CHECKIN_QUESTIONS, DEFAULT_CADENCE, hasVisibleData, periodStart, privacyMessage, summarize, thisPeriod, toSeries,
  type CheckinCadence,
  type PulseRow, type PulseSeries, type PulseSummary,
} from "@/lib/wellbeing";
import type { Department } from "@/types";
import PulseTrend from "./PulseTrend";


// ── Data ──────────────────────────────────────────────────────────────────────

type PulseState = { loading: boolean; error: string | null; series: PulseSeries[]; cadence: CheckinCadence };

const IDLE: PulseState = { loading: false, error: null, series: [], cadence: DEFAULT_CADENCE };

function usePulse(rpc: "get_exec_pulse" | "get_member_pulse", projectId: string | null): PulseState {
  const [state, setState] = useState<PulseState>({ loading: true, error: null, series: [], cadence: DEFAULT_CADENCE });
  const enabled = Boolean(projectId) && isSupabaseConfigured;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const [pulse, proj] = await Promise.all([
          supabase.rpc(rpc, { p_project_id: projectId }),
          supabase.from("projects").select("checkin_period_weeks").eq("id", projectId).maybeSingle(),
        ]);
        if (pulse.error) throw new Error(pulse.error.message);
        const cadence = ((proj.data?.checkin_period_weeks as number) === 1 ? 1 : 2) as CheckinCadence;
        if (!cancelled) setState({ loading: false, error: null, series: toSeries((pulse.data ?? []) as PulseRow[]), cadence });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e instanceof Error ? e.message : String(e), series: [], cadence: DEFAULT_CADENCE });
      }
    })();
    return () => { cancelled = true; };
  }, [rpc, projectId, enabled]);
  return enabled ? state : IDLE;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function Card({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      style={{ flex: "1 1 320px", minWidth: 0, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", overflow: "hidden" }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", borderBottom: "1px solid var(--color-border)" }}>
        {icon}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--color-navy)", margin: 0 }}>{title}</h2>
          <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>{subtitle}</p>
        </div>
      </header>
      <div style={{ padding: "12px 14px 14px" }}>{children}</div>
      <footer style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderTop: "1px solid var(--color-border)", fontSize: 10, color: "var(--color-secondary)" }}>
        <ShieldCheck size={12} aria-hidden="true" /> Averages only. Individual answers are never shown.
      </footer>
    </section>
  );
}

/** One compact line while nothing has reached the privacy threshold yet. */
function Waiting({ title, icon, cadence }: { title: string; icon: React.ReactNode; cadence: CheckinCadence }) {
  return (
    <section aria-label={title} style={{ flex: "1 1 320px", minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
      {icon}
      <p style={{ margin: 0, fontSize: 12, color: "var(--color-secondary)" }}>
        <strong style={{ color: "var(--color-navy)" }}>{title}</strong> appears once enough people have checked in {thisPeriod(cadence)}. Averages only, never individual answers.
      </p>
    </section>
  );
}

function Skeleton() {
  return <div className="animate-pulse" style={{ height: 120, borderRadius: 8, backgroundColor: "var(--color-dimmed-bg)" }} />;
}

function ErrorNote({ message }: { message: string }) {
  return <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: 0 }}>Couldn&apos;t load the pulse: {message}</p>;
}

function Headline({ summary, cadence }: { summary: PulseSummary; cadence: CheckinCadence }) {
  const current = summary.current;
  const showsThisWeek = current && !current.suppressed && current.overall != null;
  return (
    <div style={{ marginBottom: 10 }}>
      {showsThisWeek ? (
        <p style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 28, fontWeight: 600, color: "var(--color-body)", fontVariantNumeric: "tabular-nums" }}>{current!.overall!.toFixed(1)}</span>
          <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>/ 5 {thisPeriod(cadence)} · {current!.respondents} responses</span>
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-body)" }}>{privacyMessage(cadence)}.</p>
      )}
      <Change summary={summary} />
    </div>
  );
}

function Change({ summary }: { summary: PulseSummary }) {
  if (summary.change == null) return null;
  const { change, dropped } = summary;
  const text = Math.abs(change) < 0.05
    ? "Same as the average of the last 4 check-ins"
    : `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(1)} vs the last 4 check-ins`;
  return (
    <p style={{ display: "flex", alignItems: "center", gap: 4, margin: "4px 0 0", fontSize: 11, fontWeight: dropped ? 600 : 400, color: dropped ? "var(--color-warning)" : "var(--color-secondary)" }}>
      {dropped && <AlertTriangle size={12} aria-hidden="true" />}
      {dropped ? `Dropped noticeably: ${text}` : text}
    </p>
  );
}

function QuestionBreakdown({ summary }: { summary: PulseSummary }) {
  const latest = summary.latest;
  if (!latest) return null;
  const items = CHECKIN_QUESTIONS.filter((q) => latest.byQuestion[q.id] != null);
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "4px 12px", margin: "10px 0 0" }}>
      {items.map((q) => (
        <div key={q.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <dt style={{ color: "var(--color-secondary)" }}>{q.short}</dt>
          <dd style={{ margin: 0, color: "var(--color-body)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{latest.byQuestion[q.id].toFixed(1)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SeriesBody({ series, label, cadence }: { series: PulseSeries | undefined; label: string; cadence: CheckinCadence }) {
  const summary = summarize(series);
  return (
    <>
      <Headline summary={summary} cadence={cadence} />
      {series && <PulseTrend periods={series.periods} label={label} cadence={cadence} />}
      <QuestionBreakdown summary={summary} />
    </>
  );
}

// ── Department rows (president + VPs leading several departments) ────────────

function DepartmentRows({ series, departments }: { series: PulseSeries[]; departments: Department[] }) {
  const rows = useMemo(() => departments
    .map((d) => ({ dept: d, summary: summarize(series.find((s) => s.groupId === d.id)) }))
    .sort((a, b) => Number(b.summary.dropped) - Number(a.summary.dropped) || a.dept.sortOrder - b.dept.sortOrder),
  [series, departments]);

  const shown = rows.filter(({ summary }) => summary.dropped || (summary.current && !summary.current.suppressed && summary.current.overall != null));
  const hidden = rows.length - shown.length;

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {shown.map(({ dept, summary }) => {
        const current = summary.current;
        const visible = current && !current.suppressed && current.overall != null;
        return (
          <li key={dept.id} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", margin: "0 -8px", borderRadius: 6,
            borderTop: "1px solid var(--color-border)",
            backgroundColor: summary.dropped ? "var(--color-warning-bg)" : undefined,
          }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: dept.color, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--color-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dept.name}</span>
            {summary.dropped && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, color: "var(--color-warning)" }}>
                <AlertTriangle size={11} aria-hidden="true" /> −{Math.abs(summary.change!).toFixed(1)} vs last 4
              </span>
            )}
            <span style={{ fontSize: visible ? 13 : 10, fontWeight: visible ? 600 : 400, color: visible ? "var(--color-body)" : "var(--color-secondary)", fontVariantNumeric: "tabular-nums", textAlign: "right", maxWidth: 150 }}>
              {visible ? current!.overall!.toFixed(1) : "Not enough responses"}
            </span>
          </li>
        );
      })}
      {hidden > 0 && (
        <li style={{ padding: "7px 0", borderTop: "1px solid var(--color-border)", fontSize: 11, color: "var(--color-secondary)" }}>
          {hidden === rows.length
            ? "No department has enough responses yet to show an average."
            : `${hidden} other department${hidden === 1 ? " doesn't" : "s don't"} have enough responses yet to show an average.`}
        </li>
      )}
    </ul>
  );
}

// ── Areas (president): Outgoing / Incoming / Support pool small departments ──

const AREAS = [
  { id: "outgoing", label: "Outgoing (oGX)" },
  { id: "incoming", label: "Incoming (iGX)" },
  { id: "support", label: "Support (MKT, TM, F&L, BD…)" },
];

function AreaRows({ projectId }: { projectId: string | null }) {
  const [series, setSeries] = useState<PulseSeries[] | null>(null);
  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    let cancelled = false;
    supabase.rpc("get_area_pulse", { p_project_id: projectId }).then(({ data, error }) => {
      if (cancelled || error) return;
      setSeries(toSeries(((data ?? []) as (PulseRow & { area: string })[]).map((r) => ({ ...r, department_id: r.area }))));
    });
    return () => { cancelled = true; };
  }, [projectId]);
  if (!series) return null;
  return (
    <>
      <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: "14px 0 6px" }}>By area</h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {AREAS.map((a) => {
          const summary = summarize(series.find((x) => x.groupId === a.id));
          const cur = summary.current;
          const visible = cur && !cur.suppressed && cur.overall != null;
          return (
            <li key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid var(--color-border)", fontSize: 12 }}>
              <span style={{ flex: 1, color: "var(--color-body)" }}>{a.label}</span>
              {summary.dropped && <AlertTriangle size={11} color="var(--color-warning)" aria-label="dropped noticeably" />}
              <span style={{ fontSize: visible ? 13 : 11, fontWeight: visible ? 600 : 400, color: visible ? "var(--color-body)" : "var(--color-secondary)", fontVariantNumeric: "tabular-nums" }}>
                {visible ? cur!.overall!.toFixed(1) : "not enough yet"}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ── Public cards ──────────────────────────────────────────────────────────────

/** President only: the executive board's average. */
export function ExecPulseCard({ projectId }: { projectId: string | null }) {
  const { loading, error, series, cadence } = usePulse("get_exec_pulse", projectId);
  if (!loading && !error && !hasVisibleData(series)) return <Waiting title="Exec Pulse" cadence={cadence} icon={<Activity size={15} color="var(--color-navy)" aria-hidden="true" />} />;
  return (
    <Card title="Exec Pulse" subtitle="How your VPs are doing. Only you see this." icon={<Activity size={15} color="var(--color-navy)" aria-hidden="true" />}>
      {loading ? <Skeleton /> : error ? <ErrorNote message={error} /> : <SeriesBody series={series[0]} label="Exec Pulse" cadence={cadence} />}
    </Card>
  );
}

/** President: whole-LC member average plus a per-department breakdown. */
export function MemberPulseCard({ projectId, departments }: { projectId: string | null; departments: Department[] }) {
  const { loading, error, series, cadence } = usePulse("get_member_pulse", projectId);
  const total = series.find((s) => s.groupId === null);
  const flagged = departments.filter((d) => summarize(series.find((s) => s.groupId === d.id)).dropped).length;
  if (!loading && !error && !hasVisibleData(series)) return <Waiting title="Member Pulse" cadence={cadence} icon={<HeartPulse size={15} color="var(--color-navy)" aria-hidden="true" />} />;
  return (
    <Card
      title="Member Pulse"
      subtitle={flagged ? `${flagged} department${flagged === 1 ? "" : "s"} dropped noticeably ${thisPeriod(cadence)}` : "All members, by department"}
      icon={<HeartPulse size={15} color="var(--color-navy)" aria-hidden="true" />}
    >
      {loading ? <Skeleton /> : error ? <ErrorNote message={error} /> : (
        <>
          <SeriesBody series={total} label="Member Pulse, whole LC" cadence={cadence} />
          <AreaRows projectId={projectId} />
          <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: "14px 0 6px" }}>
            By department · {thisPeriod(cadence)}
          </h3>
          <DepartmentRows series={series} departments={departments} />
        </>
      )}
    </Card>
  );
}

/** VP: the departments they lead (RLS-limited server-side to exactly those). */
export function DepartmentPulseCard({ projectId, departments }: { projectId: string | null; departments: Department[] }) {
  const { loading, error, series, cadence } = usePulse("get_member_pulse", projectId);
  const led = departments.filter((d) => series.some((s) => s.groupId === d.id));
  const title = led.length > 1 ? "My Departments' Pulse" : "My Department's Pulse";
  return (
    <Card title={title} subtitle={led.length ? led.map((d) => d.name).join(" · ") : "Your members' check-in"} icon={<HeartPulse size={15} color="var(--color-navy)" aria-hidden="true" />}>
      {loading ? <Skeleton /> : error ? <ErrorNote message={error} /> : led.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
          You don&apos;t lead a department yet. Your LCP can assign you one in Settings → Departments.
        </p>
      ) : led.length === 1 ? (
        <SeriesBody series={series.find((s) => s.groupId === led[0].id)} label={led[0].name} cadence={cadence} />
      ) : (
        <DepartmentRows series={series} departments={led} />
      )}
    </Card>
  );
}

/** Members (and VPs): a nudge to do this period's check-in. Shows no pulse data. */
export function CheckinNudgeCard({ projectId, userId }: { projectId: string | null; userId: string | null }) {
  const [state, setState] = useState<{ done: boolean; cadence: CheckinCadence } | null>(null);
  useEffect(() => {
    if (!projectId || !userId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const { data: proj } = await supabase.from("projects").select("checkin_period_weeks").eq("id", projectId).maybeSingle();
      const cadence = ((proj?.checkin_period_weeks as number) === 1 ? 1 : 2) as CheckinCadence;
      const { count, error } = await supabase
        .from("checkins")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .eq("period_start", periodStart(cadence).toISOString().slice(0, 10));
      if (!cancelled) setState({ done: !error && (count ?? 0) > 0, cadence });
    })();
    return () => { cancelled = true; };
  }, [projectId, userId]);

  if (!state || state.done) return null;
  const when = thisPeriod(state.cadence);
  return (
    <Link
      href="/checkin"
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", textDecoration: "none",
        backgroundColor: "var(--color-navy-dim)", border: "1px solid var(--color-border)", borderRadius: 10,
      }}
    >
      <HeartPulse size={18} color="var(--color-navy)" aria-hidden="true" />
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-navy)" }}>
          Your check-in for {when} is waiting
        </span>
        <span style={{ display: "block", fontSize: 12, color: "var(--color-secondary)", marginTop: 2 }}>
          About a minute. Only averages are ever shared, never your answers.
        </span>
      </span>
      <ArrowRight size={16} color="var(--color-navy)" aria-hidden="true" />
    </Link>
  );
}
