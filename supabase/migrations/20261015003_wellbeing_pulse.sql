-- Migration 030: Wellbeing — Exec Pulse and Member Pulse.
--
-- Weekly check-in scores (journal_entries.checkin_scores, plaintext 1–5 values;
-- journal text stays encrypted and owner-only) feed two aggregate views:
--
--   get_exec_pulse(lc)              VPs' scores        → president only
--   get_member_pulse(lc, dept|null) members' scores    → president: every department
--                                                         + LC total (department_id null);
--                                                         VP: only departments they lead
--
-- Both are SECURITY DEFINER and check the caller's role themselves: anyone else
-- (a member, a VP asking for another department, a non-member) gets zero rows.
-- The president's own scores are never counted. A (group, week) with fewer
-- opted-in respondents than the LC's threshold comes back as one row with
-- suppressed = true and no numbers — not even the respondent count.
--
-- Also: per-LC thresholds and disabled questions, and a self-rolling
-- "Weekly check-in" reminder for every VP and member.

-- ── 1. LC settings ────────────────────────────────────────────────────────────

-- min_wellbeing_respondents (migration 024) is now the per-department threshold.
alter table projects alter column min_wellbeing_respondents set default 3;
alter table projects
  add column if not exists min_exec_respondents       integer not null default 3,
  add column if not exists checkin_disabled_questions text[]  not null default '{}';

alter table projects drop constraint if exists projects_min_wellbeing_respondents_check;
alter table projects add constraint projects_min_wellbeing_respondents_check
  check (min_wellbeing_respondents between 2 and 50);
alter table projects drop constraint if exists projects_min_exec_respondents_check;
alter table projects add constraint projects_min_exec_respondents_check
  check (min_exec_respondents between 2 and 50);

-- ── 2. The old rollups had no caller check — any signed-in user could read any
--      LC's numbers. They are superseded; close them off.
revoke execute on function get_wellbeing_rollup(uuid) from public, anon, authenticated;
revoke execute on function get_overdue_signal(uuid)   from public, anon, authenticated;

-- ── 3. Shared scoring CTE (internal) ─────────────────────────────────────────
-- One row per (respondent, week, question) with that person's average score for
-- the week, restricted to opted-in team members holding p_role in the LC, to
-- the last p_weeks weeks, and to questions the president has not disabled.

create or replace function _pulse_scores(p_project_id uuid, p_role text, p_weeks integer)
returns table (user_id uuid, department_id uuid, week_start date, question_id text, score numeric)
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
  disabled as (
    select coalesce(checkin_disabled_questions, '{}') as ids from projects where id = p_project_id
  )
  select je.user_id,
         pop.department_id,
         date_trunc('week', je.created_at)::date  as week_start,
         elem->>'questionId'                      as question_id,
         avg((elem->>'score')::numeric)           as score
  from   journal_entries je
  join   population pop on pop.user_id = je.user_id
  cross join disabled dis
  cross join lateral jsonb_array_elements(
           coalesce(je.checkin_scores, je.content->'checkin', '[]'::jsonb)
         ) as elem
  where  je.project_id = p_project_id
    and  je.created_at >= date_trunc('week', now()) - make_interval(weeks => p_weeks - 1)
    and  (elem->>'score') ~ '^[1-5]$'
    and  not ((elem->>'questionId') = any (dis.ids))
  group  by 1, 2, 3, 4;
$$;

revoke execute on function _pulse_scores(uuid, text, integer) from public, anon, authenticated;

-- ── 4. Member Pulse ───────────────────────────────────────────────────────────

create or replace function get_member_pulse(p_project_id uuid, p_department_id uuid default null)
returns table (
  department_id    uuid,      -- null = whole-LC total (president only)
  week_start       date,
  question_id      text,      -- null on suppressed rows
  avg_score        numeric,   -- null on suppressed rows
  respondent_count integer,   -- null on suppressed rows
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
    return;  -- members and outsiders see nothing
  end if;

  if p_department_id is not null then
    if not (p_department_id = any (coalesce(v_allowed, '{}'::uuid[]))) then
      return;  -- e.g. a VP asking about a department they don't lead
    end if;
    v_allowed := array[p_department_id];
  end if;

  select min_wellbeing_respondents into v_min from projects where id = p_project_id;

  return query
  with scores as (
    select * from _pulse_scores(p_project_id, 'member', 8)
  ),
  weeks as (
    select generate_series(
      date_trunc('week', now()) - interval '7 weeks',
      date_trunc('week', now()),
      interval '1 week'
    )::date as week_start
  ),
  groups as (
    select g.id as department_id from unnest(coalesce(v_allowed, '{}'::uuid[])) as g(id)
    union all
    select null::uuid where v_include_total
  ),
  counts as (
    select g.department_id, w.week_start,
           (select count(distinct s.user_id)
              from scores s
             where s.week_start = w.week_start
               and (g.department_id is null or s.department_id = g.department_id))::integer as n
    from groups g cross join weeks w
  ),
  agg as (
    select g.department_id, s.week_start, s.question_id, avg(s.score) as avg_score
    from groups g
    join scores s on (g.department_id is null or s.department_id = g.department_id)
    group by 1, 2, 3
  )
  select c.department_id, c.week_start, a.question_id, round(a.avg_score, 2), c.n, false
  from   counts c
  join   agg a on a.department_id is not distinct from c.department_id and a.week_start = c.week_start
  where  c.n >= v_min
  union all
  select c.department_id, c.week_start, null::text, null::numeric, null::integer, true
  from   counts c
  where  c.n < v_min
  order  by 1 nulls first, 2, 3;
end;
$$;

revoke execute on function get_member_pulse(uuid, uuid) from public, anon;
grant  execute on function get_member_pulse(uuid, uuid) to authenticated;

-- ── 5. Exec Pulse ─────────────────────────────────────────────────────────────

create or replace function get_exec_pulse(p_project_id uuid)
returns table (
  week_start       date,
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
  v_min integer;
begin
  if not is_lc_president(p_project_id) then
    return;  -- only the LCP sees the executive board's pulse
  end if;

  select min_exec_respondents into v_min from projects where id = p_project_id;

  return query
  with scores as (
    select * from _pulse_scores(p_project_id, 'vp', 8)
  ),
  weeks as (
    select generate_series(
      date_trunc('week', now()) - interval '7 weeks',
      date_trunc('week', now()),
      interval '1 week'
    )::date as week_start
  ),
  counts as (
    select w.week_start,
           (select count(distinct s.user_id) from scores s where s.week_start = w.week_start)::integer as n
    from weeks w
  ),
  agg as (
    select s.week_start, s.question_id, avg(s.score) as avg_score
    from scores s
    group by 1, 2
  )
  select c.week_start, a.question_id, round(a.avg_score, 2), c.n, false
  from   counts c
  join   agg a on a.week_start = c.week_start
  where  c.n >= v_min
  union all
  select c.week_start, null::text, null::numeric, null::integer, true
  from   counts c
  where  c.n < v_min
  order  by 1, 2;
end;
$$;

revoke execute on function get_exec_pulse(uuid) from public, anon;
grant  execute on function get_exec_pulse(uuid) to authenticated;

-- ── 6. Weekly check-in reminder ──────────────────────────────────────────────
-- Every VP and member gets a personal "Weekly check-in" reminder per LC, due
-- Friday 17:00 UTC. It rolls itself forward a week when completed or when the
-- person submits a check-in, so it behaves like a recurring reminder.

alter table reminders add column if not exists kind text;
create unique index if not exists reminders_one_checkin_per_lc
  on reminders (user_id, project_id) where kind = 'weekly_checkin';

-- Friday 17:00 UTC of the week containing p_from, or of the next week if that has passed.
create or replace function _next_checkin_due(p_from timestamptz)
returns timestamptz
language sql
immutable
as $$
  select case
    when date_trunc('week', p_from) + interval '4 days 17 hours' > p_from
      then date_trunc('week', p_from) + interval '4 days 17 hours'
    else date_trunc('week', p_from) + interval '11 days 17 hours'
  end;
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
    values (new.user_id, new.project_id, 'personal', 'Weekly check-in', _next_checkin_due(now()), 'weekly', 'weekly_checkin', false, false, false)
    on conflict (user_id, project_id) where kind = 'weekly_checkin' do nothing;
  else
    delete from reminders where user_id = new.user_id and project_id = new.project_id and kind = 'weekly_checkin';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_checkin_reminder on team_members;
create trigger trg_sync_checkin_reminder
  after insert or update of role or delete on team_members
  for each row execute function _sync_checkin_reminder();

-- Completing the reminder re-arms it for the following Friday.
create or replace function _roll_checkin_reminder()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'weekly_checkin' and new.completed and not old.completed then
    new.completed    := false;
    new.completed_at := null;
    new.due_at       := _next_checkin_due(greatest(coalesce(old.due_at, now()), now()) + interval '1 second');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_roll_checkin_reminder on reminders;
create trigger trg_roll_checkin_reminder
  before update of completed on reminders
  for each row execute function _roll_checkin_reminder();

-- Submitting a check-in pushes this week's reminder to next week.
create or replace function _checkin_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_id is not null and jsonb_array_length(coalesce(new.checkin_scores, '[]'::jsonb)) > 0 then
    update reminders
       set due_at = _next_checkin_due(date_trunc('week', new.created_at) + interval '7 days')
     where user_id = new.user_id
       and project_id = new.project_id
       and kind = 'weekly_checkin'
       and due_at < date_trunc('week', new.created_at) + interval '7 days';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_checkin_submitted on journal_entries;
create trigger trg_checkin_submitted
  after insert on journal_entries
  for each row execute function _checkin_submitted();

-- Backfill reminders for existing VPs and members.
insert into reminders (user_id, project_id, scope, title, due_at, recurrence, kind, email_enabled, sent, completed)
select tm.user_id, tm.project_id, 'personal', 'Weekly check-in', _next_checkin_due(now()), 'weekly', 'weekly_checkin', false, false, false
from team_members tm
where tm.role in ('vp', 'member')
on conflict (user_id, project_id) where kind = 'weekly_checkin' do nothing;

notify pgrst, 'reload schema';
