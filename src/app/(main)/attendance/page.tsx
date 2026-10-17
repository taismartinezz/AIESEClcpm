"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { useProject } from "@/context/ProjectContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { isExec } from "@/lib/permissions";
import { mapAttendance, mapEvent } from "@/lib/attendance";
import { useLcMembers } from "@/hooks/useLcMembers";
import type { AttendanceRecord, LcEvent } from "@/types";
import { Button, ErrorText, Tabs } from "@/components/lc/ui";
import { AttendanceTable, ByMemberView, EventsView, type Rsvp } from "@/components/attendance/AttendanceViews";
import AnnouncementModal from "@/components/attendance/AnnouncementModal";
import EventModal from "@/components/attendance/EventModal";
import AttendeePicker from "@/components/attendance/AttendeePicker";

type Tab = "events" | "member" | "table";

export default function AttendancePage() {
  const { projectId, userId, role, departments, ledDepartmentIds, isLoading } = useProject();
  const exec = isExec(role);
  const president = role === "president";
  const { members: roster } = useLcMembers(projectId);

  const [tabChoice, setTab] = useState<Tab | null>(null);
  const tab: Tab = tabChoice ?? (exec ? "events" : "member");
  const [events, setEvents] = useState<LcEvent[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [termStart, setTermStart] = useState(() => `${new Date().getFullYear()}-02-01`);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const [editing, setEditing] = useState<LcEvent | "new" | null>(null);
  const [logging, setLogging] = useState<LcEvent | null>(null);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [announcing, setAnnouncing] = useState(false);
  const enabled = Boolean(projectId) && isSupabaseConfigured;

  useEffect(() => {
    if (isLoading || !enabled || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        // RLS limits attendance rows to what this role may see.
        const [ev, att, term, rs] = await Promise.all([
          supabase.from("lc_events").select("*").eq("project_id", projectId).order("starts_on", { ascending: false }),
          supabase.from("event_attendance").select("*").eq("project_id", projectId),
          supabase.rpc("lc_term_start", { p_project_id: projectId }),
          supabase.from("event_rsvps").select("event_id, user_id, response").eq("project_id", projectId),
        ]);
        const failed = [ev, att, term, rs].find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
        if (cancelled) return;
        setEvents((ev.data ?? []).map(mapEvent));
        setRecords((att.data ?? []).map(mapAttendance));
        setRsvps((rs.data ?? []).map((r) => ({ eventId: r.event_id as string, userId: r.user_id as string, response: r.response as Rsvp["response"] })));
        if (term.data) setTermStart(term.data as string);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(`Couldn't load attendance: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, isLoading, enabled, version]);

  // Whose attendance this person may look at (the database enforces the same rule).
  const people = president
    ? roster
    : role === "vp"
      ? roster.filter((m) => m.id === userId || (m.departmentId && ledDepartmentIds.includes(m.departmentId)))
      : roster.filter((m) => m.id === userId);
  const tableDepartments = president ? departments : departments.filter((d) => ledDepartmentIds.includes(d.id));
  const loading = isLoading || (enabled && !loaded);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Events"
        subtitle={exec ? "Events with invites, RSVPs and reminders, and who attended." : "LC events: say if you're going, and see your attendance."}
        action={exec && enabled ? <Button variant="secondary" onClick={() => setAnnouncing(true)}><Megaphone size={14} aria-hidden="true" /> Announcement</Button> : undefined}
      >
        <Tabs<Tab> value={tab} onChange={setTab} tabs={exec
          ? [{ id: "events", label: "By event" }, { id: "member", label: "By member" }, { id: "table", label: "Table" }]
          : [{ id: "member", label: "My attendance" }, { id: "events", label: "Events" }]}
        />
      </PageHeader>

      <div className="flex-1 overflow-auto" style={{ padding: "20px clamp(16px, 3vw, 28px)", maxWidth: 1200, width: "100%" }}>
        <ErrorText>{error}</ErrorText>
        {loading ? (
          <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
        ) : !enabled || !projectId || !userId ? (
          <NeedsDatabase what="Events">LC events and who came, so Talent Management can spot who&apos;s drifting away.</NeedsDatabase>
        ) : tab === "events" ? (
          <EventsView
            events={events} records={records} rsvps={rsvps} userId={userId} roster={roster} departments={departments} canManage={exec}
            onNew={() => setEditing("new")} onEdit={(e) => setEditing(e)} onLog={(e) => setLogging(e)} onChanged={reload}
          />
        ) : tab === "table" && exec ? (
          <AttendanceTable events={events} records={records} people={people} departments={tableDepartments} />
        ) : (
          <ByMemberView events={events} records={records} people={people} termStart={termStart} initialUserId={userId} />
        )}
      </div>

      {editing && projectId && userId && (
        <EventModal
          projectId={projectId} userId={userId} departments={departments} roster={roster}
          event={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {announcing && projectId && userId && (
        <AnnouncementModal projectId={projectId} userId={userId} departments={departments} ledDepartmentIds={ledDepartmentIds}
          isPresident={president} onClose={() => setAnnouncing(false)} />
      )}
      {logging && userId && (
        <AttendeePicker
          event={logging} userId={userId} roster={roster} departments={departments}
          current={records.filter((r) => r.eventId === logging.id).map((r) => r.userId)}
          onClose={() => setLogging(null)} onSaved={() => { setLogging(null); reload(); }}
        />
      )}
    </div>
  );
}
