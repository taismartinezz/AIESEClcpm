"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import { Button, ErrorText, inputStyle } from "@/components/lc/ui";
import { askConfirm } from "@/components/ui/confirm";

/** President: link the LC to its MC so the national team sees its numbers (counts only). */
export default function McLinkSettings() {
  const { projectId } = useProject();
  const [mcName, setMcName] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    let cancelled = false;
    supabase.rpc("lc_mc_name", { p_project_id: projectId }).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setError(err.message); else setMcName((data as string | null) ?? null);
    });
    return () => { cancelled = true; };
  }, [projectId, version]);

  async function link(value: string | null) {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc("link_lc_to_mc", { p_project_id: projectId, p_lc_code: value });
      if (err) throw new Error(err.message);
      setCode("");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(`Couldn't update: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 12px" }}>
        When your LC is linked, your MC sees how many exchanges were applied, approved, realized and completed per product this term, and how many members you have. They never see names, tasks or wellbeing data.
      </p>
      {mcName ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--color-body)" }}>
          <span style={{ flex: 1 }}>Linked to <strong>{mcName}</strong></span>
          <Button variant="secondary" disabled={busy} onClick={() => { void askConfirm(`Stop sharing numbers with ${mcName}?`, { confirmLabel: "Unlink" }).then((ok) => { if (ok) link(null); }); }}>Unlink</Button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <input aria-label="MC's LC code" placeholder="LC code from your MC" value={code} onChange={(e) => setCode(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          <Button onClick={() => link(code)} disabled={busy || !code.trim()}>Link</Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
