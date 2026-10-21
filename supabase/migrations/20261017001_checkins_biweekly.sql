-- Migration 034: Check-ins get their own table and a two-week cadence.
--
--   * checkins: one row per person, per LC, per check-in period. Owner-only RLS;
--     answers can be changed until the period ends. Journal entries no longer
--     carry scores (journal_entries.checkin_scores is kept for history).
--   * projects.checkin_period_weeks: 2 (default, every two weeks) or 1 (weekly).
--     Periods are anchored to Monday 2024-01-01 so every LC's fortnights line up
--     and never shift.
--   * Exec Pulse / Member Pulse now aggregate per period over the last 8 periods
--     (16 weeks at the default cadence). Same role checks, thresholds,
--     suppression and opt-out as migration 030.
--   * The check-in reminder is due on the Friday of each period's last week and
--     rolls forward one period when completed or when the check-in is submitted.

-- ── 1. Cadence ────────────────────────────────────────────────────────────────

alter table projects add column if not exists checkin_period_weeks integer not null default 2;
alter table projects drop constraint if exists projects_checkin_period_weeks_check;
alter table projects add constraint projects_checkin_period_weeks_check check (checkin_period_weeks in (1, 2));

-- First day (a Monday) of the check-in period containing p_at.
create or replace function checkin_period_start(p_project_id uuid, p_at timestamptz default now())
returns date
language sql
security definer
stable
set search_path = public
as $$
  with cfg as (
    select coalesce((select checkin_period_weeks from projects where id = p_project_id), 2) * 7 as days
  )
  select (date '2024-01-01'
          + (floor((date_trunc('week', p_at)::date - date '2024-01-01')::numeric / cfg.days) * cfg.days)::integer)
  from cfg;
$$;

-- ── 2. Check-ins ─────────────────────────────────────────────────────────────

create table if not exists checkins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  period_start date not null,
  scores       jsonb not null check (jsonb_typeof(scores) = 'array' and jsonb_array_length(scores) > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, project_id, period_start)
);

create index if not exists checkins_project_period_idx on checkins (project_id, period_start);

-- People record the current period only, and can edit it until it ends.
-- (Without an auth.uid(): service role, seed scripts: a given date is
-- normalised to its period, so history can be imported.)
create or replace function _checkins_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current date := checkin_period_start(new.project_id, now());
begin
  if not exists (select 1 from team_members where project_id = new.project_id and user_id = new.user_id) then
    raise exception 'Check-ins are only for members of this LC';
  end if;
  if auth.uid() is not null then
    if tg_op = 'UPDATE' and old.period_start <> v_current then
      raise exception 'That check-in period has ended';
    end if;
    new.period_start := v_current;
  else
    new.period_start := checkin_period_start(new.project_id, coalesce(new.period_start::timestamptz, now()));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_checkins_guard on checkins;
create trigger trg_checkins_guard
  before insert or update on checkins
  for each row execute function _checkins_guard();

alter table checkins enable row level security;

drop policy if exists "own check-ins only" on checkins;
create policy "own check-ins only" on checkins
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Copy existing journal check-ins (latest entry per person per period).
insert into checkins (user_id, project_id, period_start, scores, created_at)
select distinct on (je.user_id, je.project_id, checkin_period_start(je.project_id, je.created_at))
       je.user_id, je.project_id, checkin_period_start(je.project_id, je.created_at), je.checkin_scores, je.created_at
from   journal_entries je
join   team_members tm on tm.project_id = je.project_id and tm.user_id = je.user_id
where  je.project_id is not null
  and  jsonb_typeof(je.checkin_scores) = 'array'
  and  jsonb_array_length(je.checkin_scores) > 0
order  by je.user_id, je.project_id, checkin_period_start(je.project_id, je.created_at), je.created_at desc
on conflict (user_id, project_id, period_start) do nothing;

-- ── 3. Pulse functions on periods ────────────────────────────────────────────
-- Return columns change (week_start → period_start), so drop and recreate.

drop function if exists get_member_pulse(uuid, uuid);
drop function if exists get_exec_pulse(uuid);
drop function if exists _pulse_scores(uuid, text, integer);

create function _pulse_scores(p_project_id uuid, p_role text, p_periods integer)
returns table (user_id uuid, department_id uuid, period_start date, question_id text, score numeric)
language sql
security definer
stable
set search_path = public
as $$
  with population as (
    select tm.user_id, tm.department_id
    from   team_members tm
    left join user_settings us on us.user_id = tm.user_id
    where  tm.project_id = p_project_id
      and  tm.role = p_role
      and  coalesce(us.wellbeing_opted_in, true)
  ),
  cfg as (
    select coalesce(checkin_disabled_questions, '{}') as disabled,
           checkin_period_weeks * 7 as days
    from   projects where id = p_project_id
  )
  select c.user_id,
         pop.department_id,
         c.period_start,
         elem->>'questionId',
         avg((elem->>'score')::numeric)
  from   checkins c
  join   population pop on pop.user_id = c.user_id
  cross join cfg
  cross join lateral jsonb_array_elements(c.scores) as elem
  where  c.project_id = p_project_id
    and  c.period_start >= checkin_period_start(p_project_id, now()) - (p_periods - 1) * cfg.days
    and  (elem->>'score') ~ '^[1-5]$'
    and  not ((elem->>'questionId') = any (cfg.disabled))
  group  by 1, 2, 3, 4;
$$;

revoke execute on function _pulse_scores(uuid, text, integer) from public, anon, authenticated;

create function get_member_pulse(p_project_id uuid, p_department_id uuid default null)
returns table (
  department_id    uuid,
  period_start     date,
  question_id      text,
  avg_score        numeric,
  respondent_count integer,
  suppressed       boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role          text := lc_role(p_project_id);
  v_min           integer;
  v_days          integer;
  v_allowed       uuid[];
  v_include_total boolean;
begin
  if v_role = 'president' then
    select array_agg(d.id) into v_allowed from departments d where d.project_id = p_project_id;
    v_include_total := p_department_id is null;
  elsif v_role = 'vp' then
    select array_agg(x) into v_allowed from led_department_ids(p_project_id) as x;
    v_include_total := false;
  else
    return;
  end if;

  if p_department_id is not null then
    if not (p_department_id = any (coalesce(v_allowed, '{}'::uuid[]))) then
      return;
    end if;
    v_allowed := array[p_department_id];
  end if;

  select min_wellbeing_respondents, checkin_period_weeks * 7 into v_min, v_days from projects where id = p_project_id;

  return query
  with scores as (
    select * from _pulse_scores(p_project_id, 'member', 8)
  ),
  periods as (
    select generate_series(
      checkin_period_start(p_project_id, now()) - 7 * v_days,
      checkin_period_start(p_project_id, now()),
      make_interval(days => v_days)
    )::date as period_start
  ),
  groups as (
    select g.id as department_id from unnest(coalesce(v_allowed, '{}'::uuid[])) as g(id)
    union all
    select null::uuid where v_include_total
  ),
  counts as (
    select g.department_id, p.period_start,
           (select count(distinct s.user_id)
              from scores s
             where s.period_start = p.period_start
               and (g.department_id is null or s.department_id = g.department_id))::integer as n
    from groups g cross join periods p
  ),
  agg as (
    select g.department_id, s.period_start, s.question_id, avg(s.score) as avg_score
    from groups g
    join scores s on (g.department_id is null or s.department_id = g.department_id)
    group by 1, 2, 3
  )
  select c.department_id, c.period_start, a.question_id, round(a.avg_score, 2), c.n, false
  from   counts c
  join   agg a on a.department_id is not distinct from c.department_id and a.period_start = c.period_start
  where  c.n >= v_min
  union all
  select c.department_id, c.period_start, null::text, null::numeric, null::integer, true
  from   counts c
  where  c.n < v_min
  order  by 1 nulls first, 2, 3;
end;
$$;

create function get_exec_pulse(p_project_id uuid)
returns table (
  period_start     date,
  question_id      text,
  avg_score        numeric,
  respondent_count integer,
  suppressed       boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_min  integer;
  v_days integer;
begin
  if not is_lc_president(p_project_id) then
    return;
  end if;

  select min_exec_respondents, checkin_period_weeks * 7 into v_min, v_days from projects where id = p_project_id;

  return query
  with scores as (
    select * from _pulse_scores(p_project_id, 'vp', 8)
  ),
  periods as (
    select generate_series(
      checkin_period_start(p_project_id, now()) - 7 * v_days,
      checkin_period_start(p_project_id, now()),
      make_interval(days => v_days)
    )::date as period_start
  ),
  counts as (
    select p.period_start,
           (select count(distinct s.user_id) from scores s where s.period_start = p.period_start)::integer as n
    from periods p
  ),
  agg as (
    select s.period_start, s.question_id, avg(s.score) as avg_score
    from scores s
    group by 1, 2
  )
  select c.period_start, a.question_id, round(a.avg_score, 2), c.n, false
  from   counts c
  join   agg a on a.period_start = c.period_start
  where  c.n >= v_min
  union all
  select c.period_start, null::text, null::numeric, null::integer, true
  from   counts c
  where  c.n < v_min
  order  by 1, 2;
end;
$$;

revoke execute on function get_member_pulse(uuid, uuid) from public, anon;
revoke execute on function get_exec_pulse(uuid)         from public, anon;
grant  execute on function get_member_pulse(uuid, uuid) to authenticated;
grant  execute on function get_exec_pulse(uuid)         to authenticated;

-- ── 4. Reminder follows the cadence ──────────────────────────────────────────

-- Friday 17:00 UTC of the last week of the period containing p_from, or of the
-- next period if that moment has passed.
create or replace function _next_checkin_due(p_project_id uuid, p_from timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (select checkin_period_weeks * 7 as days from projects where id = p_project_id),
  due as (
    select checkin_period_start(p_project_id, p_from)::timestamptz
           + make_interval(days => cfg.days - 3, hours => 17) as at, cfg.days
    from cfg
  )
  select case when at > p_from then at else at + make_interval(days => days) end from due;
$$;

create or replace function _sync_checkin_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from reminders where user_id = old.user_id and project_id = old.project_id and kind = 'weekly_checkin';
    return old;
  end if;
  if new.role in ('vp', 'member') then
    insert into reminders (user_id, project_id, scope, title, due_at, recurrence, kind, email_enabled, sent, completed)
    values (new.user_id, new.project_id, 'personal', 'Check-in', _next_checkin_due(new.project_id, now()),
            'weekly', 'weekly_checkin', false, false, false)
    on conflict (user_id, project_id) where kind = 'weekly_checkin' do nothing;
  else
    delete from reminders where user_id = new.user_id and project_id = new.project_id and kind = 'weekly_checkin';
  end if;
  return new;
end;
$$;

create or replace function _roll_checkin_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'weekly_checkin' and new.completed and not old.completed then
    new.completed    := false;
    new.completed_at := null;
    new.due_at       := _next_checkin_due(new.project_id, greatest(coalesce(old.due_at, now()), now()) + interval '1 second');
  end if;
  return new;
end;
$$;

-- Submitting (or updating) a check-in moves the reminder to the next period.
create or replace function _checkin_recorded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Due date inside the period after the one just answered.
  v_next timestamptz := _next_checkin_due(
    new.project_id,
    (new.period_start + (select checkin_period_weeks * 7 from projects where id = new.project_id))::timestamptz);
begin
  update reminders
     set due_at = v_next
   where user_id = new.user_id and project_id = new.project_id and kind = 'weekly_checkin' and due_at < v_next;
  return new;
end;
$$;

drop trigger if exists trg_checkin_recorded on checkins;
create trigger trg_checkin_recorded
  after insert or update on checkins
  for each row execute function _checkin_recorded();

-- Journal entries no longer drive the reminder.
drop trigger if exists trg_checkin_submitted on journal_entries;
drop function if exists _checkin_submitted();
drop function if exists _next_checkin_due(timestamptz);

-- Retitle and re-time existing check-in reminders for the new cadence.
update reminders r
   set title = 'Check-in', due_at = _next_checkin_due(r.project_id, now())
 where r.kind = 'weekly_checkin' and not r.completed;

notify pgrst, 'reload schema';
