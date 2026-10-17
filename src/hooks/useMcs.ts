"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface Mc { id: string; name: string; memberCode: string; lcCode: string; termStart: string | null; isMcp: boolean }

/** The MCs (national teams) the signed-in person belongs to. */
export function useMcs(version = 0) {
  const [state, setState] = useState<{ mcs: Mc[]; loaded: boolean; error: string | null }>({ mcs: [], loaded: !isSupabaseConfigured, error: null });
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) { if (!cancelled) setState({ mcs: [], loaded: true, error: null }); return; }
        const [mcs, mine] = await Promise.all([
          supabase.from("mcs").select("id, name, member_code, lc_code, term_start").order("name"),
          supabase.from("mc_members").select("mc_id, role").eq("user_id", uid),
        ]);
        if (mcs.error) throw new Error(mcs.error.message);
        if (mine.error) throw new Error(mine.error.message);
        const roles = new Map((mine.data ?? []).map((r) => [r.mc_id as string, r.role as string]));
        if (!cancelled) setState({
          loaded: true, error: null,
          mcs: (mcs.data ?? []).map((m) => ({ id: m.id as string, name: m.name as string, memberCode: m.member_code as string, lcCode: m.lc_code as string, termStart: (m.term_start as string | null) ?? null, isMcp: roles.get(m.id as string) === "mcp" })),
        });
      } catch (e) {
        if (!cancelled) setState({ mcs: [], loaded: true, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [version]);
  return state;
}
