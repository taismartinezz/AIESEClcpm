-- Migration 007: Fix mutual RLS recursion between sub_projects and sub_project_members
--
-- ROOT CAUSE:
--   sub_projects SELECT policy  → queries sub_project_members (line 83-86 of 004)
--   sub_project_members SELECT policy → queries sub_projects  (line 97-101 of 004)
--   Postgres evaluates both with RLS active → infinite recursion → 500 on any
--   query that touches either table (including ProjectContext's sub_project_members
--   fetch and any team_members join that joins sub_projects).
--
-- FIX: Wrap the sub_project_members lookup inside the sub_projects SELECT policy
--   in a SECURITY DEFINER function. SECURITY DEFINER bypasses RLS on
--   sub_project_members, so that branch never re-enters sub_projects' policy.
--   The sub_project_members policy's sub_projects join is now safe because
--   sub_projects' policy no longer recurses back into sub_project_members.

-- ── SECURITY DEFINER helper ───────────────────────────────────────────────────
create or replace function auth_uid_is_sub_project_member(p_sub_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from sub_project_members spm
    where spm.sub_project_id = p_sub_project_id
      and spm.user_id = auth.uid()
  );
$$;

-- ── Rewrite sub_projects SELECT to use the helper ─────────────────────────────
drop policy if exists "lab members can read sub_projects" on sub_projects;
create policy "lab members can read sub_projects" on sub_projects
  for select using (
    -- existing: lab members see all sub_projects in their lab
    exists (
      select 1 from team_members tm
      where tm.project_id = sub_projects.project_id and tm.user_id = auth.uid()
    )
    -- new: external member sees only the sub_projects they belong to
    -- (SECURITY DEFINER: does not trigger sub_project_members RLS → no recursion)
    or auth_uid_is_sub_project_member(sub_projects.id)
  );
