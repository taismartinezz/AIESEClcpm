"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import { localIsoDate } from "@/lib/pipeline";
import { STAGE_LABEL } from "@/lib/products";
import type { Exchange } from "@/types";

/**
 * One click on a stuck exchange: nudge its owner, make them a follow-up task,
 * or (when nobody owns it) take it yourself, so every alert lands on a person.
 */
export default function StuckActions({ exchange: e, days, ownerName, onChanged }: {
  exchange: Exchange; days: number; ownerName: string | null; onChanged?: () => void;
}) {
  const { projectId, userId } = useProject();
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = ownerName?.split(" ")[0] ?? null;
  const taskPrefix = `Follow up: ${e.personName} (`;
  // An open follow-up task already exists (made earlier, maybe by someone else): don't offer another.
  const [openTask, setOpenTask] = useState(false);
  useEffect(() => {
    if (!isSupabaseConfigured || !projectId) return;
    let cancelled = false;
    supabase.from("tasks").select("id").eq("project_id", projectId).neq("status", "done").eq("archived", false)
      .like("title", `${taskPrefix.replace(/[%_]/g, "\\$&")}%`).limit(1)
      .then(({ data }) => { if (!cancelled) setOpenTask((data ?? []).length > 0); });
    return () => { cancelled = true; };
  }, [projectId, taskPrefix]);
  const what = `${e.personName} has been ${STAGE_LABEL[e.stage].toLowerCase()} for ${days} days`;

  async function run(label: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    if (!isSupabaseConfigured || !projectId || !userId) return;
    setBusy(true); setError(null);
    const { error: err } = await fn();
    setBusy(false);
    if (err) setError(err.message); else { setDone(label); onChanged?.(); }
  }

  const nudge = () => run(`Nudged ${first}`, () => supabase.from("notifications").insert({
    user_id: e.ownerId, type: "exchange_stuck", title: what, body: "Can you follow up and move it on (or close it)?",
    related_id: e.id, link_to: "/pipeline", read: false,
  }));

  const followUp = () => run("Follow-up task added", async () => {
    const due = new Date(); due.setDate(due.getDate() + 2);
    const { data, error: err } = await supabase.from("tasks").insert({
      project_id: projectId, created_by: userId, title: `Follow up: ${e.personName} (${STAGE_LABEL[e.stage].toLowerCase()} ${days} days)`,
      description: `${what}. Open the pipeline to update the stage.`, status: "todo", priority: "high",
      due_date: localIsoDate(due), archived: false, scope: "lab", department_id: e.departmentId ?? null,
    }).select("id").single();
    if (err || !data) return { error: err ?? { message: "no task returned" } };
    return supabase.from("task_assignees").insert({ task_id: data.id, user_id: e.ownerId ?? userId });
  });

  const takeIt = () => run("It's yours now", () => supabase.from("exchanges").update({ owner_id: userId }).eq("id", e.id));

  const btn = { background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--color-navy)", textDecoration: "underline" } as const;
  if (done) return <span role="status" style={{ fontSize: 11, color: "var(--color-success, #00A86B)", fontWeight: 600 }}>{done} ✓</span>;
  return (
    <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {e.ownerId && e.ownerId !== userId && <button type="button" disabled={busy} onClick={nudge} style={btn}>Nudge {first ?? "the owner"}</button>}
      {!e.ownerId && <button type="button" disabled={busy} onClick={takeIt} style={btn}>No owner: take it</button>}
      {openTask
        ? <span style={{ fontSize: 11, color: "var(--color-secondary)" }}>Follow-up task open</span>
        : <button type="button" disabled={busy} onClick={followUp} style={btn}>Make a follow-up task</button>}
      {error && <span role="alert" style={{ fontSize: 11, color: "var(--color-error)" }}>{error}</span>}
    </span>
  );
}
