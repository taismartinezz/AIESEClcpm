"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { toUserRole } from "@/lib/permissions";
import type { UserRole } from "@/types";

export interface LcMember {
  id: string;
  name: string;
  role: UserRole;
  departmentId: string | null;
}

/** The active LC's roster (as far as RLS lets the caller see it). */
export function useLcMembers(projectId: string | null) {
  const [members, setMembers] = useState<LcMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  const enabled = Boolean(projectId) && isSupabaseConfigured;
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await supabase
          .from("team_members")
          .select("user_id, role, department_id, user_profiles(name)")
          .eq("project_id", projectId);
        if (err) throw new Error(err.message);
        if (cancelled) return;
        setMembers((data ?? []).map((row) => {
          const p = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
          return {
            id: row.user_id as string,
            name: (p as { name?: string } | null)?.name ?? "Unknown",
            role: toUserRole(row.role),
            departmentId: (row.department_id as string | null) ?? null,
          };
        }).sort((a, b) => a.name.localeCompare(b.name)));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, enabled, version]);
  const loading = enabled && !loaded;

  const names = Object.fromEntries(members.map((m) => [m.id, m.name]));
  return { members, names, loading, error, reload };
}
