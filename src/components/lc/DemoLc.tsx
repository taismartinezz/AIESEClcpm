"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { supabase, isSupabaseConfigured, isPreview } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import { Button } from "@/components/lc/ui";
import { askConfirm } from "@/components/ui/confirm";

/** Creates a private LC full of sample data and switches to it. */
export function DemoLcButton({ onDone, variant = "menu" }: { onDone?: () => void; variant?: "menu" | "button" }) {
  const { setActiveLc } = useProject();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isSupabaseConfigured || isPreview) return null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc("create_demo_lc");
      if (err) throw new Error(err.message);
      onDone?.();
      setActiveLc(data as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      {variant === "button" ? (
        <Button variant="secondary" onClick={create} disabled={busy}><Sparkles size={14} aria-hidden="true" /> {busy ? "Creating…" : "Explore a demo LC"}</Button>
      ) : (
        <button type="button" onClick={create} disabled={busy}
          className="flex items-center gap-2.5 w-full text-left transition-colors hover:bg-[var(--color-navy-dim)]"
          style={{ padding: "7px 14px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--font-roboto)", color: "var(--color-secondary)" }}>
          <Sparkles size={13} aria-hidden="true" />
          <span style={{ fontSize: 13 }}>{busy ? "Creating demo LC…" : "Explore a demo LC"}</span>
        </button>
      )}
      {error && <p role="alert" style={{ fontSize: 12, color: "var(--color-error)", margin: "4px 14px" }}>Couldn&apos;t create the demo: {error}</p>}
    </>
  );
}

/** Shown in a demo LC: explains it and offers to delete it. */
export function DemoBanner() {
  const { projectId, lcs, setActiveLc } = useProject();
  const [isDemo, setIsDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    let cancelled = false;
    supabase.from("projects").select("is_demo").eq("id", projectId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setIsDemo(Boolean(data?.is_demo)); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (isPreview) {
    return (
      <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, backgroundColor: "var(--color-navy-dim)", fontSize: 13, color: "var(--color-body)" }}>
        <Sparkles size={15} color="var(--color-navy)" aria-hidden="true" />
        <span>This is a <strong>preview with sample data</strong>: click around and change anything. Nothing is saved; reloading the page starts over.</span>
      </div>
    );
  }
  if (!isDemo || !projectId) return null;

  async function remove() {
    if (!(await askConfirm("Delete this demo LC and all its sample data?"))) return;
    setError(null);
    try {
      const { error: err } = await supabase.rpc("delete_demo_lc", { p_project_id: projectId });
      if (err) throw new Error(err.message);
      const next = lcs.find((l) => l.id !== projectId);
      if (next) setActiveLc(next.id); else window.location.assign("/onboarding");
    } catch (e) {
      setError(`Couldn't delete it: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", borderRadius: 10, backgroundColor: "var(--color-navy-dim)", fontSize: 13, color: "var(--color-body)" }}>
      <Sparkles size={15} color="var(--color-navy)" aria-hidden="true" />
      <span style={{ flex: 1, minWidth: 200 }}>This is a <strong>demo LC</strong> with made-up data. Click around, change anything; only you can see it.</span>
      <Button variant="secondary" onClick={remove}>Delete demo LC</Button>
      {error && <span role="alert" style={{ color: "var(--color-error)", fontSize: 12 }}>{error}</span>}
    </div>
  );
}
