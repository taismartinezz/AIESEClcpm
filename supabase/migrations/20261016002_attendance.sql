-- Migration 032: Attendance — LC events and who attended them.
--
--   lc_events          every LC member can see the event list; the president
--                      and VPs create, edit and delete events.
--   event_attendance   logged by the president or a VP (members never check
--                      themselves in). Visibility:
--                        member    → only their own attendance
--                        VP        → members of departments they lead (+ their
--                                    own rows and rows they recorded)
--                        president → everyone

create table if not exists lc_events (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  type          text not null check (type in ('local_event', 'local_conference', 'national_conference',
                                              'international_conference', 'info_session', 'other')),
  starts_on     date not null,
  ends_on       date not null,
  location      text,
  department_id uuid references departments(id) on delete set null,
  created_by    uuid references user_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint lc_events_dates check (ends_on >= starts_on)
);

create index if not exists lc_events_project_date_idx on lc_events (project_id, starts_on desc);

create table if not exists event_attendance (
  event_id    uuid not null references lc_events(id) on delete cascade,
  user_id     uuid not null references user_profiles(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,  -- copied from the event, for RLS
  recorded_by uuid references user_profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists event_attendance_user_idx on event_attendance (project_id, user_id);

-- Keep project_id in step with the event and only allow LC members as attendees.
create or replace function _event_attendance_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select project_id into new.project_id from lc_events where id = new.event_id;
  if new.project_id is null then
    raise exception 'Event not found';
  end if;
  if not exists (select 1 from team_members where project_id = new.project_id and user_id = new.user_id) then
    raise exception 'Attendees must be members of this LC';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_event_attendance_guard on event_attendance;
create trigger trg_event_attendance_guard
  before insert or update on event_attendance
  for each row execute function _event_attendance_guard();

create or replace function _lc_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.department_id is not null and not exists (
    select 1 from departments where id = new.department_id and project_id = new.project_id
  ) then
    raise exception 'Department does not belong to this LC';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_lc_events_guard on lc_events;
create trigger trg_lc_events_guard
  before insert or update on lc_events
  for each row execute function _lc_events_guard();

-- Is p_user a member of a department the caller leads (as VP) in p_project?
create or replace function in_led_department(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from team_members tm
    where tm.project_id = p_project_id
      and tm.user_id = p_user_id
      and tm.department_id in (select led_department_ids(p_project_id))
  );
$$;

alter table lc_events        enable row level security;
alter table event_attendance enable row level security;

drop policy if exists "lc members see events" on lc_events;
create policy "lc members see events" on lc_events
  for select using (auth_is_project_member(project_id));

drop policy if exists "exec creates events" on lc_events;
create policy "exec creates events" on lc_events
  for insert with check (is_lc_exec(project_id) and created_by = auth.uid());

drop policy if exists "exec edits events" on lc_events;
create policy "exec edits events" on lc_events
  for update using (is_lc_exec(project_id)) with check (is_lc_exec(project_id));

drop policy if exists "exec deletes events" on lc_events;
create policy "exec deletes events" on lc_events
  for delete using (is_lc_exec(project_id));

drop policy if exists "attendance visibility by role" on event_attendance;
create policy "attendance visibility by role" on event_attendance
  for select using (
    user_id = auth.uid()
    or is_lc_president(project_id)
    or (is_lc_exec(project_id) and (recorded_by = auth.uid() or in_led_department(project_id, user_id)))
  );

drop policy if exists "exec logs attendance" on event_attendance;
create policy "exec logs attendance" on event_attendance
  for insert with check (
    is_lc_exec((select e.project_id from lc_events e where e.id = event_id))
    and recorded_by = auth.uid()
  );

drop policy if exists "exec removes attendance" on event_attendance;
create policy "exec removes attendance" on event_attendance
  for delete using (is_lc_exec(project_id));

notify pgrst, 'reload schema';
