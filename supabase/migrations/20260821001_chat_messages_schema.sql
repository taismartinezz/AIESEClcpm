-- Migration 025: chat_messages full schema + missing columns
--
-- Diagnosis: chat_messages was created directly in the DB with a minimal schema
-- (id, channel, sender_id, content, created_at, thread_parent_id). The client
-- selects deleted_at, is_pinned, mentioned_user_ids, attachments, and
-- thread_last_replier_id — none of which exist, causing a 400 on every fetch.
--
-- This migration is idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.

-- ── chat_messages ─────────────────────────────────────────────────────────────

create table if not exists chat_messages (
  id                   uuid primary key default gen_random_uuid(),
  channel              text not null,
  sender_id            uuid not null references auth.users(id) on delete cascade,
  content              text not null default '',
  created_at           timestamptz not null default now(),
  thread_parent_id     uuid references chat_messages(id) on delete cascade,
  deleted_at           timestamptz,
  is_pinned            boolean not null default false,
  mentioned_user_ids   uuid[] not null default '{}',
  attachments          jsonb not null default '[]',
  thread_last_replier_id uuid references auth.users(id) on delete set null
);

-- Add missing columns to the existing table (no-ops if already present)
alter table chat_messages
  add column if not exists thread_parent_id     uuid references chat_messages(id) on delete cascade,
  add column if not exists deleted_at           timestamptz,
  add column if not exists is_pinned            boolean not null default false,
  add column if not exists mentioned_user_ids   uuid[] not null default '{}',
  add column if not exists attachments          jsonb not null default '[]',
  add column if not exists thread_last_replier_id uuid references auth.users(id) on delete set null;

-- Indexes already exist in DB; skipped to avoid false 42703 errors from Supabase.
-- chat_messages_channel_created_at: (channel, created_at)
-- chat_messages_thread_parent_id:   (thread_parent_id) WHERE thread_parent_id IS NOT NULL

alter table chat_messages enable row level security;

-- Lab members can read messages in channels they belong to.
-- Channel key format: lab:<project_id> | dm:<uid1>:<uid2> | project:<sub_project_id>
drop policy if exists "chat_messages_member_select" on chat_messages;
create policy "chat_messages_member_select"
  on chat_messages for select to authenticated
  using (
    -- lab channel: user is a lab member
    (channel like 'lab:%' and exists (
      select 1 from team_members tm
      where tm.project_id = regexp_replace(channel, '^lab:', '')::uuid
        and tm.user_id = auth.uid()
    ))
    -- dm channel: user is one of the two participants (uid sorted, colon-separated)
    or (channel like 'dm:%' and auth.uid()::text = any(string_to_array(
      regexp_replace(channel, '^dm:', ''), ':'
    )))
    -- project channel: user is a lab member of the parent project
    or (channel like 'project:%' and exists (
      select 1 from sub_projects sp
      join team_members tm on tm.project_id = sp.project_id
      where sp.id = regexp_replace(channel, '^project:', '')::uuid
        and tm.user_id = auth.uid()
    ))
  );

drop policy if exists "chat_messages_member_insert" on chat_messages;
create policy "chat_messages_member_insert"
  on chat_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      (channel like 'lab:%' and exists (
        select 1 from team_members tm
        where tm.project_id = regexp_replace(channel, '^lab:', '')::uuid
          and tm.user_id = auth.uid()
      ))
      or (channel like 'dm:%' and auth.uid()::text = any(string_to_array(
        regexp_replace(channel, '^dm:', ''), ':'
      )))
      or (channel like 'project:%' and exists (
        select 1 from sub_projects sp
        join team_members tm on tm.project_id = sp.project_id
        where sp.id = regexp_replace(channel, '^project:', '')::uuid
          and tm.user_id = auth.uid()
      ))
    )
  );

drop policy if exists "chat_messages_own_update" on chat_messages;
create policy "chat_messages_own_update"
  on chat_messages for update to authenticated
  using (sender_id = auth.uid() or exists (
    select 1 from team_members tm
    where tm.user_id = auth.uid() and tm.role = 'pi'
  ));

drop policy if exists "chat_messages_own_delete" on chat_messages;
create policy "chat_messages_own_delete"
  on chat_messages for delete to authenticated
  using (sender_id = auth.uid());

-- ── message_reactions ────────────────────────────────────────────────────────
-- One row per (message, user, emoji). Already exists in prod — safe IF NOT EXISTS.

create table if not exists message_reactions (
  message_id uuid not null references chat_messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null,
  primary key (message_id, user_id, emoji)
);

alter table message_reactions enable row level security;

drop policy if exists "message_reactions_select" on message_reactions;
create policy "message_reactions_select"
  on message_reactions for select to authenticated
  using (true);

drop policy if exists "message_reactions_insert" on message_reactions;
create policy "message_reactions_insert"
  on message_reactions for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "message_reactions_delete" on message_reactions;
create policy "message_reactions_delete"
  on message_reactions for delete to authenticated
  using (user_id = auth.uid());

-- ── chat_read_state ───────────────────────────────────────────────────────────
-- Already exists in prod — safe IF NOT EXISTS.

create table if not exists chat_read_state (
  user_id     uuid not null references auth.users(id) on delete cascade,
  channel     text not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel)
);

alter table chat_read_state enable row level security;

drop policy if exists "chat_read_state_own" on chat_read_state;
create policy "chat_read_state_own"
  on chat_read_state for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
