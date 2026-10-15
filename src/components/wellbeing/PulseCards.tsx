"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ShieldCheck, HeartPulse, ArrowRight } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  CHECKIN_QUESTIONS, currentWeekStart, summarize, toSeries,
  type PulseRow, type PulseSeries, type PulseSummary,
} from "@/lib/wellbeing";
import type { Department } from "@/types";
import PulseTrend from "./PulseTrend";

export const PRIVACY_MESSAGE = "Not enough responses this week to protect privacy";

// ── Data ──────────────────────────────────────────────────────────────────────

type PulseState = { loading: boolean; error: string | null; series: PulseSeries[] };

const IDLE: PulseState = { loading: false, error: null, series: [] };

function usePulse(rpc: "get_exec_pulse" | "get_member_pulse", projectId: string | null): PulseState {
  const [state, setState] = useState<PulseState>({ loading: true, error: null, series: [] });
  const enabled = Boolean(projectId) && isSupabaseConfigured;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc(rpc, { p_project_id: projectId });
        if (error) throw new Error(error.message);
        if (!cancelled) setState({ loading: false, error: null, series: toSeries((data ?? []) as PulseRow[]) });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e instanceof Error ? e.message : String(e), series: [] });
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

function Skeleton() {
  return <div className="animate-pulse" style={{ height: 120, borderRadius: 8, backgroundColor: "var(--color-dimmed-bg)" }} />;
}

function ErrorNote({ message }: { message: string }) {
  return <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: 0 }}>Couldn&apos;t load the pulse: {message}</p>;
}

function Headline({ summary }: { summary: PulseSummary }) {
  const current = summary.current;
  const showsThisWeek = current && !current.suppressed && current.overall != null;
  return (
    <div style={{ marginBottom: 10 }}>
      {showsThisWeek ? (
        <p style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 28, fontWeight: 600, color: "var(--color-body)", fontVariantNumeric: "tabular-nums" }}>{current!.overall!.toFixed(1)}</span>
          <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>/ 5 this week · {current!.respondents} responses</span>
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-body)" }}>{PRIVACY_MESSAGE}.</p>
      )}
      <Change summary={summary} />
    </div>
  );
}

function Change({ summary }: { summary: PulseSummary }) {
  if (summary.change == null) return null;
  const { change, dropped } = summary;
  const text = `${change > 0 ? "+" : ""}${change.toFixed(1)} vs 4-week average`;
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

function SeriesBody({ series, label }: { series: PulseSeries | undefined; label: string }) {
  const summary = summarize(series);
  return (
    <>
      <Headline summary={summary} />
      {series && <PulseTrend weeks={series.weeks} label={label} />}
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

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map(({ dept, summary }) => {
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
                <AlertTriangle size={11} aria-hidden="true" /> {summary.change!.toFixed(1)} vs 4-wk avg
              </span>
            )}
            <span style={{ fontSize: visible ? 13 : 10, fontWeight: visible ? 600 : 400, color: visible ? "var(--color-body)" : "var(--color-secondary)", fontVariantNumeric: "tabular-nums", textAlign: "right", maxWidth: 150 }}>
              {visible ? current!.overall!.toFixed(1) : "Not enough responses"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ── Public cards ──────────────────────────────────────────────────────────────

/** President only: the executive board's average. */
export function ExecPulseCard({ projectId }: { projectId: string | null }) {
  const { loading, error, series } = usePulse("get_exec_pulse", projectId);
  return (
    <Card title="Exec Pulse" subtitle="How your VPs are doing — only you see this" icon={<Activity size={15} color="var(--color-navy)" aria-hidden="true" />}>
      {loading ? <Skeleton /> : error ? <ErrorNote message={error} /> : <SeriesBody series={series[0]} label="Exec Pulse" />}
    </Card>
  );
}

/** President: whole-LC member average plus a per-department breakdown. */
export function MemberPulseCard({ projectId, departments }: { projectId: string | null; departments: Department[] }) {
  const { loading, error, series } = usePulse("get_member_pulse", projectId);
  const total = series.find((s) => s.groupId === null);
  const flagged = departments.filter((d) => summarize(series.find((s) => s.groupId === d.id)).dropped).length;
  return (
    <Card
      title="Member Pulse"
      subtitle={flagged ? `${flagged} department${flagged === 1 ? "" : "s"} dropped noticeably this week` : "All members, by department"}
      icon={<HeartPulse size={15} color="var(--color-navy)" aria-hidden="true" />}
    >
      {loading ? <Skeleton /> : error ? <ErrorNote message={error} /> : (
        <>
          <SeriesBody series={total} label="Member Pulse, whole LC" />
          <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-secondary)", margin: "14px 0 6px" }}>
            By department · this week
          </h3>
          <DepartmentRows series={series} departments={departments} />
        </>
      )}
    </Card>
  );
}

/** VP: the departments they lead (RLS-limited server-side to exactly those). */
export function DepartmentPulseCard({ projectId, departments }: { projectId: string | null; departments: Department[] }) {
  const { loading, error, series } = usePulse("get_member_pulse", projectId);
  const led = departments.filter((d) => series.some((s) => s.groupId === d.id));
  const title = led.length > 1 ? "My Departments' Pulse" : "My Department's Pulse";
  return (
    <Card title={title} subtitle={led.length ? led.map((d) => d.name).join(" · ") : "Your members' weekly check-in"} icon={<HeartPulse size={15} color="var(--color-navy)" aria-hidden="true" />}>
      {loading ? <Skeleton /> : error ? <ErrorNote message={error} /> : led.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
          You don&apos;t lead a department yet. Your LCP can assign you one in Settings → Departments.
        </p>
      ) : led.length === 1 ? (
        <SeriesBody series={series.find((s) => s.groupId === led[0].id)} label={led[0].name} />
      ) : (
        <DepartmentRows series={series} departments={led} />
      )}
    </Card>
  );
}

/** Members (and VPs): a nudge to do this week's check-in. Shows no pulse data. */
export function CheckinNudgeCard({ projectId, userId }: { projectId: string | null; userId: string | null }) {
  const [done, setDone] = useState<boolean | null>(null);
  useEffect(() => {
    if (!projectId || !userId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const { count, error } = await supabase
        .from("journal_entries")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .not("checkin_scores", "is", null)
        .gte("created_at", currentWeekStart().toISOString());
      if (!cancelled) setDone(error ? false : (count ?? 0) > 0);
    })();
    return () => { cancelled = true; };
  }, [projectId, userId]);

  if (done !== false) return null;
  return (
    <Link
      href="/journal"
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", textDecoration: "none",
        backgroundColor: "var(--color-navy-dim)", border: "1px solid var(--color-border)", borderRadius: 10,
      }}
    >
      <HeartPulse size={18} color="var(--color-navy)" aria-hidden="true" />
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-navy)" }}>This week&apos;s check-in is waiting</span>
        <span style={{ display: "block", fontSize: 12, color: "var(--color-secondary)", marginTop: 2 }}>
          About a minute. Only averages are ever shared, never your answers.
        </span>
      </span>
      <ArrowRight size={16} color="var(--color-navy)" aria-hidden="true" />
    </Link>
  );
}
