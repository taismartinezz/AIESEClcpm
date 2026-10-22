-- Migration 006: Fix RLS infinite recursion on user_profiles + add avatar_url
--
-- ROOT CAUSE (500s):
--   "sub-project co-members can read profiles" (user_profiles SELECT) queries
--   sub_project_members, whose own SELECT policy queries team_members, which
--   PostgREST resolves via the FK join back to user_profiles: infinite loop.
--
-- FIX: Replace the inline sub_project_members subquery with a SECURITY DEFINER
--   helper function. SECURITY DEFINER runs as the function owner (bypasses RLS),
--   so the co-member check never re-enters user_profiles policies.
--
-- ROOT CAUSE (400s): avatar_url column missing from user_profiles.

-- ── 1. Add avatar_url ─────────────────────────────────────────────────────────
alter table user_profiles
  add column if not exists avatar_url text;

-- ── 2. SECURITY DEFINER helper: checks sub-project co-membership ─────────────
-- Runs as the definer (bypasses RLS), so it reads sub_project_members directly
-- without triggering sub_project_members' SELECT policy, which would re-enter
-- user_profiles and recurse.
create or replace function auth_uid_shares_sub_project(profile_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from   sub_project_members a
    join   sub_project_members b on b.sub_project_id = a.sub_project_id
    where  a.user_id = auth.uid()
      and  b.user_id = profile_user_id
  );
$$;

-- ── 3. Rewrite the recursive policy to use the helper ─────────────────────────
drop policy if exists "sub-project co-members can read profiles" on user_profiles;
create policy "sub-project co-members can read profiles" on user_profiles
  for select using (
    auth_uid_shares_sub_project(user_profiles.id)
  );
