"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import { ErrorText } from "@/components/lc/ui";
import { APP_NAME } from "@/lib/brand";

/**
 * Which MC the LC belongs to. No codes: an LC joins its country's MC
 * automatically (by the LC's country, from EXPA or Settings).
 */
export default function McLinkSettings() {
  const { projectId } = useProject();
  const [mcName, setMcName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    let cancelled = false;
    supabase.rpc("lc_mc_name", { p_project_id: projectId }).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setError(err.message); else setMcName((data as string | null) ?? null);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: "0 0 12px" }}>
        Your MC sees how many exchanges were applied, approved, realized and completed per product this term, and how many members you have. They never see names, tasks or wellbeing data.
      </p>
      <p style={{ fontSize: 13, color: "var(--color-body)", margin: 0 }}>
        {mcName
          ? <>Part of <strong>{mcName}</strong>.</>
          : <>Your LC joins your country&apos;s MC automatically once the MC is on {APP_NAME} (its team signs in with EXPA). Check your LC&apos;s country is set.</>}
      </p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
