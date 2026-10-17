-- Migration 040: Member lifecycle (Talent Management).
--
--   recruits             recruitment intake: people who applied to join the LC,
--                        moving Applied → Interview → Offer → Joined (or
--                        Rejected / Withdrawn). Personal data: the exec board
--                        only.
--   onboarding_steps     the LC's onboarding checklist (seeded with five steps,
--                        edited by the exec board; a step can be limited to one
--                        department).
--   member_onboarding    which steps each member has done. Members tick their
--                        own; the president and the member's VP can tick too.
--   team_members         term_start / term_end per member, set with
--                        set_member_term() by the president or the member's VP.
--   user_profiles        last_seen_at, refreshed by touch_last_seen() when the
--                        app opens.
--   member_activity()    inactivity signals per member for the president (all)
--                        and VPs (their departments): last seen, events attended
--                        vs held, tabling no-shows, overdue tasks. Deliberately
--                        NOT check-in participation: the check-in promises that
--                        nobody can see who answered.

-- ── 1. Recruitment intake ────────────────────────────────────────────────────

create table if not exists recruits (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  email          text,
  phone          text,
  source         text,                 -- tabling, info session, social media, referral, form…
  department_id  uuid references departments(id) on delete set null,   -- department they're interested in
  stage          text not null default 'applied'
                 check (stage in ('applied', 'interview', 'offer', 'joined', 'rejected', 'withdrawn')),
  interview_at   timestamptz,
  notes          text,
  owner_id       uuid references user_profiles(id) on delete set null,
  applied_on     date not null default current_date,
  created_by     uuid references user_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists recruits_project_stage_idx on recruits (project_id, stage);
create unique index if not exists recruits_project_email_key on recruits (project_id, lower(email)) where email is not null;

create or replace function _recruits_guard()
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
  if new.owner_id is not null and not exists (
    select 1 from team_members where project_id = new.project_id and user_id = new.owner_id
  ) then
    raise exception 'The owner must be a member of this LC';
  end if;
  new.email := nullif(lower(trim(new.email)), '');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_recruits_guard on recruits;
create trigger trg_recruits_guard
  before insert or update on recruits
  for each row execute function _recruits_guard();

alter table recruits enable row level security;

drop policy if exists "exec manages recruits" on recruits;
create policy "exec manages recruits" on recruits
  for all using (is_lc_exec(project_id)) with check (is_lc_exec(project_id));

-- ── 2. Onboarding checklist ──────────────────────────────────────────────────

create table if not exists onboarding_steps (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  title         text not null check (length(trim(title)) > 0),
  description   text,
  department_id uuid references departments(id) on delete cascade,   -- null = every new member
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists member_onboarding (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references user_profiles(id) on delete cascade,
  step_id    uuid not null references onboarding_steps(id) on delete cascade,
  done_at    timestamptz not null default now(),
  done_by    uuid references user_profiles(id) on delete set null,
  primary key (user_id, step_id)
);

create or replace function seed_default_onboarding_steps(p_project_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into onboarding_steps (project_id, title, description, sort_order)
  select p_project_id, s.title, s.descr, s.ord
  from (values
    ('Meet your VP',                    'A first 1:1 with the VP of your department.', 1),
    ('Join the LC chat',                'Say hi in the LC channel in Chat.', 2),
    ('Read the LC handbook',            'It is in the LC Drive, in Handover or Templates.', 3),
    ('Attend your first LC meeting',    null, 4),
    ('Do your first check-in',          'About a minute, every two weeks. Only averages are shared.', 5)
  ) as s(title, descr, ord)
  where not exists (select 1 from onboarding_steps where project_id = p_project_id);
$$;
revoke execute on function seed_default_onboarding_steps(uuid) from public, anon, authenticated;

create or replace function _seed_lc_onboarding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_default_onboarding_steps(new.id);
  return new;
end;
$$;

drop trigger if exists trg_seed_lc_onboarding on projects;
create trigger trg_seed_lc_onboarding
  after insert on projects
  for each row execute function _seed_lc_onboarding();

select seed_default_onboarding_steps(p.id) from projects p;

create or replace function _member_onboarding_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select project_id into new.project_id from onboarding_steps where id = new.step_id;
  if not exists (select 1 from team_members where project_id = new.project_id and user_id = new.user_id) then
    raise exception 'Onboarding is for members of this LC';
  end if;
  new.done_by := coalesce(auth.uid(), new.done_by);
  return new;
end;
$$;

drop trigger if exists trg_member_onboarding_guard on member_onboarding;
create trigger trg_member_onboarding_guard
  before insert on member_onboarding
  for each row execute function _member_onboarding_guard();

alter table onboarding_steps  enable row level security;
alter table member_onboarding enable row level security;

drop policy if exists "lc members see onboarding steps" on onboarding_steps;
create policy "lc members see onboarding steps" on onboarding_steps
  for select using (auth_is_project_member(project_id));

drop policy if exists "exec manages onboarding steps" on onboarding_steps;
create policy "exec manages onboarding steps" on onboarding_steps
  for all using (is_lc_exec(project_id)) with check (is_lc_exec(project_id));

-- Who may see / tick a member's onboarding: the member, the president, their VP.
create or replace function can_manage_member(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select p_user_id = auth.uid()
      or is_lc_president(p_project_id)
      or (lc_role(p_project_id) = 'vp' and in_led_department(p_project_id, p_user_id));
$$;

drop policy if exists "member, VP or president sees onboarding" on member_onboarding;
create policy "member, VP or president sees onboarding" on member_onboarding
  for select using (can_manage_member(project_id, user_id));

drop policy if exists "member, VP or president ticks onboarding" on member_onboarding;
create policy "member, VP or president ticks onboarding" on member_onboarding
  for insert with check (
    can_manage_member((select s.project_id from onboarding_steps s where s.id = step_id), user_id)
  );

drop policy if exists "member, VP or president unticks onboarding" on member_onboarding;
create policy "member, VP or president unticks onboarding" on member_onboarding
  for delete using (can_manage_member(project_id, user_id));

-- ── 3. Term dates ────────────────────────────────────────────────────────────

alter table team_members
  add column if not exists term_start date,
  add column if not exists term_end   date;

alter table team_members drop constraint if exists team_members_term_dates;
alter table team_members add constraint team_members_term_dates
  check (term_end is null or term_start is null or term_end >= term_start);

create or replace function set_member_term(p_project_id uuid, p_user_id uuid, p_start date, p_end date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_lc_president(p_project_id) or (lc_role(p_project_id) = 'vp' and in_led_department(p_project_id, p_user_id))) then
    raise exception 'Only the president or the member''s VP can set term dates';
  end if;
  update team_members set term_start = p_start, term_end = p_end
   where project_id = p_project_id and user_id = p_user_id;
  if not found then
    raise exception 'Member not found';
  end if;
end;
$$;

revoke execute on function set_member_term(uuid, uuid, date, date) from public, anon;
grant  execute on function set_member_term(uuid, uuid, date, date) to authenticated;

-- ── 4. Last seen ─────────────────────────────────────────────────────────────

alter table user_profiles add column if not exists last_seen_at timestamptz;

create or replace function touch_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update user_profiles set last_seen_at = now()
   where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
$$;

revoke execute on function touch_last_seen() from public, anon;
grant  execute on function touch_last_seen() to authenticated;

-- ── 5. Activity signals ──────────────────────────────────────────────────────

create or replace function member_activity(p_project_id uuid, p_days integer default 60)
returns table (
  user_id          uuid,
  department_id    uuid,
  role             text,
  term_start       date,
  term_end         date,
  last_seen_at     timestamptz,
  events_held      integer,   -- LC-wide or their department's events in the window, already started
  events_attended  integer,
  tabling_no_shows integer,
  overdue_tasks    integer,
  onboarding_done  integer,
  onboarding_total integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role text := lc_role(p_project_id);
  v_from date := current_date - p_days;
begin
  if v_role not in ('president', 'vp') then
    return;
  end if;
  return query
  select tm.user_id, tm.department_id, tm.role, tm.term_start, tm.term_end, up.last_seen_at,
         (select count(*)::int from lc_events e
           where e.project_id = p_project_id and e.starts_on between v_from and current_date
             and (e.department_id is null or e.department_id = tm.department_id)),
         (select count(*)::int from event_attendance a join lc_events e on e.id = a.event_id
           where a.project_id = p_project_id and a.user_id = tm.user_id and e.starts_on between v_from and current_date),
         (select count(*)::int from tabling_signups su join tabling_slots s on s.id = su.slot_id
           where su.project_id = p_project_id and su.user_id = tm.user_id and su.status = 'no_show'
             and s.starts_at::date >= v_from),
         (select count(*)::int from tasks t join task_assignees ta on ta.task_id = t.id
           where t.project_id = p_project_id and ta.user_id = tm.user_id and t.status <> 'done'
             and not coalesce(t.archived, false) and t.due_date < current_date),
         (select count(*)::int from member_onboarding mo where mo.project_id = p_project_id and mo.user_id = tm.user_id),
         (select count(*)::int from onboarding_steps os
           where os.project_id = p_project_id and (os.department_id is null or os.department_id = tm.department_id))
  from team_members tm
  join user_profiles up on up.id = tm.user_id
  where tm.project_id = p_project_id
    and (v_role = 'president' or in_led_department(p_project_id, tm.user_id));
end;
$$;

revoke execute on function member_activity(uuid, integer) from public, anon;
grant  execute on function member_activity(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
