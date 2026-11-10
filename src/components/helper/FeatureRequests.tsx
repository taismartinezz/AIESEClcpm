"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { formatDay } from "@/lib/dates";
import { guideEntry } from "@/lib/appGuide";
import { ErrorText, Panel, selectStyle } from "@/components/lc/ui";

interface Request { id: string; question: string; role: string | null; page: string | null; closest: string[]; status: Status; created_at: string; created_by: string | null }
type Status = "new" | "planned" | "done" | "declined";
const STATUS_LABEL: Record<Status, string> = { new: "Reported", planned: "Planned", done: "Done", declined: "Not planned" };

/**
 * What the helper couldn't find. Everyone sees their own requests and where
 * they stand; app moderators see everyone's and set the status.
 */
/** `showEmpty`: show "Your requests" even before you've asked anything (Help does, so people know where to look). */
export default function FeatureRequests({ showEmpty = false }: { showEmpty?: boolean } = {}) {
  const [rows, setRows] = useState<Request[] | null>(null);
  const [moderator, setModerator] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<Status | "all">("new");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const [{ data: { session } }, mod, list] = await Promise.all([
        supabase.auth.getSession(),
        supabase.rpc("is_app_moderator"),
        supabase.from("feature_requests").select("*").order("created_at", { ascending: false }).limit(300),
      ]);
      if (cancelled) return;
      if (list.error) { setRows([]); if (list.error.code !== "42P01") setError(list.error.message); return; }   // before the migration: nothing to show
      setMe(session?.user?.id ?? null);
      setModerator(mod.data === true);
      setRows((list.data ?? []) as Request[]);
    })();
    return () => { cancelled = true; };
  }, [version]);

  async function setStatus(id: string, status: Status) {
    setError(null);
    const { error: err } = await supabase.rpc("set_feature_request_status", { p_id: id, p_status: status });
    if (err) setError(`Couldn't change the status: ${err.message}`); else setVersion((v) => v + 1);
  }

  if (!rows || (rows.length === 0 && !moderator && !showEmpty)) return null;
  const mine = rows.filter((r) => r.created_by === me);
  const shown = moderator ? rows.filter((r) => filter === "all" || r.status === filter) : mine;
  const counts = Object.fromEntries((["new", "planned", "done", "declined"] as Status[]).map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<Status, number>;
  const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", borderTop: "1px solid var(--color-border)", verticalAlign: "top" };
  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--color-secondary)", padding: "8px 10px" };

  return (
    <Panel
      title={moderator ? `Feature requests (${counts.new} new)` : "Your requests"}
      action={moderator ? (
        <select aria-label="Show requests" value={filter} onChange={(e) => setFilter(e.target.value as Status | "all")} style={{ ...selectStyle, width: "auto", height: 30 }}>
          <option value="new">New ({counts.new})</option>
          <option value="planned">Planned ({counts.planned})</option>
          <option value="done">Done ({counts.done})</option>
          <option value="declined">Not planned ({counts.declined})</option>
          <option value="all">All ({rows.length})</option>
        </select>
      ) : undefined}
    >
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0, padding: "10px 14px 0" }}>
        {moderator
          ? "Questions the helper couldn't answer, reported automatically. You see them because you're an app moderator."
          : "Things you asked the helper for that the app doesn't do yet. The moderators update these as they plan them."}
      </p>
      <ErrorText>{error}</ErrorText>
      {shown.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: 14, margin: 0 }}>{moderator ? "Nothing here." : "Nothing yet. When Ask can't find something, your question shows up here."}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th scope="col" style={th}>Asked</th>
              <th scope="col" style={th}>Question</th>
              {moderator && <th scope="col" style={th}>From</th>}
              {moderator && <th scope="col" style={th}>Closest in the app</th>}
              <th scope="col" style={th}>Status</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "var(--color-secondary)" }}>{formatDay(r.created_at.slice(0, 10))}</td>
                  <td style={{ ...td, minWidth: 220 }}>{r.question}</td>
                  {moderator && <td style={{ ...td, fontSize: 12, color: "var(--color-secondary)" }}>{r.role ?? "–"}{r.page ? ` · ${r.page}` : ""}</td>}
                  {moderator && <td style={{ ...td, fontSize: 12, color: "var(--color-secondary)" }}>{r.closest.map((id) => guideEntry(id)?.title ?? id).join(", ") || "–"}</td>}
                  <td style={td}>
                    {moderator ? (
                      <select aria-label={`Status of "${r.question}"`} value={r.status} onChange={(e) => setStatus(r.id, e.target.value as Status)} style={{ ...selectStyle, width: "auto", height: 30 }}>
                        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    ) : STATUS_LABEL[r.status]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
