"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCorners,
} from "@dnd-kit/core";
import { LayoutGrid, List, Search, Plus, User as UserIcon, Users } from "lucide-react";
import { TASKS as MOCK_TASKS, USERS, getStoredProject } from "@/lib/mock-data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useProject } from "@/context/ProjectContext";
import type { Task, TaskStatus, User, UserRole } from "@/types";
import Toast, { showToast } from "@/components/ui/Toast";
import TaskDetailPanel, { STATUS_ORDER } from "@/components/tasks/TaskDetailPanel";
import TaskModal from "@/components/tasks/TaskModal";
import ScopeSidebar, { type ScopeSection } from "@/components/ui/ScopeSidebar";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { useUndoToast } from "@/context/UndoToastContext";
import { TaskCard } from "./_components/TaskCard";
import { KanbanColumn } from "./_components/KanbanColumn";
import { TaskRow, FilterSelect, avatarColorFromId } from "./_components/TaskRow";

// ── Modal state ───────────────────────────────────────────────────────────────

type ModalState =
  | { mode: "add"; status: TaskStatus }
  | { mode: "edit"; task: Task }
  | null;

export default function TasksPage() {
  const { show: showUndoToast } = useUndoToast();
  const searchParams = useSearchParams();
  const [view, setView] = useState<"board" | "list">("board");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [search, setSearch] = useState("");
  const [filterMember, setFilterMember] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState>(null);
  const { subProjects, activeScope, subProjectId: ctxSubProjectId } = useProject();
  const [taskScope, setTaskScope] = useState<string>("all"); // "all" | "personal" | "lab" | subProjectId
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("canopy_tasks_sidebar_collapsed") === "true"; } catch { return false; }
  });
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [subtaskCounts, setSubtaskCounts] = useState<Record<string, { total: number; done: number }>>({});
  const [subtaskData, setSubtaskData] = useState<Record<string, Task[]>>({});
  const [taskNavStack, setTaskNavStack] = useState<Task[]>([]);
  const [boardWidth, setBoardWidth] = useState(1440);

  useEffect(() => {
    function update() { setBoardWidth(window.innerWidth); }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // Demo mode - use mock data, restoring any in-session mutations from sessionStorage
      const sp = getStoredProject();
      setProjectId(sp.id);
      setTeamMembers(USERS);
      let allTasks: Task[];
      try {
        const saved = sessionStorage.getItem("canopy_demo_tasks");
        allTasks = saved ? (JSON.parse(saved) as Task[]) : MOCK_TASKS;
      } catch {
        allTasks = MOCK_TASKS;
      }
      setTasks(allTasks.filter((t) => !t.parentId));
      // Build demo subtask data from tasks that have a parentId
      const demoSubtaskData: Record<string, Task[]> = {};
      const demoSubtaskCounts: Record<string, { total: number; done: number }> = {};
      for (const t of allTasks) {
        if (!t.parentId) continue;
        if (!demoSubtaskData[t.parentId]) { demoSubtaskData[t.parentId] = []; demoSubtaskCounts[t.parentId] = { total: 0, done: 0 }; }
        demoSubtaskData[t.parentId].push(t);
        demoSubtaskCounts[t.parentId].total++;
        if (t.status === "done") demoSubtaskCounts[t.parentId].done++;
      }
      setSubtaskData(demoSubtaskData);
      setSubtaskCounts(demoSubtaskCounts);
      setLoading(false);
      return;
    }

    // Stale-fetch guard: if scope/subProjectId changes while a fetch is in flight,
    // the earlier response must not overwrite the later one.
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const user = session?.user ?? null;
      if (!user) { setLoading(false); return; }
      setCurrentUserId(user.id);

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("project_id")
        .eq("id", user.id)
        .maybeSingle();

      const pid = profile?.project_id as string | undefined;
      if (!pid) { setLoading(false); return; }
      setProjectId(pid);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: members } = await (supabase
        .from("team_members")
        .select("*, user_profiles(name, avatar_initials, avatar_color, avatar_url, role)")
        .eq("project_id", pid) as any);

      if (members) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setTeamMembers((members as any[]).map((row) => {
          const p = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
          const id = row.user_id as string;
          return {
            id,
            name: p?.name ?? "Team Member",
            email: "",
            role: (p?.role ?? "researcher") as UserRole,
            avatarColor: p?.avatar_color ?? avatarColorFromId(id),
            avatarInitials: p?.avatar_initials ?? "??",
            avatarUrl: p?.avatar_url ?? undefined,
          } as User;
        }));
      }

      const { data, error } = await supabase
        .from("tasks")
        .select("*, task_assignees(user_id)")
        .eq("project_id", pid)
        .is("parent_id", null)
        .or("archived.is.null,archived.eq.false")
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) console.error("[Tasks] fetch error:", error);
      if (!error && data) {
        // Fetch subtask rows for inline expand + counts
        const { data: scData } = await supabase
          .from("tasks")
          .select("id, parent_id, title, status, priority, due_date, task_assignees(user_id)")
          .eq("project_id", pid)
          .not("parent_id", "is", null)
          .or("archived.is.null,archived.eq.false")
          .order("display_order", { ascending: true });
        if (!cancelled && scData) {
          const counts: Record<string, { total: number; done: number }> = {};
          const subs: Record<string, Task[]> = {};
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const r of scData as any[]) {
            const parentId = r.parent_id as string;
            if (!counts[parentId]) { counts[parentId] = { total: 0, done: 0 }; subs[parentId] = []; }
            counts[parentId].total++;
            if (r.status === "done") counts[parentId].done++;
            subs[parentId].push({
              id: r.id as string,
              projectId: pid,
              parentId,
              title: r.title as string,
              status: r.status as TaskStatus,
              priority: r.priority as Task["priority"],
              assigneeIds: ((r.task_assignees as { user_id: string }[]) ?? []).map((ta) => ta.user_id),
              dueDate: r.due_date as string | undefined,
              createdAt: "", updatedAt: "",
              comments: [], files: [], links: [],
            });
          }
          setSubtaskCounts(counts);
          setSubtaskData(subs);
        }
        setTasks(data.map((row) => ({
          id: row.id as string,
          projectId: row.project_id as string,
          parentId: (row.parent_id as string | null) ?? undefined,
          title: row.title as string,
          description: row.description as string,
          status: row.status as TaskStatus,
          priority: row.priority as Task["priority"],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          assigneeIds: ((row.task_assignees as any[]) ?? []).map((ta) => ta.user_id as string),
          dueDate: row.due_date as string | undefined,
          scope: (row.scope as Task["scope"]) ?? "lab",
          subProjectId: (row.sub_project_id as string | null) ?? undefined,
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
          comments: (row.comments as Task["comments"]) ?? [],
          files: (row.files as Task["files"]) ?? [],
          links: (row.links as Task["links"]) ?? [],
        })));
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open a specific task when navigated from global search (?openTask=<id>)
  useEffect(() => {
    const openTaskId = searchParams.get("openTask");
    if (!openTaskId || loading || tasks.length === 0) return;
    const task = tasks.find((t) => t.id === openTaskId);
    if (task) setSelectedTask(task);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tasks]);

  // Realtime: reflect task INSERTs/UPDATEs/DELETEs from other users
  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    const channel = supabase
      .channel(`tasks:${projectId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        if (row.archived) return;
        if (row.parent_id) return; // subtasks are not shown on the board
        setTasks((prev) => {
          if (prev.find((t) => t.id === row.id)) return prev;
          return [{
            id: row.id as string, projectId: row.project_id as string,
            title: row.title as string, description: (row.description as string) ?? "",
            status: row.status as TaskStatus, priority: row.priority as Task["priority"],
            assigneeIds: [], dueDate: row.due_date as string | undefined,
            scope: (row.scope as Task["scope"]) ?? "lab",
            subProjectId: (row.sub_project_id as string | null) ?? undefined,
            createdAt: row.created_at as string, updatedAt: row.updated_at as string,
            comments: [], files: [], links: [],
          }, ...prev];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        if (row.archived) { setTasks((prev) => prev.filter((t) => t.id !== row.id)); return; }
        setTasks((prev) => prev.map((t) => t.id === row.id ? { ...t, status: row.status as TaskStatus, priority: row.priority as Task["priority"], title: row.title as string, dueDate: row.due_date as string | undefined } : t));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, (payload) => {
        setTasks((prev) => prev.filter((t) => t.id !== (payload.old as Record<string, unknown>).id));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  // Persist task mutations (e.g. file uploads) across page navigations in demo mode
  useEffect(() => {
    if (!isSupabaseConfigured && !loading) {
      try { sessionStorage.setItem("canopy_demo_tasks", JSON.stringify(tasks)); } catch {}
    }
  }, [tasks, loading]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const activeTaskId = active.id as string;
    const overId = over.id as string;

    // Resolve target status outside setTasks so the Supabase call is a clean side-effect
    setTasks((prev) => {
      const activeTask = prev.find((t) => t.id === activeTaskId);
      if (!activeTask) return prev;

      let targetStatus: TaskStatus | undefined;
      if ((STATUS_ORDER as string[]).includes(overId)) {
        targetStatus = overId as TaskStatus;
      } else {
        const overTask = prev.find((t) => t.id === overId);
        if (overTask && overTask.status !== activeTask.status) {
          targetStatus = overTask.status;
        }
      }

      if (!targetStatus || targetStatus === activeTask.status) return prev;

      // Persist outside the updater to avoid double-fire in StrictMode
      setTimeout(() => {
        supabase.from("tasks").update({ status: targetStatus }).eq("id", activeTaskId)
          .then(({ error }) => {
            if (error) console.error("[Tasks] drag status error:", error);
          });
      }, 0);

      return prev.map((t) => t.id === activeTaskId ? { ...t, status: targetStatus! } : t);
    });
  }, []);

  const moveTask = useCallback((taskId: string, status: TaskStatus) => {
    setTasks((prev) => {
      const task = prev.find((t) => t.id === taskId);
      if (!task || task.status === status) return prev;

      const prevStatus = task.status;
      const taskTitle = task.title;
      const taskSubProjectId = task.subProjectId ?? null;

      // Write to DB first; only log activity after the update is confirmed.
      supabase.from("tasks").update({ status }).eq("id", taskId).then(({ error }) => {
        if (error) {
          console.error("[Tasks] moveTask error:", error);
          // Roll back the optimistic update
          setTasks((p) => p.map((t) => t.id === taskId ? { ...t, status: prevStatus } : t));
          return;
        }
        if (projectId && currentUserId) {
          supabase.from("activity_feed").insert({
            project_id: projectId,
            user_id: currentUserId,
            action_type: "moved",
            item_name: taskTitle,
            item_type: "task",
            from_status: prevStatus,
            to_status: status,
            sub_project_id: taskSubProjectId,
          }).then(({ error: e }) => { if (e) console.error("[Tasks] activity insert error:", e); });
        }
      });

      return prev.map((t) => t.id === taskId ? { ...t, status } : t);
    });
    setSelectedTask((prev) => prev?.id === taskId ? { ...prev, status } : prev);
  }, [projectId, currentUserId]);

  const updateTask = useCallback((taskId: string, updates: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, ...updates } : t));
    setSelectedTask((prev) => prev?.id === taskId ? { ...prev, ...updates } as Task : prev);
    if (!isSupabaseConfigured) return;
    const db: Record<string, unknown> = {};
    if (updates.title       !== undefined) db.title        = updates.title;
    if (updates.description !== undefined) db.description  = updates.description;
    if (updates.priority    !== undefined) db.priority     = updates.priority;
    if (updates.status      !== undefined) db.status       = updates.status;
    if (updates.dueDate     !== undefined) db.due_date     = updates.dueDate || null;
    if (updates.assigneeIds !== undefined) db.assignee_ids = updates.assigneeIds;
    if (updates.comments    !== undefined) db.comments     = updates.comments;
    if (updates.files       !== undefined) db.files        = updates.files;
    if (Object.keys(db).length > 0)
      supabase.from("tasks").update(db).eq("id", taskId)
        .then(({ error }) => {
          if (error) {
            console.error("[Tasks] update error:", error);
            if (updates.files !== undefined)
              showToast(`File save failed: ${error.message}`, "error");
          }
        });
  }, []);

  const addTask = useCallback((task: Task) => {
    setTasks((prev) => [task, ...prev]);
    setModalState(null);
  }, []);

  const editTask = useCallback((task: Task) => {
    setTasks((prev) => prev.map((t) => t.id === task.id ? task : t));
    setSelectedTask((prev) => prev?.id === task.id ? task : prev);
    setModalState(null);
  }, []);

  const deleteTask = useCallback((taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelectedTask((prev) => prev?.id === taskId ? null : prev);
    showUndoToast(
      `"${task.title}" deleted`,
      () => setTasks((prev) => [...prev, task]),
      () => supabase.from("tasks").delete().eq("id", taskId)
        .then(({ error }) => { if (error) console.error("[Tasks] deleteTask error:", error); }),
    );
  }, [tasks, showUndoToast]);

  const archiveDoneTasks = useCallback(() => {
    setTasks((prev) => {
      const doneIds = prev.filter((t) => t.status === "done").map((t) => t.id);
      if (doneIds.length === 0) return prev;
      supabase.from("tasks").update({ archived: true }).in("id", doneIds)
        .then(({ error }) => { if (error) console.error("[Tasks] archive error:", error); });
      return prev.filter((t) => t.status !== "done");
    });
    setSelectedTask((prev) => prev?.status === "done" ? null : prev);
  }, []);

  // ── Subtask navigation & promotion ───────────────────────────────────────────

  const handleOpenSubtask = useCallback((subtask: Task) => {
    setTaskNavStack(prev => [...prev, selectedTask!]);
    setSelectedTask(subtask);
  }, [selectedTask]);

  const handleNavigateBack = useCallback(() => {
    setTaskNavStack(prev => {
      const parent = prev[prev.length - 1] ?? null;
      setSelectedTask(parent);
      return prev.slice(0, -1);
    });
  }, []);

  const handlePromoteSubtask = useCallback((subtask: Task) => {
    setTasks(prev => {
      if (prev.find(t => t.id === subtask.id)) return prev;
      return [{ ...subtask, parentId: undefined }, ...prev];
    });
    setSubtaskCounts(prev => {
      if (!subtask.parentId) return prev;
      const curr = prev[subtask.parentId] ?? { total: 0, done: 0 };
      return {
        ...prev,
        [subtask.parentId]: {
          total: Math.max(0, curr.total - 1),
          done: subtask.status === "done" ? Math.max(0, curr.done - 1) : curr.done,
        },
      };
    });
  }, []);

  const handleToggleSubtask = useCallback((taskId: string, subtaskId: string, done: boolean) => {
    const newStatus: TaskStatus = done ? "done" : "todo";
    setSubtaskData((prev) => ({
      ...prev,
      [taskId]: (prev[taskId] ?? []).map((s) => s.id === subtaskId ? { ...s, status: newStatus } : s),
    }));
    setSubtaskCounts((prev) => {
      const curr = prev[taskId] ?? { total: 0, done: 0 };
      return { ...prev, [taskId]: { total: curr.total, done: done ? curr.done + 1 : Math.max(0, curr.done - 1) } };
    });
    if (isSupabaseConfigured) {
      supabase.from("tasks").update({ status: newStatus }).eq("id", subtaskId)
        .then(({ error }) => { if (error) console.error("[Tasks] subtask toggle error:", error); });
    }
  }, []);

  const handleUpdateTaskAssignees = useCallback(async (taskId: string, ids: string[]) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, assigneeIds: ids } : t));
    if (!isSupabaseConfigured) return;
    const { error: delErr } = await supabase.from("task_assignees").delete().eq("task_id", taskId);
    if (delErr) { console.error("[Tasks] assignee delete:", delErr); showToast("Failed to update assignees.", "error"); return; }
    if (ids.length > 0) {
      const { error: insErr } = await supabase.from("task_assignees").insert(ids.map((uid) => ({ task_id: taskId, user_id: uid })));
      if (insErr) { console.error("[Tasks] assignee insert:", insErr); showToast("Failed to update assignees.", "error"); }
    }
  }, []);

  const handleUpdateTaskDueDate = useCallback((taskId: string, date: string | undefined) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, dueDate: date } : t));
    if (!isSupabaseConfigured) return;
    supabase.from("tasks").update({ due_date: date ?? null }).eq("id", taskId)
      .then(({ error }) => { if (error) { console.error("[Tasks] due_date update:", error); showToast("Failed to update due date.", "error"); } });
  }, []);

  // Scope counts for sidebar (computed from full unfiltered task list)
  const scopeCounts = {
    all: tasks.length,
    // Personal = own personal-scoped tasks OR any task explicitly assigned to this user
    personal: tasks.filter(t =>
      t.scope === "personal" ||
      (currentUserId && t.assigneeIds.includes(currentUserId))
    ).length,
    lab: tasks.filter(t => t.scope === "lab" || !t.scope).length,
  };
  const projectTaskCounts: Record<string, number> = {};
  for (const sp of subProjects) {
    projectTaskCounts[sp.id] = tasks.filter(t => t.scope === "project" && t.subProjectId === sp.id).length;
  }

  const isLabHome = activeScope === "lab";
  const effectiveTaskScope: string = isLabHome
    ? taskScope
    : activeScope === "project" && ctxSubProjectId
      ? ctxSubProjectId
      : activeScope === "personal"
        ? "personal"
        : "all";

  const isSubProjectScope = taskScope !== "all" && taskScope !== "personal" && taskScope !== "lab";

  const sidebarSections: ScopeSection[] = [
    { id: "all", label: "All", color: "#1B2E4B", icon: <LayoutGrid size={17} />, count: scopeCounts.all, isActive: taskScope === "all", onClick: () => setTaskScope("all") },
    { id: "personal", label: "Personal", color: "#6366f1", icon: <UserIcon size={17} />, count: scopeCounts.personal, isActive: taskScope === "personal", onClick: () => setTaskScope("personal") },
    { id: "lab", label: "Lab", color: "#0ea5e9", icon: <Users size={17} />, count: scopeCounts.lab, isActive: taskScope === "lab", onClick: () => setTaskScope("lab") },
  ];

  const scopedTasks = tasks.filter(t => {
    if (effectiveTaskScope === "all") return true;
    if (effectiveTaskScope === "personal")
      return t.scope === "personal" ||
        (currentUserId ? t.assigneeIds.includes(currentUserId) : false);
    if (effectiveTaskScope === "lab") return t.scope === "lab" || !t.scope;
    return t.scope === "project" && t.subProjectId === effectiveTaskScope;
  });

  const filteredTasks = scopedTasks.filter((t) => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterMember !== "all" && !t.assigneeIds.includes(filterMember)) return false;
    if (filterPriority !== "all" && t.priority !== filterPriority) return false;
    return true;
  });

  const tasksByStatus = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, filteredTasks.filter((t) => t.status === s)])
  ) as Record<TaskStatus, Task[]>;

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  const filterSelectStyle: React.CSSProperties = {
    height: 36, fontSize: 12, fontFamily: "var(--font-roboto)",
    border: "1px solid var(--color-border)", borderRadius: 7,
    backgroundColor: "var(--color-canvas)", color: "var(--color-secondary)",
    outline: "none", cursor: "pointer", paddingLeft: 8, paddingRight: 8,
  };

  const tasksBadgeSp = !isLabHome && activeScope === "project"
    ? subProjects.find((s) => s.id === ctxSubProjectId) ?? null
    : null;

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "var(--font-roboto)" }}>

      <PageHeader
        title="Tasks"
        badge={tasksBadgeSp ? (
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", backgroundColor: "rgba(27,46,75,0.10)", color: "var(--color-navy)", padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
            {tasksBadgeSp.name}
          </span>
        ) : undefined}
        action={
          <>
            <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)" }}>
              {(["board", "list"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => { setView(v); setSelectedTask(null); }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all"
                  style={{ fontSize: 12, fontWeight: 600, backgroundColor: view === v ? "var(--color-navy)" : "transparent", color: view === v ? "#fff" : "var(--color-secondary)", minHeight: 32, minWidth: 40, justifyContent: "center" }}
                >
                  {v === "board" ? <LayoutGrid size={13} /> : <List size={13} />}
                  <span className="hidden sm:inline">{v === "board" ? "Board" : "List"}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setModalState({ mode: "add", status: "todo" })}
              className="flex items-center gap-1.5 px-3 md:px-4 transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--color-navy)", color: "#fff", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "none", cursor: "pointer", height: 36 }}
            >
              <Plus size={13} />
              <span className="hidden sm:inline">Add Task</span>
            </button>
          </>
        }
      >
        {/* Search + filters row */}
        <div className="flex items-center gap-2 py-2 flex-wrap">
          <div className="relative flex-1 min-w-0" style={{ minWidth: 120 }}>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="var(--color-secondary)" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              style={{ width: "100%", paddingLeft: 32, paddingRight: 12, height: 36, border: "1px solid var(--color-border)", borderRadius: 7, fontSize: 13, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-canvas)", outline: "none" }}
            />
          </div>

          <FilterSelect value={filterMember} onChange={setFilterMember}>
            <option value="all">All Members</option>
            {teamMembers.map((u) => (
              <option key={u.id} value={u.id}>{u.name.split(" ")[0]}</option>
            ))}
          </FilterSelect>

          <FilterSelect value={filterPriority} onChange={setFilterPriority}>
            <option value="all">All Priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </FilterSelect>
        </div>

        {/* Mobile scope chips - lab-home only, hidden on md+ where sidebar shows */}
        {isLabHome && (
          <div className="md:hidden flex items-center gap-2 overflow-x-auto py-2" style={{ scrollbarWidth: "none" }}>
            {sidebarSections.map((s) => (
              <button key={s.id} onClick={s.onClick}
                style={{ flexShrink: 0, fontSize: 12, fontWeight: s.isActive ? 700 : 500, padding: "5px 12px", borderRadius: 20, border: `1px solid ${s.isActive ? s.color : "var(--color-border)"}`, backgroundColor: s.isActive ? `${s.color}18` : "transparent", color: s.isActive ? s.color : "var(--color-secondary)", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "var(--font-roboto)" }}>
                {s.label}
              </button>
            ))}
            {subProjects.map((sp) => (
              <button key={sp.id} onClick={() => setTaskScope(sp.id)}
                style={{ flexShrink: 0, fontSize: 12, fontWeight: taskScope === sp.id ? 700 : 500, padding: "5px 12px", borderRadius: 20, border: `1px solid ${taskScope === sp.id ? (sp.color ?? "#1B2E4B") : "var(--color-border)"}`, backgroundColor: taskScope === sp.id ? `${sp.color ?? "#1B2E4B"}18` : "transparent", color: taskScope === sp.id ? (sp.color ?? "#1B2E4B") : "var(--color-secondary)", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "var(--font-roboto)" }}>
                {sp.name}
              </button>
            ))}
          </div>
        )}
      </PageHeader>

      {/* Content = ScopeSidebar + Board/List */}
      <div className="flex flex-1 overflow-hidden">
        {isLabHome && (
          <div className="hidden md:flex">
            <ScopeSidebar
              sections={sidebarSections}
              subProjects={subProjects}
              selectedSubProjectId={isSubProjectScope ? taskScope : null}
              projectCounts={projectTaskCounts}
              onSelectSubProject={(id) => setTaskScope(id)}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(c => {
                const next = !c;
                try { localStorage.setItem("canopy_tasks_sidebar_collapsed", String(next)); } catch {}
                return next;
              })}
              storageKey="canopy_tasks_sidebar"
              headerLabel="Filters"
            />
          </div>
        )}
        <div className="flex-1 overflow-auto" style={{ padding: "20px 24px" }}>
        {loading && (
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            {[1, 2, 3, 4].map((col) => (
              <div key={col} style={{ flex: "1 1 0", minWidth: 0, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>
                  <div style={{ width: "50%", height: 13, borderRadius: 4, backgroundColor: "var(--color-border)" }} className="animate-pulse" />
                </div>
                <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {[1, 2, 3].map((row) => (
                    <div key={row} style={{ backgroundColor: "var(--color-canvas)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ width: `${55 + row * 12}%`, height: 12, borderRadius: 4, backgroundColor: "var(--color-border)", marginBottom: 8 }} className="animate-pulse" />
                      <div style={{ width: "40%", height: 10, borderRadius: 4, backgroundColor: "var(--color-border)", opacity: 0.6 }} className="animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && view === "board" ? (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div style={{ position: "relative" }}>
            {boardWidth >= 640 && boardWidth < 1024 && (
              <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 48, pointerEvents: "none", background: "linear-gradient(to right, transparent, var(--color-canvas))", zIndex: 2 }} />
            )}
            <div style={{
              overflowX: boardWidth < 1024 ? "auto" : "visible",
              WebkitOverflowScrolling: "touch",
              scrollSnapType: boardWidth >= 640 && boardWidth < 1024 ? "x mandatory" : undefined,
            }}>
              <div style={{
                display: boardWidth >= 1024 ? "grid" : "flex",
                flexDirection: boardWidth < 640 ? "column" : "row",
                gridTemplateColumns: boardWidth >= 1024 ? "repeat(4, minmax(0, 1fr))" : undefined,
                gap: boardWidth >= 1024 ? 20 : 16,
                alignItems: "start",
              }}>
                {STATUS_ORDER.map((status) => (
                  <div key={status} style={
                    boardWidth >= 1024 ? {} :
                    boardWidth < 640 ? { width: "100%", minWidth: 0 } :
                    { minWidth: 252, maxWidth: 280, flexShrink: 0, scrollSnapAlign: "start" }
                  }>
                    <KanbanColumn
                      status={status}
                      tasks={tasksByStatus[status]}
                      onTaskClick={setSelectedTask}
                      onMoveTask={moveTask}
                      onEditTask={(t) => setModalState({ mode: "edit", task: t })}
                      onDeleteTask={deleteTask}
                      onAddTask={(s) => setModalState({ mode: "add", status: s })}
                      onArchiveDone={archiveDoneTasks}
                      teamMembers={teamMembers}
                      subtaskCounts={subtaskCounts}
                      subtaskData={subtaskData}
                      onToggleSubtask={handleToggleSubtask}
                      showLabBadge={false}
                    />
                  </div>
                ))}
              </div>
            </div>
            </div>
            <DragOverlay>
              {activeTask && (
                <div style={{ opacity: 0.85, transform: "rotate(2deg)" }}>
                  <TaskCard
                    task={activeTask}
                    onClick={() => {}}
                    onMoveStatus={() => {}}
                    onEdit={() => {}}
                    onDelete={() => {}}
                    isDragging
                    teamMembers={teamMembers}
                    showLabBadge={false}
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        ) : !loading ? (
          <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)" }}>
            <table className="border-collapse" style={{ width: "100%", minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {["", "Title", "Status", "Priority", "Assignees", "Due Date", "Subtasks", ""].map((col, i) => (
                    <th key={i} className={i === 0 ? "pl-5 py-3 pr-2" : i === 7 ? "pr-5 py-3" : "py-3 pr-3"}
                      style={{ textAlign: "left", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-secondary)", fontFamily: "var(--font-roboto)" }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onClick={() => setSelectedTask(task)}
                    onToggleDone={() => {
                      const prevStatus = task.status;
                      const newStatus: TaskStatus = prevStatus === "done" ? "todo" : "done";
                      moveTask(task.id, newStatus);
                      if (newStatus === "done") {
                        showUndoToast("Marked as done", () => moveTask(task.id, prevStatus));
                      }
                    }}
                    onMoveStatus={(s) => moveTask(task.id, s)}
                    onUpdateAssignees={(ids) => handleUpdateTaskAssignees(task.id, ids)}
                    onUpdateDueDate={(d) => handleUpdateTaskDueDate(task.id, d)}
                    teamMembers={teamMembers}
                    subtaskProgress={subtaskCounts[task.id]}
                    subtasks={subtaskData[task.id]}
                    onToggleSubtask={(subId, done) => handleToggleSubtask(task.id, subId, done)}
                    showLabBadge={false}
                  />
                ))}
                {filteredTasks.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: "8px 0" }}>
                      {scopedTasks.length === 0 ? (
                        <EmptyState
                          variant="tasks"
                          title="No tasks yet"
                          description="Add your first task to get started."
                        />
                      ) : (
                        <EmptyState
                          variant="tasks"
                          title="No tasks match your filters"
                          description="Try adjusting the search or filter options above."
                        />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
        </div>
      </div>

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          parentTask={taskNavStack.length > 0 ? taskNavStack[taskNavStack.length - 1] : undefined}
          onClose={() => { setSelectedTask(null); setTaskNavStack([]); }}
          onNavigateBack={taskNavStack.length > 0 ? handleNavigateBack : undefined}
          onUpdateStatus={(status) => moveTask(selectedTask.id, status)}
          onUpdateTask={(updates) => updateTask(selectedTask.id, updates)}
          onDeleteTask={deleteTask}
          onOpenSubtask={handleOpenSubtask}
          onPromoteSubtask={handlePromoteSubtask}
          teamMembers={teamMembers}
          currentUserId={currentUserId}
        />
      )}

      {modalState && (
        <TaskModal
          mode={modalState.mode}
          initialStatus={modalState.mode === "add" ? modalState.status : undefined}
          task={modalState.mode === "edit" ? modalState.task : undefined}
          onSave={modalState.mode === "add" ? addTask : editTask}
          onClose={() => setModalState(null)}
          teamMembers={teamMembers}
          currentUserId={currentUserId}
          projectId={projectId}
          scope={effectiveTaskScope === "personal" ? "personal" : (effectiveTaskScope !== "all" && effectiveTaskScope !== "lab" ? "project" : "lab")}
          subProjectId={effectiveTaskScope !== "all" && effectiveTaskScope !== "personal" && effectiveTaskScope !== "lab" ? effectiveTaskScope : null}
          subProjects={subProjects}
        />
      )}

      <Toast />
    </div>
  );
}
