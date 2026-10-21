"use client";

import { useRouter } from "next/navigation";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { ledDepartmentIds, toUserRole } from "@/lib/permissions";
import type { Department, SubProject, UserRole } from "@/types";

// ── Context shape ─────────────────────────────────────────────────────────────

export type ActiveScope = "lab" | "project" | "personal";

/** One Local Committee the signed-in user belongs to. */
export interface LcMembership {
  id: string;            // projects.id
  name: string;
  role: UserRole;        // the user's permission level in THIS LC
  departmentId: string | null;
}

interface ProjectContextValue {
  /** Signed-in user's id: null until auth resolves */
  userId: string | null;
  /** Every LC the user belongs to */
  lcs: LcMembership[];
  /** Active LC (projects.id): null until auth resolves */
  projectId: string | null;
  /** The user's role in the active LC */
  role: UserRole | null;
  /** The user's own department in the active LC */
  departmentId: string | null;
  /** Departments of the active LC */
  departments: Department[];
  /** Departments the user leads as VP in the active LC */
  ledDepartmentIds: string[];
  /** Switch the active LC (reloads the app so every page refetches) */
  setActiveLc: (id: string) => void;
  /** Re-read departments after the president edits them */
  refreshDepartments: () => Promise<void>;
  /** Currently active group filter - null means whole LC or personal */
  subProjectId: string | null;
  /** Groups the current user belongs to in the active LC (excludes archived) */
  subProjects: SubProject[];
  /** Active scope: lab (whole LC) | project (a group is selected) | personal */
  activeScope: ActiveScope;
  /** Switch the active group; pass null to clear it */
  setActiveSubProject: (id: string | null) => void;
  /** Set the active scope independently (lc / group / personal) */
  setActiveScope: (scope: ActiveScope) => void;
  /** Optimistically add a newly created group to the list */
  addSubProject: (sp: SubProject) => void;
  isLoading: boolean;
}

const ProjectContext = createContext<ProjectContextValue>({
  userId: null,
  lcs: [],
  projectId: null,
  role: null,
  departmentId: null,
  departments: [],
  ledDepartmentIds: [],
  setActiveLc: () => {},
  refreshDepartments: async () => {},
  subProjectId: null,
  subProjects: [],
  activeScope: "lab",
  setActiveSubProject: () => {},
  setActiveScope: () => {},
  addSubProject: () => {},
  isLoading: true,
});

// ── Storage keys ──────────────────────────────────────────────────────────────

export const ACTIVE_LC_STORAGE_KEY = "aiesec_active_lc";
const STORAGE_KEY       = "aiesec_active_group";
const SCOPE_STORAGE_KEY = "aiesec_scope_mode";

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function mapDepartment(row: Record<string, unknown>): Department {
  return {
    id:         row.id as string,
    projectId:  row.project_id as string,
    name:       row.name as string,
    color:      (row.color as string) ?? "#037EF3",
    vpUserId:   (row.vp_user_id as string | null) ?? null,
    isFinance:  (row.is_finance as boolean) ?? false,
    sortOrder:  (row.sort_order as number) ?? 0,
    products:   (row.products as string[] | null) ?? [],
    pulseArea:  (row.pulse_area as Department["pulseArea"]) ?? null,
  };
}

// ── Provider ──────────────────────────────────────────────────────────────────

function ProjectProviderState({ children, onSwitch }: { children: React.ReactNode; onSwitch: () => void }) {
  const [userId, setUserId]               = useState<string | null>(null);
  const [lcs, setLcs]                     = useState<LcMembership[]>([]);
  const [projectId, setProjectId]         = useState<string | null>(null);
  const [departments, setDepartments]     = useState<Department[]>([]);
  const [subProjectId, setSubProjectId]   = useState<string | null>(null);
  const [subProjects, setSubProjects]     = useState<SubProject[]>([]);
  const [activeScopeState, setActiveScopeState] = useState<ActiveScope>("lab");
  const [isLoading, setIsLoading]         = useState(true);

  const loadDepartments = useCallback(async (pid: string) => {
    const { data, error } = await supabase
      .from("departments")
      .select("id, project_id, name, color, vp_user_id, is_finance, sort_order, products")
      .eq("project_id", pid)
      .order("sort_order")
      .order("name");
    if (error) {
      console.error("[ProjectContext] departments error:", error.message);
      return;
    }
    setDepartments((data ?? []).map(mapDepartment));
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) { setIsLoading(false); return; }
        setUserId(uid);

        // ── 1. Every LC this user belongs to ───────────────────────────────
        const { data: memberRows, error: memberErr } = await supabase
          .from("team_members")
          .select("project_id, role, department_id, joined_at, projects(name)")
          .eq("user_id", uid)
          .order("joined_at", { ascending: true });
        if (memberErr) console.error("[ProjectContext] team_members error:", memberErr.message);

        const memberships: LcMembership[] = (memberRows ?? []).map((row) => {
          const proj = Array.isArray(row.projects) ? row.projects[0] : row.projects;
          return {
            id: row.project_id as string,
            name: ((proj as { name?: string } | null)?.name) ?? "Local Committee",
            role: toUserRole(row.role),
            departmentId: (row.department_id as string | null) ?? null,
          };
        });
        setLcs(memberships);
        if (memberships.length === 0) { setIsLoading(false); return; }

        const stored = readStorage(ACTIVE_LC_STORAGE_KEY);
        const pid = memberships.some((m) => m.id === stored) ? stored! : memberships[0].id;
        setProjectId(pid);

        // ── 2. Departments of the active LC ────────────────────────────────
        await loadDepartments(pid);

        // ── 3. Groups (sub_projects) this user is in, within the active LC ─
        const { data: groupRows, error: groupError } = await supabase
          .from("sub_project_members")
          .select(
            "sub_project_id, sub_projects(id, project_id, name, description, created_by, created_at, archived, color)"
          )
          .eq("user_id", uid);

        if (groupError) {
          console.error("[ProjectContext] sub_project_members error:", groupError);
          return;
        }

        const seen = new Set<string>();
        const sps: SubProject[] = (groupRows ?? [])
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
            if (sp === null || sp.archived || sp.projectId !== pid) return false;
            if (seen.has(sp.id)) return false;
            seen.add(sp.id);
            return true;
          });

        setSubProjects(sps);

        // Restore persisted selection - validate it's still a valid group
        const storedGroup = readStorage(STORAGE_KEY);
        const storedScope = (readStorage(SCOPE_STORAGE_KEY) ?? "lab") as ActiveScope;

        // (The separate "Personal" workspace is gone; anyone left in it is back in their LC.)
        if (storedScope !== "personal" && storedGroup && sps.some((sp) => sp.id === storedGroup)) {
          setSubProjectId(storedGroup);
          setActiveScopeState("project");
        } else {
          setActiveScopeState("lab");
        }
      } catch (err) {
        console.error("[ProjectContext] load error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, [loadDepartments]);

  const setActiveLc = useCallback((id: string) => {
    try {
      localStorage.setItem(ACTIVE_LC_STORAGE_KEY, id);
      // Groups and scope belong to the previous LC.
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SCOPE_STORAGE_KEY);
    } catch { /* ignore */ }
    onSwitch();
  }, [onSwitch]);

  const refreshDepartments = useCallback(async () => {
    if (projectId) await loadDepartments(projectId);
  }, [projectId, loadDepartments]);

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

  const active = lcs.find((m) => m.id === projectId) ?? null;
  const role = active?.role ?? null;

  return (
    <ProjectContext.Provider
      value={{
        userId,
        lcs,
        projectId,
        role,
        departmentId: active?.departmentId ?? null,
        departments,
        ledDepartmentIds: ledDepartmentIds(role, userId, departments),
        setActiveLc,
        refreshDepartments,
        subProjectId,
        subProjects,
        activeScope: activeScopeState,
        setActiveSubProject,
        setActiveScope,
        addSubProject,
        isLoading,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useProject(): ProjectContextValue {
  return useContext(ProjectContext);
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const onSwitch = useCallback(() => {
    setRevision(value => value + 1);
    router.push("/");
  }, [router]);
  return <ProjectProviderState key={revision} onSwitch={onSwitch}>{children}</ProjectProviderState>;
}
