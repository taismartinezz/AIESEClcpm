-- Migration 001: Reconcile schema.sql drift against the live database.
-- These tables exist in production but were absent from schema.sql.
-- All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS for idempotency.
--
-- Drift discovered 2026-07-12:
--   - sub_projects, sub_project_members, bookmarks: live DB only, not in schema.sql
--   - tasks.sub_project_id: live DB already has it, schema.sql did not
--   - schedule_events: in schema.sql but NOT in live DB (live uses `events`)
--   - reminders.position, reminders.assignee_id: live DB only (pre-existing, out of scope)

-- ── Sub-projects ──────────────────────────────────────────────────────────────
-- Named groupings within a lab (project_id = the lab).
-- Members of a sub-project are tracked in sub_project_members.

create table if not exists sub_projects (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  description text,
  created_by  uuid references user_profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived    boolean not null default false
);

alter table sub_projects enable row level security;

create policy "lab members can read sub_projects" on sub_projects
  for select using (
    exists (
      select 1 from team_members tm
      where tm.project_id = sub_projects.project_id and tm.user_id = auth.uid()
    )
  );

create policy "lab members can insert sub_projects" on sub_projects
  for insert with check (
    exists (
      select 1 from team_members tm
      where tm.project_id = sub_projects.project_id and tm.user_id = auth.uid()
    )
  );

create policy "creator can update sub_projects" on sub_projects
  for update using (created_by = auth.uid());

create policy "creator can delete sub_projects" on sub_projects
  for delete using (created_by = auth.uid());

-- ── Sub-project Members ───────────────────────────────────────────────────────
-- Each (sub_project_id, user_id) pair is unique.
-- Membership here is independent of lab team_members: only listed users
-- belong to the sub-project and can see its project-scoped content.

create table if not exists sub_project_members (
  sub_project_id uuid not null references sub_projects(id) on delete cascade,
  user_id        uuid not null references user_profiles(id) on delete cascade,
  primary key (sub_project_id, user_id)
);

alter table sub_project_members enable row level security;

create policy "lab members can read sub_project_members" on sub_project_members
  for select using (
    exists (
      select 1 from sub_projects sp
      join team_members tm on tm.project_id = sp.project_id
      where sp.id = sub_project_members.sub_project_id and tm.user_id = auth.uid()
    )
  );

create policy "lab members can manage own sub_project membership" on sub_project_members
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Bookmarks ─────────────────────────────────────────────────────────────────

create table if not exists bookmarks (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  url        text not null,
  title      text not null,
  added_by   uuid references user_profiles(id) on delete set null,
  added_at   timestamptz not null default now()
);

alter table bookmarks enable row level security;

create policy "project members can read bookmarks" on bookmarks
  for select using (
    exists (
      select 1 from team_members tm
      where tm.project_id = bookmarks.project_id and tm.user_id = auth.uid()
    )
  );

create policy "project members can insert bookmarks" on bookmarks
  for insert with check (
    exists (
      select 1 from team_members tm
      where tm.project_id = bookmarks.project_id and tm.user_id = auth.uid()
    )
  );

create policy "adder can delete bookmarks" on bookmarks
  for delete using (added_by = auth.uid());

-- ── tasks.sub_project_id ─────────────────────────────────────────────────────
-- Already exists in the live DB; this is a no-op on production.
-- Included here so schema.sql is complete and re-runnable on fresh DBs.

alter table tasks
  add column if not exists sub_project_id uuid references sub_projects(id) on delete set null;
