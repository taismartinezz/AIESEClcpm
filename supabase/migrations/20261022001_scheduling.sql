-- Migration 047: Scheduling is back: availability and meeting proposals.
--
-- The Scheduling page (team availability, finding a time, proposing meetings,
-- the LC calendar) was hidden in migration 028's clean-up; schedule_events
-- stayed. These two tables only ever existed in the original app's database,
-- so they are created here.
--
--   user_availability   each person's free half-hour slots per week, for the
--                       whole LC (sub_project_id = all-zero uuid) or a group.
--                       Everyone in the LC reads them; you write your own.
--   meeting_proposals   "can we meet Tue 18:00?" with invitees' answers.
--                       Visible to the LC; the proposer edits or deletes it,
--                       invitees record their answer.

create table if not exists user_availability (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  user_id        uuid not null references user_profiles(id) on delete cascade,
  sub_project_id uuid not null default '00000000-0000-0000-0000-000000000000',   -- all-zero = whole LC
  slots          jsonb not null default '[]' check (jsonb_typeof(slots) = 'array'),
  updated_at     timestamptz not null default now(),
  unique (project_id, user_id, sub_project_id)
);

create table if not exists meeting_proposals (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  proposer_id      uuid not null references user_profiles(id) on delete cascade,
  title            text not null check (length(trim(title)) > 0),
  description      text,
  proposed_date    date not null,
  proposed_time    text not null check (proposed_time ~ '^\d{2}:\d{2}$'),
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 600),
  invitee_ids      uuid[] not null default '{}',
  responses        jsonb not null default '[]' check (jsonb_typeof(responses) = 'array'),
  created_at       timestamptz not null default now()
);

create index if not exists meeting_proposals_project_idx on meeting_proposals (project_id, proposed_date);

-- Invitees may only change the answers; everything else is the proposer's.
create or replace function _meeting_proposal_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() <> old.proposer_id
     and (new.title, new.description, new.proposed_date, new.proposed_time, new.duration_minutes, new.invitee_ids, new.proposer_id, new.project_id)
         is distinct from (old.title, old.description, old.proposed_date, old.proposed_time, old.duration_minutes, old.invitee_ids, old.proposer_id, old.project_id) then
    raise exception 'Only the person who proposed the meeting can change it';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_meeting_proposal_guard on meeting_proposals;
create trigger trg_meeting_proposal_guard before update on meeting_proposals
  for each row execute function _meeting_proposal_guard();

alter table user_availability enable row level security;
alter table meeting_proposals enable row level security;

drop policy if exists "lc members see availability" on user_availability;
create policy "lc members see availability" on user_availability
  for select using (auth_is_project_member(project_id));
drop policy if exists "own availability" on user_availability;
create policy "own availability" on user_availability
  for all using (user_id = auth.uid()) with check (user_id = auth.uid() and auth_is_project_member(project_id));

drop policy if exists "lc members see proposals" on meeting_proposals;
create policy "lc members see proposals" on meeting_proposals
  for select using (auth_is_project_member(project_id));
drop policy if exists "members propose meetings" on meeting_proposals;
create policy "members propose meetings" on meeting_proposals
  for insert with check (proposer_id = auth.uid() and auth_is_project_member(project_id));
drop policy if exists "proposer or invitee updates" on meeting_proposals;
create policy "proposer or invitee updates" on meeting_proposals
  for update using (proposer_id = auth.uid() or auth.uid() = any (invitee_ids))
  with check (auth_is_project_member(project_id));
drop policy if exists "proposer deletes" on meeting_proposals;
create policy "proposer deletes" on meeting_proposals
  for delete using (proposer_id = auth.uid());

notify pgrst, 'reload schema';
