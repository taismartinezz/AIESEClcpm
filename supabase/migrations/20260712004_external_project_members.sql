-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration: external project members + access-control
-- Adds: invited_email drift fix, sub_project_invite_codes table,
--       sub_project_members schema additions, literature_items sub_project_id,
--       and 12 additive RLS policy updates.
-- Safe to run on production: additive only; DROP POLICY IF EXISTS before each
-- recreate; IF NOT EXISTS on all DDL; no data destructive operations.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ── 1. Drift fix: invite_codes.invited_email ──────────────────────────────────
-- Column exists in the live DB but was missing from schema.sql. This is a no-op
-- on production.
alter table invite_codes
  add column if not exists invited_email text;

-- ── 2. New table: sub_project_invite_codes ────────────────────────────────────
-- Mirrors invite_codes but scoped to a sub_project rather than the lab.
-- Used for project-level invites by email, including external (non-lab) users.
create table if not exists sub_project_invite_codes (
  id             uuid        primary key default gen_random_uuid(),
  token          text        not null unique,
  sub_project_id uuid        not null references sub_projects(id) on delete cascade,
  invited_email  text        not null,
  invited_by     uuid        not null references auth.users(id),
  status         text        not null check (status in ('pending','accepted','expired')) default 'pending',
  used_by        uuid        references auth.users(id),
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);

alter table sub_project_invite_codes enable row level security;

-- Anyone can look up a token (needed for acceptance flow before/just after auth,
-- mirrors invite_codes policy "anyone can look up a code").
drop policy if exists "anyone can look up a project invite" on sub_project_invite_codes;
create policy "anyone can look up a project invite" on sub_project_invite_codes
  for select using (true);

-- Only the inviter may create a row (mirrors "pi can insert invite code").
drop policy if exists "inviter can insert project invite" on sub_project_invite_codes;
create policy "inviter can insert project invite" on sub_project_invite_codes
  for insert with check (auth.uid() = invited_by);

-- Acceptance: mark status → 'accepted' and record used_by; only while pending
-- (mirrors "user can claim unused code").
drop policy if exists "user can claim pending project invite" on sub_project_invite_codes;
create policy "user can claim pending project invite" on sub_project_invite_codes
  for update using (status = 'pending') with check (auth.uid() = used_by);

-- Inviter may also expire/cancel their own invites.
drop policy if exists "inviter can update own project invite" on sub_project_invite_codes;
create policy "inviter can update own project invite" on sub_project_invite_codes
  for update using (auth.uid() = invited_by);

-- ── 3. Schema additions ───────────────────────────────────────────────────────

-- sub_project_members: audit columns for invite tracking.
alter table sub_project_members
  add column if not exists joined_at  timestamptz not null default now(),
  add column if not exists invited_by uuid        references auth.users(id) on delete set null;

-- literature_items: FK so project-scoped items can be filtered per sub_project
-- (required for future external-member RLS on literature).
alter table literature_items
  add column if not exists sub_project_id uuid references sub_projects(id) on delete set null;

-- ── 4. RLS policy updates ─────────────────────────────────────────────────────
-- Convention: the EXISTING predicate is reproduced verbatim as the first branch;
-- the NEW branch is clearly marked and added with OR.

-- ── (1) sub_projects SELECT ───────────────────────────────────────────────────
-- External members can see the sub_project they belong to (needed so they can
-- load their project context on login). Lab-scoped rows NOT exposed.
drop policy if exists "lab members can read sub_projects" on sub_projects;
create policy "lab members can read sub_projects" on sub_projects
  for select using (
    -- EXISTING: lab members see all sub_projects in their lab
    exists (
      select 1 from team_members tm
      where tm.project_id = sub_projects.project_id and tm.user_id = auth.uid()
    )
    -- NEW: external member sees only the sub_projects they belong to
    or exists (
      select 1 from sub_project_members spm
      where spm.sub_project_id = sub_projects.id and spm.user_id = auth.uid()
    )
  );

-- ── (2) sub_project_members SELECT ───────────────────────────────────────────
-- Allows external members to read their own membership row, which the existing
-- FOR ALL policy already grants via user_id = auth.uid(). Extending the named
-- SELECT policy here makes it explicit and self-documenting.
drop policy if exists "lab members can read sub_project_members" on sub_project_members;
create policy "lab members can read sub_project_members" on sub_project_members
  for select using (
    -- EXISTING: lab members see all membership rows for their lab's sub_projects
    exists (
      select 1 from sub_projects sp
      join team_members tm on tm.project_id = sp.project_id
      where sp.id = sub_project_members.sub_project_id and tm.user_id = auth.uid()
    )
    -- NEW: any member (including external) can read their own row
    or user_id = auth.uid()
  );

-- ── (3) sub_project_members INSERT (privileged) ───────────────────────────────
-- PI (projects.owner_id) or sub_project creator may add any user_id.
-- Self-insert (accepting an invite) is already covered by the existing FOR ALL
-- policy "lab members can manage own sub_project membership".
drop policy if exists "privileged can insert sub_project_members" on sub_project_members;
create policy "privileged can insert sub_project_members" on sub_project_members
  for insert with check (
    exists (
      select 1 from sub_projects sp
      join projects p on p.id = sp.project_id
      where sp.id = sub_project_members.sub_project_id
        and (p.owner_id = auth.uid() or sp.created_by = auth.uid())
    )
  );

-- ── (4) sub_project_members DELETE (privileged) ───────────────────────────────
-- PI or sub_project creator may remove any member from their sub_project.
-- Self-removal is already covered by the existing FOR ALL policy.
drop policy if exists "privileged can delete sub_project_members" on sub_project_members;
create policy "privileged can delete sub_project_members" on sub_project_members
  for delete using (
    exists (
      select 1 from sub_projects sp
      join projects p on p.id = sp.project_id
      where sp.id = sub_project_members.sub_project_id
        and (p.owner_id = auth.uid() or sp.created_by = auth.uid())
    )
  );

-- ── (5) tasks SELECT ──────────────────────────────────────────────────────────
-- External project member can read tasks scoped to their sub_project.
-- Lab-scoped and personal tasks remain invisible to them (no team_members row).
drop policy if exists "project members can read tasks" on tasks;
create policy "project members can read tasks" on tasks
  for select using (
    -- EXISTING: lab members read all tasks in their lab project
    exists (
      select 1 from team_members tm
      where tm.project_id = tasks.project_id and tm.user_id = auth.uid()
    )
    -- NEW: external member reads only project-scoped tasks in their sub_project
    or (
      tasks.scope = 'project'
      and tasks.sub_project_id is not null
      and exists (
        select 1 from sub_project_members spm
        where spm.sub_project_id = tasks.sub_project_id and spm.user_id = auth.uid()
      )
    )
  );

-- ── (6) tasks INSERT ──────────────────────────────────────────────────────────
drop policy if exists "project members can insert tasks" on tasks;
create policy "project members can insert tasks" on tasks
  for insert with check (
    auth.uid() = created_by and (
      -- EXISTING
      exists (
        select 1 from team_members tm
        where tm.project_id = tasks.project_id and tm.user_id = auth.uid()
      )
      -- NEW
      or (
        tasks.scope = 'project'
        and tasks.sub_project_id is not null
        and exists (
          select 1 from sub_project_members spm
          where spm.sub_project_id = tasks.sub_project_id and spm.user_id = auth.uid()
        )
      )
    )
  );

-- ── (7) bookmarks SELECT ──────────────────────────────────────────────────────
drop policy if exists "project members can read bookmarks" on bookmarks;
create policy "project members can read bookmarks" on bookmarks
  for select using (
    -- EXISTING
    exists (
      select 1 from team_members tm
      where tm.project_id = bookmarks.project_id and tm.user_id = auth.uid()
    )
    -- NEW
    or (
      bookmarks.scope = 'project'
      and bookmarks.sub_project_id is not null
      and exists (
        select 1 from sub_project_members spm
        where spm.sub_project_id = bookmarks.sub_project_id and spm.user_id = auth.uid()
      )
    )
  );

-- ── (8) bookmarks INSERT ──────────────────────────────────────────────────────
drop policy if exists "project members can insert bookmarks" on bookmarks;
create policy "project members can insert bookmarks" on bookmarks
  for insert with check (
    -- EXISTING
    exists (
      select 1 from team_members tm
      where tm.project_id = bookmarks.project_id and tm.user_id = auth.uid()
    )
    -- NEW
    or (
      bookmarks.scope = 'project'
      and bookmarks.sub_project_id is not null
      and exists (
        select 1 from sub_project_members spm
        where spm.sub_project_id = bookmarks.sub_project_id and spm.user_id = auth.uid()
      )
    )
  );

-- ── (9) schedule_events SELECT ────────────────────────────────────────────────
-- Adds the missing scope='project' branch (Phase 3 added project events to the
-- DB but the old SELECT policy had no predicate for them: they fell through).
drop policy if exists "members can read lab events and own personal events" on schedule_events;
create policy "members can read lab events and own personal events" on schedule_events
  for select using (
    -- EXISTING: lab scope: lab members only
    (scope = 'lab' and exists (
      select 1 from team_members tm
      where tm.project_id = schedule_events.project_id and tm.user_id = auth.uid()
    ))
    -- EXISTING: personal scope: creator only
    or (scope = 'personal' and auth.uid() = created_by)
    -- NEW: project scope: sub_project members (including external)
    or (
      scope = 'project'
      and schedule_events.sub_project_id is not null
      and exists (
        select 1 from sub_project_members spm
        where spm.sub_project_id = schedule_events.sub_project_id and spm.user_id = auth.uid()
      )
    )
  );

-- ── (10) schedule_events INSERT ───────────────────────────────────────────────
drop policy if exists "project members can insert events" on schedule_events;
create policy "project members can insert events" on schedule_events
  for insert with check (
    auth.uid() = created_by and (
      -- EXISTING
      exists (
        select 1 from team_members tm
        where tm.project_id = schedule_events.project_id and tm.user_id = auth.uid()
      )
      -- NEW
      or (
        schedule_events.scope = 'project'
        and schedule_events.sub_project_id is not null
        and exists (
          select 1 from sub_project_members spm
          where spm.sub_project_id = schedule_events.sub_project_id and spm.user_id = auth.uid()
        )
      )
    )
  );

-- ── (11) reminders SELECT ─────────────────────────────────────────────────────
-- Adds a project-scope branch. Lab-scoped reminders remain gated on team_members.
drop policy if exists "reminders select" on reminders;
create policy "reminders select" on reminders
  for select using (
    -- EXISTING: own reminders (personal scope)
    auth.uid() = user_id
    -- EXISTING: lab-scoped reminders visible to all lab members
    or (scope = 'lab' and exists (
      select 1 from team_members tm
      where tm.project_id = reminders.project_id and tm.user_id = auth.uid()
    ))
    -- NEW: project-scoped reminders visible to sub_project members only
    or (
      scope = 'project'
      and reminders.sub_project_id is not null
      and exists (
        select 1 from sub_project_members spm
        where spm.sub_project_id = reminders.sub_project_id and spm.user_id = auth.uid()
      )
    )
  );

-- ── (12) user_profiles SELECT: co-sub_project members ────────────────────────
-- External members can read profiles of people who share at least one
-- sub_project with them. This does NOT expose the full lab roster: the join only
-- matches users who are in a common sub_project_members row.
-- Added as a third SELECT policy (additive; existing policies untouched).
drop policy if exists "sub-project co-members can read profiles" on user_profiles;
create policy "sub-project co-members can read profiles" on user_profiles
  for select using (
    exists (
      select 1
      from   sub_project_members a
      join   sub_project_members b on b.sub_project_id = a.sub_project_id
      where  a.user_id = auth.uid()
        and  b.user_id = user_profiles.id
    )
  );
