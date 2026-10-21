-- Migration 002: Add sub-project scope to tasks, bookmarks, reminders, scheduling.
-- Follows the same pattern as Literature's `library`/`scope` + FK columns.
-- All ADD COLUMN statements use IF NOT EXISTS for idempotency.
-- Existing rows default to their current lab/personal behavior: no data is lost.

-- ── Tasks ─────────────────────────────────────────────────────────────────────
-- sub_project_id was pre-existing in the live DB (reconciled in migration 001).
-- scope: existing tasks default to 'lab': no behavioral change for current data.

alter table tasks
  add column if not exists scope text not null
    check (scope in ('lab', 'project', 'personal'))
    default 'lab';

-- ── Bookmarks ─────────────────────────────────────────────────────────────────
-- scope: existing bookmarks default to 'lab'.

alter table bookmarks
  add column if not exists scope text not null
    check (scope in ('lab', 'project', 'personal'))
    default 'lab',
  add column if not exists sub_project_id uuid
    references sub_projects(id) on delete set null;

-- ── Reminders ─────────────────────────────────────────────────────────────────
-- scope ('personal', 'lab') already exists: constraint unchanged.
-- sub_project_id added for future sub-project-targeted reminders.

alter table reminders
  add column if not exists sub_project_id uuid
    references sub_projects(id) on delete set null;

-- ── Scheduling: schedule_events ───────────────────────────────────────────────
-- The live DB has a legacy `events` table (id, project_id, title, date, time,
-- created_at) that was never promoted to the full schedule_events schema.
-- The app code already queries `schedule_events`, so we create it now with the
-- full schema plus sub_project_id, then migrate legacy rows (scope='lab',
-- created_by=null since the legacy table didn't track it).

create table if not exists schedule_events (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  title          text not null,
  date           date not null,
  time           time,
  end_time       time,
  scope          text not null check (scope in ('lab', 'personal', 'project')) default 'lab',
  created_by     uuid references user_profiles(id) on delete set null,
  description    text,
  sub_project_id uuid references sub_projects(id) on delete set null,
  created_at     timestamptz not null default now()
);

alter table schedule_events enable row level security;

create policy "members can read lab events and own personal events" on schedule_events
  for select using (
    (scope = 'lab' and exists (
      select 1 from team_members tm
      where tm.project_id = schedule_events.project_id and tm.user_id = auth.uid()
    ))
    or (scope = 'personal' and auth.uid() = created_by)
  );

create policy "project members can insert schedule_events" on schedule_events
  for insert with check (
    exists (
      select 1 from team_members tm
      where tm.project_id = schedule_events.project_id and tm.user_id = auth.uid()
    )
  );

create policy "creator can update own schedule_events" on schedule_events
  for update using (auth.uid() = created_by);

create policy "creator can delete own schedule_events" on schedule_events
  for delete using (auth.uid() = created_by);

-- Migrate existing rows from legacy `events` table.
-- time column in events is text; cast to time.
-- created_by is null since the legacy table did not record it.
insert into schedule_events (id, project_id, title, date, time, scope, created_at)
select
  id,
  project_id,
  title,
  date,
  case when time is not null then time::time else null end,
  'lab',
  coalesce(created_at, now())
from events
on conflict (id) do nothing;
