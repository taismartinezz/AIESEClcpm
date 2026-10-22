-- Migration 005: Literature RLS: additive OR-branch for sub-project members
-- Mirrors the tasks/bookmarks pattern from migration 004.
-- Never drops lab-member access; only adds the external-member path.

-- ── Ensure added_by exists (live DB may pre-date this column) ────────────────
alter table literature_items
  add column if not exists added_by uuid references auth.users(id);

-- ── literature_items SELECT ──────────────────────────────────────────────────
drop policy if exists "project members can read literature" on literature_items;
create policy "project members can read literature" on literature_items
  for select using (
    -- existing: lab member
    exists (select 1 from team_members tm where tm.project_id = literature_items.project_id and tm.user_id = auth.uid())
    or
    -- new: sub-project member reading project-scoped items for their sub-project
    (
      literature_items.sub_project_id is not null
      and exists (
        select 1 from sub_project_members spm
        where spm.sub_project_id = literature_items.sub_project_id
          and spm.user_id = auth.uid()
      )
    )
  );

-- ── literature_items ALL (manage) ────────────────────────────────────────────
drop policy if exists "project members can manage literature" on literature_items;
create policy "project members can manage literature" on literature_items
  for all using (
    -- existing: lab member
    exists (select 1 from team_members tm where tm.project_id = literature_items.project_id and tm.user_id = auth.uid())
    or
    -- new: sub-project member managing project-scoped items for their sub-project
    (
      literature_items.sub_project_id is not null
      and exists (
        select 1 from sub_project_members spm
        where spm.sub_project_id = literature_items.sub_project_id
          and spm.user_id = auth.uid()
      )
    )
  ) with check (
    auth.uid() = added_by
  );
