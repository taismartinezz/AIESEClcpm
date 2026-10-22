-- Migration 044: Emails to members: event invites with RSVP, reminders,
-- announcements, preferences.
--
--   lc_events        + start/end time, online link, description, and an
--                    audience: whole LC, one department, one role, or chosen
--                    people (event_invitees).
--   event_rsvps      Going / Not going. Members answer for themselves, in the
--                    app or from the email (signed link, see /api/rsvp); the
--                    exec board sees everyone's answers.
--   user_settings    email_mode: 'all' | 'digest' (weekly digest + important)
--                    | 'important' (event reminders, overdue tasks, invites).
--   projects         email_sender_name, e.g. "AIESEC at Northwestern".
--   announcements    one-off emails from the president or a VP to an audience.
--   email_log        what the reminder job already sent (service role only),
--                    so every reminder goes out once.

-- ── 1. Events: time, link, audience ──────────────────────────────────────────

alter table lc_events
  add column if not exists starts_at         timestamptz,
  add column if not exists ends_at           timestamptz,
  add column if not exists meeting_url       text,
  add column if not exists description       text,
  add column if not exists audience          text not null default 'lc',
  add column if not exists audience_role     text,
  add column if not exists invites_sent_at   timestamptz;

alter table lc_events drop constraint if exists lc_events_audience_check;
alter table lc_events add constraint lc_events_audience_check check (
  audience in ('lc', 'department', 'role', 'people')
  and (audience <> 'department' or department_id is not null)
  and (audience <> 'role' or audience_role in ('president', 'vp', 'member', 'exec'))
);
alter table lc_events drop constraint if exists lc_events_meeting_url_check;
alter table lc_events add constraint lc_events_meeting_url_check check (meeting_url is null or meeting_url ~* '^https://');

-- Old department-tagged events were meant for that department.
update lc_events set audience = 'department' where department_id is not null and audience = 'lc';

create table if not exists event_invitees (
  event_id   uuid not null references lc_events(id) on delete cascade,
  user_id    uuid not null references user_profiles(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  primary key (event_id, user_id)
);

create table if not exists event_rsvps (
  event_id     uuid not null references lc_events(id) on delete cascade,
  user_id      uuid not null references user_profiles(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  response     text not null check (response in ('going', 'not_going')),
  responded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create or replace function _event_child_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select project_id into new.project_id from lc_events where id = new.event_id;
  if new.project_id is null then raise exception 'Event not found'; end if;
  if not exists (select 1 from team_members where project_id = new.project_id and user_id = new.user_id) then
    raise exception 'Only members of this LC';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_event_invitees_guard on event_invitees;
create trigger trg_event_invitees_guard before insert or update on event_invitees
  for each row execute function _event_child_guard();
drop trigger if exists trg_event_rsvps_guard on event_rsvps;
create trigger trg_event_rsvps_guard before insert or update on event_rsvps
  for each row execute function _event_child_guard();

-- Everyone an event is for.
create or replace function event_audience(p_event_id uuid)
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select tm.user_id
  from lc_events e
  join team_members tm on tm.project_id = e.project_id
  where e.id = p_event_id
    and case e.audience
          when 'lc'         then true
          when 'department' then tm.department_id = e.department_id
                                 or exists (select 1 from departments d where d.id = e.department_id and d.vp_user_id = tm.user_id)
          when 'role'       then case e.audience_role when 'exec' then tm.role in ('president', 'vp') else tm.role = e.audience_role end
          when 'people'     then exists (select 1 from event_invitees i where i.event_id = e.id and i.user_id = tm.user_id)
        end;
$$;

alter table event_invitees enable row level security;
alter table event_rsvps    enable row level security;

drop policy if exists "invitees visible to the LC" on event_invitees;
create policy "invitees visible to the LC" on event_invitees for select using (auth_is_project_member(project_id));
drop policy if exists "exec manages invitees" on event_invitees;
create policy "exec manages invitees" on event_invitees for all
  using (is_lc_exec(project_id))
  with check (is_lc_exec((select e.project_id from lc_events e where e.id = event_id)));

drop policy if exists "own rsvp or exec" on event_rsvps;
create policy "own rsvp or exec" on event_rsvps for select using (user_id = auth.uid() or is_lc_exec(project_id));
drop policy if exists "answer your own rsvp" on event_rsvps;
create policy "answer your own rsvp" on event_rsvps for insert with check (user_id = auth.uid());
drop policy if exists "change your own rsvp" on event_rsvps;
create policy "change your own rsvp" on event_rsvps for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 2. Preferences and sender name ───────────────────────────────────────────

alter table user_settings add column if not exists email_mode text not null default 'all';
alter table user_settings drop constraint if exists user_settings_email_mode_check;
alter table user_settings add constraint user_settings_email_mode_check check (email_mode in ('all', 'digest', 'important'));

alter table projects add column if not exists email_sender_name text;
alter table projects drop constraint if exists projects_email_sender_name_check;
alter table projects add constraint projects_email_sender_name_check
  check (email_sender_name is null or (length(trim(email_sender_name)) between 2 and 60 and email_sender_name !~ '[<>"@]'));

-- ── 3. Announcements ─────────────────────────────────────────────────────────

create table if not exists announcements (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  author_id      uuid references user_profiles(id) on delete set null,
  audience       text not null default 'lc' check (audience in ('lc', 'department', 'role')),
  department_id  uuid references departments(id) on delete set null,
  audience_role  text check (audience_role in ('president', 'vp', 'member', 'exec')),
  subject        text not null check (length(trim(subject)) between 1 and 150),
  body           text not null check (length(trim(body)) between 1 and 5000),
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  sent_count     integer
);

alter table announcements enable row level security;

-- Announcements are read where they're sent (email); in the app the exec board sees the history.
drop policy if exists "exec sees announcements" on announcements;
create policy "exec sees announcements" on announcements for select using (is_lc_exec(project_id));
drop policy if exists "exec writes announcements" on announcements;
create policy "exec writes announcements" on announcements for insert
  with check (is_lc_exec(project_id) and author_id = auth.uid());

-- ── 4. Send log (reminder job) ───────────────────────────────────────────────

create table if not exists email_log (
  kind     text not null,            -- event_invite, event_24h, event_1h, task_due, task_overdue, task_overdue_vp, checkin_open, checkin_nudge, digest, announcement
  ref_id   text not null,            -- event / task / period / week / announcement id
  user_id  uuid not null references auth.users(id) on delete cascade,
  sent_at  timestamptz not null default now(),
  primary key (kind, ref_id, user_id)
);

alter table email_log enable row level security;   -- no policies: service role only

notify pgrst, 'reload schema';
