"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ShieldCheck, BookOpen } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import CheckinQuestion from "@/components/wellbeing/CheckinQuestion";
import { Button, ErrorText, Panel } from "@/components/lc/ui";
import { useProject } from "@/context/ProjectContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  DEFAULT_CADENCE, activeQuestions, audienceCopy, cadenceLabel, periodEnd, periodStart,
  questionText, thisPeriod, type CheckinCadence,
} from "@/lib/wellbeing";
import type { CheckinResponse } from "@/types";

interface PastCheckin { periodStart: string; average: number }

const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The check-in: a handful of 1–5 questions every one or two weeks (per LC).
 * One answer per person per period, editable until the period ends. Only
 * aggregates ever leave this page (see get_member_pulse / get_exec_pulse).
 */
export default function CheckinPage() {
  const { projectId, userId, role, isLoading } = useProject();
  const [cadence, setCadence] = useState<CheckinCadence>(DEFAULT_CADENCE);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [answers, setAnswers] = useState<CheckinResponse[]>([]);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<PastCheckin[]>([]);
  const [optedIn, setOptedIn] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingOptIn, setSavingOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const enabled = Boolean(projectId && userId) && isSupabaseConfigured;

  const questions = useMemo(() => activeQuestions(disabled), [disabled]);
  const start = periodStart(cadence);
  const end = periodEnd(cadence, start);
  const startIso = start.toISOString().slice(0, 10);

  useEffect(() => {
    if (isLoading || !enabled || !projectId || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const [proj, mine, settings] = await Promise.all([
          supabase.from("projects").select("checkin_period_weeks, checkin_disabled_questions").eq("id", projectId).maybeSingle(),
          supabase.from("checkins").select("period_start, scores, updated_at").eq("project_id", projectId).eq("user_id", userId)
            .order("period_start", { ascending: false }).limit(9),
          supabase.from("user_settings").select("wellbeing_opted_in").eq("user_id", userId).maybeSingle(),
        ]);
        const failed = [proj, mine, settings].find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
        if (cancelled) return;
        const weeks: CheckinCadence = proj.data?.checkin_period_weeks === 1 ? 1 : 2;
        const current = periodStart(weeks).toISOString().slice(0, 10);
        setCadence(weeks);
        setDisabled((proj.data?.checkin_disabled_questions as string[] | null) ?? []);
        setOptedIn(settings.data?.wellbeing_opted_in !== false);
        const rows = (mine.data ?? []) as { period_start: string; scores: CheckinResponse[]; updated_at: string }[];
        const now = rows.find((r) => r.period_start === current);
        if (now) { setAnswers(now.scores); setSubmittedAt(now.updated_at); }
        setHistory(rows.filter((r) => r.period_start !== current).map((r) => ({
          periodStart: r.period_start,
          average: r.scores.reduce((a, x) => a + x.score, 0) / Math.max(1, r.scores.length),
        })));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(`Couldn't load your check-in: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, userId, isLoading, enabled]);

  const answered = answers.filter((a) => questions.some((q) => q.id === a.questionId));
  const complete = answered.length === questions.length && questions.length > 0;

  function setScore(questionId: string, score: CheckinResponse["score"]) {
    setNotice(null);
    setAnswers((prev) => [...prev.filter((a) => a.questionId !== questionId), { questionId, score }]);
  }

  async function submit() {
    if (!complete) { setError("Answer every question to submit."); return; }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (!enabled || !projectId || !userId) {
        setNotice("Demo mode: answers aren't saved.");
        return;
      }
      // One row per person per period; the database pins it to the current period.
      const { data, error: err } = await supabase
        .from("checkins")
        .upsert({ user_id: userId, project_id: projectId, period_start: startIso, scores: answered }, { onConflict: "user_id,project_id,period_start" })
        .select("updated_at")
        .single();
      if (err) throw new Error(err.message);
      setSubmittedAt((data?.updated_at as string) ?? new Date().toISOString());
      setNotice(submittedAt ? "Your answers were updated." : "Thanks, your check-in is in.");
    } catch (e) {
      setError(`Couldn't save your check-in: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleOptIn(next: boolean) {
    const previous = optedIn;
    setOptedIn(next);
    setError(null);
    setSavingOptIn(true);
    try {
      if (!enabled || !userId) return;
      const { error: err } = await supabase.from("user_settings").upsert(
        { user_id: userId, wellbeing_opted_in: next, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      if (err) throw new Error(err.message);
    } catch (e) {
      setOptedIn(previous);
      setError(`Couldn't save your choice: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingOptIn(false);
    }
  }

  const loading = isLoading || (enabled && !loaded);

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Check-in" subtitle={`${fmt(start)} – ${fmt(end)} · ${cadenceLabel(cadence)} · about a minute`} />

      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px) 80px" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--color-body)", lineHeight: 1.5, margin: 0, padding: "10px 14px", borderRadius: 8, backgroundColor: "var(--color-navy-dim)" }}>
            <ShieldCheck size={16} color="var(--color-navy)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            {audienceCopy(role)}
          </p>

          {submittedAt && (
            <p role="status" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-success)", margin: 0 }}>
              <CheckCircle2 size={16} aria-hidden="true" />
              Done for {thisPeriod(cadence)}. You can change your answers until {fmt(end)}.
            </p>
          )}

          {loading ? (
            <div className="animate-pulse" style={{ height: 320, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {questions.map((q) => (
                  <CheckinQuestion
                    key={q.id}
                    question={{ id: q.id, text: questionText(q, role) }}
                    response={answers.find((a) => a.questionId === q.id)}
                    onScore={(score) => setScore(q.id, score)}
                  />
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <Button onClick={submit} disabled={!complete || saving}>
                  {saving ? "Saving…" : submittedAt ? "Update my answers" : "Submit check-in"}
                </Button>
                <span style={{ fontSize: 12, color: "var(--color-secondary)" }}>{answered.length} / {questions.length} answered</span>
                {notice && <span role="status" style={{ fontSize: 12, color: "var(--color-success)" }}>{notice}</span>}
              </div>
              <ErrorText>{error}</ErrorText>

              {role !== "president" && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--color-secondary)", lineHeight: 1.45, cursor: "pointer" }}>
                  <input type="checkbox" checked={optedIn} disabled={savingOptIn} onChange={(e) => toggleOptIn(e.target.checked)} style={{ marginTop: 2, accentColor: "var(--color-navy)" }} />
                  <span>Count my answers in the anonymous averages. Turn this off and your check-in stays just for you.</span>
                </label>
              )}

              {history.length > 0 && (
                <Panel title="Your previous check-ins (only you see this)">
                  <ul style={{ listStyle: "none", margin: 0, padding: "4px 0" }}>
                    {history.map((h) => (
                      <li key={h.periodStart} style={{ display: "flex", justifyContent: "space-between", padding: "6px 14px", fontSize: 13 }}>
                        <span style={{ color: "var(--color-secondary)" }}>From {fmt(new Date(h.periodStart + "T00:00:00Z"))}</span>
                        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{h.average.toFixed(1)} / 5</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
                Want to write things down? The <Link href="/journal" style={{ color: "var(--color-navy)" }}><BookOpen size={11} aria-hidden="true" style={{ verticalAlign: "-1px" }} /> Journal</Link> is a private diary only you can read.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
