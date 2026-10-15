"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { SubProject } from "@/types";

// ── Context shape ─────────────────────────────────────────────────────────────

export type ActiveScope = "lab" | "project" | "personal";

interface ProjectContextValue {
  /** Lab-level projects.id - null until auth resolves */
  projectId: string | null;
  /** Currently active sub-project filter - null means lab or personal */
  subProjectId: string | null;
  /** All sub-projects the current user belongs to (excludes archived) */
  subProjects: SubProject[];
  /** Active scope: lab | project (sub-project selected) | personal */
  activeScope: ActiveScope;
  /** Switch the active sub-project; pass null to clear sub-project */
  setActiveSubProject: (id: string | null) => void;
  /** Set the active scope independently (lab / project / personal) */
  setActiveScope: (scope: ActiveScope) => void;
  /** Optimistically add a newly created sub-project to the list */
  addSubProject: (sp: SubProject) => void;
  isLoading: boolean;
}

const ProjectContext = createContext<ProjectContextValue>({
  projectId: null,
  subProjectId: null,
  subProjects: [],
  activeScope: "lab",
  setActiveSubProject: () => {},
  setActiveScope: () => {},
  addSubProject: () => {},
  isLoading: true,
});

// ── Storage keys ──────────────────────────────────────────────────────────────

const STORAGE_KEY       = "canopy_active_sub_project";
const SCOPE_STORAGE_KEY = "canopy_scope_mode";

// ── Provider ──────────────────────────────────────────────────────────────────

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projectId, setProjectId]         = useState<string | null>(null);
  const [subProjectId, setSubProjectId]   = useState<string | null>(null);
  const [subProjects, setSubProjects]     = useState<SubProject[]>([]);
  const [activeScopeState, setActiveScopeState] = useState<ActiveScope>("lab");
  const [isLoading, setIsLoading]         = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) { setIsLoading(false); return; }

        // ── 1. Lab-level project_id - try team_members first, then user_profiles ─
        const { data: membership } = await supabase
          .from("team_members")
          .select("project_id")
          .eq("user_id", userId)
          .maybeSingle();

        let pid = (membership?.project_id as string) ?? null;

        if (!pid) {
          // Fallback: user may be in user_profiles but not yet in team_members
          const { data: prof } = await supabase
            .from("user_profiles")
            .select("project_id")
            .eq("id", userId)
            .maybeSingle();
          pid = (prof?.project_id as string) ?? null;
        }

        if (!pid) { setIsLoading(false); return; }
        setProjectId(pid);

        // ── 2. Sub-projects this user is a member of ───────────────────────
        const { data: memberRows, error: memberError } = await supabase
          .from("sub_project_members")
          .select(
            "sub_project_id, sub_projects(id, project_id, name, description, created_by, created_at, archived, color)"
          )
          .eq("user_id", userId);

        if (memberError) {
          console.error("[ProjectContext] sub_project_members error:", memberError);
          setIsLoading(false);
          return;
        }

        if (memberRows) {
          const seen = new Set<string>();
          const sps: SubProject[] = memberRows
            .map((row) => {
              const raw = row.sub_projects;
              // Supabase returns a single object (FK → PK join), not an array
              const sp = Array.isArray(raw) ? raw[0] : (raw as Record<string, unknown> | null);
              if (!sp) return null;
              return {
                id:          sp.id          as string,
                projectId:   sp.project_id  as string,
                name:        sp.name        as string,
                description: (sp.description as string | undefined) ?? undefined,
                createdBy:   (sp.created_by  as string | undefined) ?? undefined,
                createdAt:   sp.created_at  as string,
                archived:    (sp.archived   as boolean) ?? false,
                color:       (sp.color as string | null) ?? undefined,
              } as SubProject;
            })
            .filter((sp): sp is SubProject => {
              if (sp === null || sp.archived) return false;
              if (seen.has(sp.id)) return false;
              seen.add(sp.id);
              return true;
            });

          setSubProjects(sps);

          // Restore persisted selection - validate it's still a valid sub-project
          let stored: string | null = null;
          let storedScope: ActiveScope = "lab";
          try {
            stored      = localStorage.getItem(STORAGE_KEY);
            storedScope = (localStorage.getItem(SCOPE_STORAGE_KEY) ?? "lab") as ActiveScope;
          } catch { /* storage blocked (private mode, quota exceeded) — use defaults */ }

          if (storedScope === "personal") {
            setActiveScopeState("personal");
          } else if (stored && sps.some((sp) => sp.id === stored)) {
            setSubProjectId(stored);
            setActiveScopeState("project");
          } else {
            setActiveScopeState("lab");
          }
        }
      } catch (err) {
        console.error("[ProjectContext] load error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, []);

  const setActiveSubProject = useCallback((id: string | null) => {
    setSubProjectId(id);
    try {
      if (id === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, id);
    } catch { /* ignore */ }
  }, []);

  const setActiveScope = useCallback((scope: ActiveScope) => {
    setActiveScopeState(scope);
    try { localStorage.setItem(SCOPE_STORAGE_KEY, scope); } catch { /* ignore */ }
  }, []);

  const addSubProject = useCallback((sp: SubProject) => {
    setSubProjects((prev) => [...prev, sp]);
  }, []);

  return (
    <ProjectContext.Provider
      value={{ projectId, subProjectId, subProjects, activeScope: activeScopeState, setActiveSubProject, setActiveScope, addSubProject, isLoading }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useProject(): ProjectContextValue {
  return useContext(ProjectContext);
}
