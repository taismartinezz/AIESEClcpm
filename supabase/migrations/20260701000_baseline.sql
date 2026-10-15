-- Migration 000: Baseline for a FRESH Supabase project.
--
-- The app was originally built against a database whose early tables were created
-- by hand (schema.sql drifted and does not run on a clean Postgres). This file
-- creates every table the later migrations assume already exists, so a brand-new
-- project can be built by running supabase/migrations/* in filename order.
--
-- Rules followed here so the rest of the chain still applies cleanly:
--   * tables/columns use IF NOT EXISTS (no-op on databases that already have them)
--   * policies are created only for tables whose policies no later migration
--     creates; every policy is preceded by DROP POLICY IF EXISTS
--   * columns that later migrations add (scope, sub_project_id, …) are left to them

-- ── projects ──────────────────────────────────────────────────────────────────
create table if not exists projects (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  institution            text not null default '',
  research_type          text not null default '',
  research_participation text not null default 'private',
  owner_id               uuid not null references auth.users(id) on delete cascade,
  created_at             timestamptz not null default now()
);

-- ── user_profiles ─────────────────────────────────────────────────────────────
create table if not exists user_profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  role            text not null default 'researcher',
  institution     text,
  avatar_initials text,
  avatar_color    text default '#B4D4E3',
  avatar_url      text,
  bio             text,
  department      text,
  project_id      uuid references projects(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ── team_members ──────────────────────────────────────────────────────────────
create table if not exists team_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references user_profiles(id) on delete cascade,
  role        text not null default 'researcher',
  joined_at   timestamptz not null default now(),
  unique (project_id, user_id)
);

-- ── Membership helper ─────────────────────────────────────────────────────────
-- SECURITY DEFINER so policies can ask "is the caller a member of this project?"
-- without recursing into team_members' own RLS.
create or replace function auth_is_project_member(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from team_members
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;

-- ── sub_projects (groups inside a project) ────────────────────────────────────
-- Policies are created by migrations 001/004/007.
create table if not exists sub_projects (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  description text,
  created_by  uuid references user_profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived    boolean not null default false
);

create table if not exists sub_project_members (
  sub_project_id uuid not null references sub_projects(id) on delete cascade,
  user_id        uuid not null references user_profiles(id) on delete cascade,
  primary key (sub_project_id, user_id)
);

-- ── invite_codes ──────────────────────────────────────────────────────────────
create table if not exists invite_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  project_id    uuid not null references projects(id) on delete cascade,
  created_by    uuid not null references auth.users(id),
  used_by       uuid references auth.users(id),
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- ── tasks ─────────────────────────────────────────────────────────────────────
create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  title         text not null,
  description   text not null default '',
  status        text not null default 'todo'
                check (status in ('todo','in_progress','in_review','done')),
  priority      text not null default 'medium'
                check (priority in ('high','medium','low')),
  due_date      date,
  comments      jsonb not null default '[]',
  files         jsonb not null default '[]',
  links         jsonb not null default '[]',
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  parent_id     uuid references tasks(id) on delete cascade,
  archived      boolean not null default false,
  display_order integer not null default 0
);

create table if not exists task_assignees (
  task_id    uuid not null references tasks(id) on delete cascade,
  user_id    uuid not null references user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

-- ── journal_entries ───────────────────────────────────────────────────────────
-- `content` holds the (encrypted) entry; plaintext check-in scores are added as
-- checkin_scores by migration 026.
create table if not exists journal_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid references projects(id) on delete cascade,
  content     jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table journal_entries add column if not exists content jsonb;

-- ── bookmarks ─────────────────────────────────────────────────────────────────
-- Policies are created by migrations 001/004/011.
create table if not exists bookmarks (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  url        text not null,
  title      text not null,
  added_by   uuid references user_profiles(id) on delete set null,
  added_at   timestamptz not null default now()
);

-- ── reminders ─────────────────────────────────────────────────────────────────
create table if not exists reminders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  project_id      uuid references projects(id) on delete cascade,
  scope           text not null default 'personal' check (scope in ('personal', 'lab')),
  title           text not null,
  due_at          timestamptz,
  linked_task_id  uuid,
  linked_event_id uuid,
  email_enabled   boolean not null default false,
  sent            boolean not null default false,
  completed       boolean not null default false,
  completed_at    timestamptz,
  priority        text check (priority in ('low', 'medium', 'high')),
  recurrence      text check (recurrence in ('daily', 'weekly', 'monthly')),
  position        double precision,
  assignee_id     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ── notifications / activity_feed / posts ─────────────────────────────────────
-- RLS for notifications and activity_feed is enabled by migration 022.
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,
  title      text,
  body       text,
  related_id uuid,
  link_to    text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists activity_feed (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  action_type text not null,
  item_name   text,
  item_type   text,
  from_status text,
  to_status   text,
  created_at  timestamptz not null default now()
);

create table if not exists lab_wins (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_id  uuid not null references user_profiles(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

create table if not exists opportunities (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_id  uuid not null references user_profiles(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

-- ── Legacy modules (Literature, Scheduling) ──────────────────────────────────
-- The UI for these was removed, but historical migrations still alter these
-- tables, so they must exist for the chain to run. No policies: RLS on, no access.
create table if not exists literature_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  library     text not null default 'lab',
  type        text not null default 'article',
  title       text not null,
  authors     text[] not null default '{}',
  year        int,
  journal     text,
  doi         text,
  abstract    text,
  tags        text[] not null default '{}',
  status      text not null default 'unread',
  rating      int not null default 0,
  notes       text not null default '',
  files       jsonb not null default '[]',
  collections text[] not null default '{}',
  related_ids text[] not null default '{}',
  user_id     uuid references auth.users(id) on delete set null,
  added_by    uuid references auth.users(id),
  added_at    timestamptz not null default now()
);

create table if not exists lit_annotations (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references literature_items(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete cascade,
  text       text not null default '',
  comment    text not null default '',
  page_ref   text,
  page_number int,
  bbox       jsonb,
  parent_id  uuid references lit_annotations(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists events (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title      text not null,
  date       date not null,
  time       time,
  created_at timestamptz not null default now()
);

-- ── Row-level security ────────────────────────────────────────────────────────
alter table projects         enable row level security;
alter table user_profiles    enable row level security;
alter table team_members     enable row level security;
alter table invite_codes     enable row level security;
alter table tasks            enable row level security;
alter table task_assignees   enable row level security;
alter table journal_entries  enable row level security;
alter table reminders        enable row level security;
alter table lab_wins         enable row level security;
alter table opportunities    enable row level security;
alter table literature_items enable row level security;
alter table lit_annotations  enable row level security;
alter table events           enable row level security;

-- projects
drop policy if exists "project members can read" on projects;
create policy "project members can read" on projects
  for select using (auth.uid() = owner_id or auth_is_project_member(id));
drop policy if exists "owner can insert own project" on projects;
create policy "owner can insert own project" on projects
  for insert with check (auth.uid() = owner_id);
drop policy if exists "owner can update own project" on projects;
create policy "owner can update own project" on projects
  for update using (auth.uid() = owner_id);

-- user_profiles
drop policy if exists "user can read own profile" on user_profiles;
create policy "user can read own profile" on user_profiles
  for select using (auth.uid() = id);
drop policy if exists "same-project members can read profiles" on user_profiles;
create policy "same-project members can read profiles" on user_profiles
  for select using (
    exists (
      select 1 from team_members b
      where b.user_id = user_profiles.id and auth_is_project_member(b.project_id)
    )
  );
drop policy if exists "user can upsert own profile" on user_profiles;
create policy "user can upsert own profile" on user_profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- team_members
drop policy if exists "members can read team" on team_members;
create policy "members can read team" on team_members
  for select using (user_id = auth.uid() or auth_is_project_member(project_id));
drop policy if exists "user can insert own membership" on team_members;
create policy "user can insert own membership" on team_members
  for insert with check (auth.uid() = user_id);

-- invite_codes (SELECT is handled by migration 022)
drop policy if exists "pi can insert invite code" on invite_codes;
create policy "pi can insert invite code" on invite_codes
  for insert with check (auth.uid() = created_by);
drop policy if exists "user can claim unused code" on invite_codes;
create policy "user can claim unused code" on invite_codes
  for update using (used_by is null) with check (auth.uid() = used_by);

-- tasks (SELECT / INSERT are created by migration 004)
drop policy if exists "project members can update tasks" on tasks;
create policy "project members can update tasks" on tasks
  for update using (auth_is_project_member(project_id));
drop policy if exists "project members can delete tasks" on tasks;
create policy "project members can delete tasks" on tasks
  for delete using (auth_is_project_member(project_id));

-- task_assignees
drop policy if exists "project members manage task assignees" on task_assignees;
create policy "project members manage task assignees" on task_assignees
  for all using (
    exists (select 1 from tasks t where t.id = task_assignees.task_id and auth_is_project_member(t.project_id))
  ) with check (
    exists (select 1 from tasks t where t.id = task_assignees.task_id and auth_is_project_member(t.project_id))
  );

-- journal_entries: strictly private to the author
drop policy if exists "user owns journal entries" on journal_entries;
create policy "user owns journal entries" on journal_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- reminders (SELECT is created by migration 004)
drop policy if exists "reminders insert" on reminders;
create policy "reminders insert" on reminders
  for insert with check (auth.uid() = user_id);
drop policy if exists "reminders update" on reminders;
create policy "reminders update" on reminders
  for update using (
    auth.uid() = user_id
    or auth.uid() = assignee_id
    or (scope = 'lab' and auth_is_project_member(project_id))
  );
drop policy if exists "reminders delete" on reminders;
create policy "reminders delete" on reminders
  for delete using (auth.uid() = user_id);

-- lab_wins / opportunities
drop policy if exists "members read wins" on lab_wins;
create policy "members read wins" on lab_wins
  for select using (auth_is_project_member(project_id));
drop policy if exists "members post wins" on lab_wins;
create policy "members post wins" on lab_wins
  for insert with check (auth.uid() = author_id and auth_is_project_member(project_id));
drop policy if exists "author deletes wins" on lab_wins;
create policy "author deletes wins" on lab_wins
  for delete using (auth.uid() = author_id);

drop policy if exists "members read opportunities" on opportunities;
create policy "members read opportunities" on opportunities
  for select using (auth_is_project_member(project_id));
drop policy if exists "members post opportunities" on opportunities;
create policy "members post opportunities" on opportunities
  for insert with check (auth.uid() = author_id and auth_is_project_member(project_id));
drop policy if exists "author deletes opportunities" on opportunities;
create policy "author deletes opportunities" on opportunities
  for delete using (auth.uid() = author_id);
