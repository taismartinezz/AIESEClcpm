-- Migration 008: sub_projects.color + tasks.parent_id
--
-- Item 9: Material color palette per sub-project (assigned at creation time by the UI).
-- Item 13: Subtasks: parent_id is a self-FK; null = top-level task.
--          Subtasks inherit scope/project_id/sub_project_id from their parent.

alter table sub_projects
  add column if not exists color text;

alter table tasks
  add column if not exists parent_id uuid references tasks(id) on delete cascade;
