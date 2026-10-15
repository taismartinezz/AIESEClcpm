import type { TaskStatus } from "@/types";

/** Board columns, left to right. */
export const TASK_STATUS_ORDER: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "done"];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog:     "Backlog",
  todo:        "To do",
  in_progress: "In progress",
  in_review:   "Review",
  done:        "Done",
};

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  backlog:     "var(--status-backlog-dot)",
  todo:        "var(--status-todo-dot)",
  in_progress: "var(--status-inprogress-dot)",
  in_review:   "var(--status-inreview-dot)",
  done:        "var(--status-done-dot)",
};

export function emptyTaskCounts(): Record<TaskStatus, number> {
  return { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0 };
}
