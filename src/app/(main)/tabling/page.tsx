"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { useProject } from "@/context/ProjectContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { isExec } from "@/lib/permissions";
import { mapReportRow, mapSignup, mapSlot } from "@/lib/tabling";
import { useLcMembers } from "@/hooks/useLcMembers";
import type { TablingReportRow, TablingSignup, TablingSlot } from "@/types";
import { ErrorText, Tabs } from "@/components/lc/ui";
import { MyTablingView, TablingReport, WeekView } from "@/components/tabling/TablingViews";
import SlotModal from "@/components/tabling/SlotModal";
import MarkAttendanceModal from "@/components/tabling/MarkAttendanceModal";

type Tab = "week" | "mine" | "report";

export default function TablingPage() {
  const { projectId, userId, role, departments, departmentId, ledDepartmentIds, isLoading } = useProject();
  const exec = isExec(role);
  const president = role === "president";
  const { members: roster } = useLcMembers(projectId);

  const [tab, setTab] = useState<Tab>("week");
  const [slots, setSlots] = useState<TablingSlot[]>([]);
  const [signups, setSignups] = useState<TablingSignup[]>([]);
  const [report, setReport] = useState<TablingReportRow[]>([]);
  const [termStart, setTermStart] = useState(() => `${new Date().getFullYear()}-02-01`);
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const [creating, setCreating] = useState(false);
  const [marking, setMarking] = useState<TablingSlot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const enabled = Boolean(projectId) && isSupabaseConfigured;

  useEffect(() => {
    if (isLoading || !enabled || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const term = await supabase.rpc("lc_term_start", { p_project_id: projectId });
        if (term.error) throw new Error(term.error.message);
        const from = range.from || (term.data as string);
        // Slots from 8 weeks back (to mark and report on) onwards; RLS scopes the sign-ups.
        const since = new Date(Date.now() - 56 * 86_400_000).toISOString();
        const [sl, su, rep] = await Promise.all([
          supabase.from("tabling_slots").select("*").eq("project_id", projectId).gte("starts_at", since).order("starts_at"),
          supabase.from("tabling_signups").select("*").eq("project_id", projectId),
          supabase.rpc("tabling_report", { p_project_id: projectId, p_from: from, p_to: range.to || null }),
        ]);
        const failed = [sl, su, rep].find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
        if (cancelled) return;
        setTermStart(term.data as string);
        setSlots((sl.data ?? []).map(mapSlot));
        setSignups((su.data ?? []).map(mapSignup));
        setReport(((rep.data ?? []) as Record<string, unknown>[]).map(mapReportRow));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(`Couldn't load tabling: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, isLoading, enabled, version, range]);

  const mySignups = signups.filter((s) => s.userId === userId);
  const canManage = (s: TablingSlot) => president || (exec && s.createdBy === userId);
  const people = president
    ? roster
    : roster.filter((m) => m.id === userId || (m.departmentId && ledDepartmentIds.includes(m.departmentId)));
  const reportDepartments = president ? departments : departments.filter((d) => ledDepartmentIds.includes(d.id));
  const loading = isLoading || (enabled && !loaded);

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Tabling" subtitle="Sign up for shifts at the LC's stand, and see your hours.">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { id: "week", label: "Week" },
          { id: "mine", label: "My tabling" },
          ...(exec ? [{ id: "report" as const, label: "Report" }] : []),
        ]} />
      </PageHeader>

      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px)", maxWidth: 1400, width: "100%" }}>
        <ErrorText>{error}</ErrorText>
        {notice && <p role="status" style={{ fontSize: 12, color: "var(--color-success)", margin: "0 0 10px" }}>{notice}</p>}
        {loading ? (
          <div className="animate-pulse" style={{ height: 240, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
        ) : !enabled || !projectId || !userId ? (
          <NeedsDatabase what="Tabling">Recruitment shifts members sign up for, with reminders and attended hours.</NeedsDatabase>
        ) : tab === "week" ? (
          <WeekView
            slots={slots} mySignups={mySignups} canCreate={exec} canManage={canManage} departments={departments}
            onNew={() => setCreating(true)} onMark={(s) => setMarking(s)} onChanged={reload}
          />
        ) : tab === "mine" ? (
          <MyTablingView slots={slots} mySignups={mySignups} myReport={report.find((r) => r.userId === userId)} termStart={termStart} />
        ) : (
          <TablingReport
            rows={report} people={people} departments={reportDepartments}
            from={range.from || termStart} to={range.to}
            onRange={(from, to) => setRange({ from, to })}
          />
        )}
      </div>

      {creating && projectId && (
        <SlotModal
          projectId={projectId} departments={departments} defaultDepartmentId={ledDepartmentIds[0] ?? departmentId}
          onClose={() => setCreating(false)}
          onSaved={(count) => { setCreating(false); setNotice(count > 1 ? `Created ${count} weekly slots.` : "Slot created."); reload(); }}
        />
      )}
      {marking && (
        <MarkAttendanceModal
          slot={marking} roster={roster}
          signups={signups.filter((s) => s.slotId === marking.id)}
          onClose={() => setMarking(null)} onChanged={reload}
        />
      )}
    </div>
  );
}
