-- Migration 046: Member Pulse by area (Outgoing / Incoming / Support).
--
-- Small departments may never reach the privacy threshold on their own. The
-- president can also see the pulse per area, which pools departments:
-- Outgoing (oGV/oGTa/oGTe), Incoming (iGV/iGTa/iGTe) and Support (everything
-- else). The president can move a department to another area. Same
-- threshold, suppression and opt-out as the department pulse; only the
-- president can call it.

alter table departments add column if not exists pulse_area text;
alter table departments drop constraint if exists departments_pulse_area_check;
alter table departments add constraint departments_pulse_area_check check (pulse_area is null or pulse_area in ('outgoing', 'incoming', 'support'));

create or replace function department_area(p_department_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(d.pulse_area,
           case when d.products && array['ogv', 'ogta', 'ogte'] then 'outgoing'
                when d.products && array['igv', 'igta', 'igte'] then 'incoming'
                else 'support' end)
  from departments d where d.id = p_department_id;
$$;

create or replace function get_area_pulse(p_project_id uuid)
returns table (area text, period_start date, question_id text, avg_score numeric, respondent_count integer, suppressed boolean)
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
  select min_wellbeing_respondents, checkin_period_weeks * 7 into v_min, v_days from projects where id = p_project_id;

  return query
  with scores as (
    select s.*, department_area(s.department_id) as area
    from _pulse_scores(p_project_id, 'member', 8) s
    where s.department_id is not null
  ),
  periods as (
    select generate_series(
      checkin_period_start(p_project_id, now()) - 7 * v_days,
      checkin_period_start(p_project_id, now()),
      make_interval(days => v_days)
    )::date as period_start
  ),
  areas as (select unnest(array['outgoing', 'incoming', 'support']) as area),
  counts as (
    select a.area, p.period_start,
           (select count(distinct s.user_id) from scores s where s.area = a.area and s.period_start = p.period_start)::integer as n
    from areas a cross join periods p
  ),
  agg as (
    select s.area, s.period_start, s.question_id, avg(s.score) as avg_score from scores s group by 1, 2, 3
  )
  select c.area, c.period_start, a.question_id, round(a.avg_score, 2), c.n, false
  from counts c join agg a on a.area = c.area and a.period_start = c.period_start
  where c.n >= v_min
  union all
  select c.area, c.period_start, null::text, null::numeric, null::integer, true
  from counts c where c.n < v_min
  order by 1, 2, 3;
end;
$$;

revoke execute on function get_area_pulse(uuid) from public, anon;
grant  execute on function get_area_pulse(uuid) to authenticated;

notify pgrst, 'reload schema';
