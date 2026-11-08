-- Migration 073: recurring routines (the planning template's "Calendar
-- suggestions"): the weekly EB meeting, SONA to the MC by the 1st, the
-- finance audit in February and September…
--
--   routines              what repeats, who does it, and why. Schedules:
--                         weekly (a weekday), biweekly (a weekday, every other
--                         week from an anchor date), monthly (a day of the
--                         month, the last day, or the first…fourth / last given
--                         weekday), optionally only in some months (quarterly,
--                         twice a year).
--   routine_occurrences   which dates already became a task, so each one is
--                         created once.
--   routine_due_on(r, d)  does routine r fall on date d?
--   run_routines(lc)      create the tasks due in the next lead_days days,
--                         assigned to the LCP, the department's VP (or the LCP
--                         when it has none) or a chosen person. The daily job
--                         runs it for every LC; an LC's exec can run it for
--                         theirs (the Routines page does, after a change).
--
-- Grants are written out: some projects don't expose new objects automatically.

create table if not exists routines (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  title            text not null check (length(trim(title)) between 1 and 200),
  why              text check (why is null or length(why) <= 1000),
  department_id    uuid references departments(id) on delete set null,
  assignee         text not null default 'department_vp' check (assignee in ('president', 'department_vp', 'person')),
  assignee_user_id uuid references user_profiles(id) on delete set null,
  freq             text not null check (freq in ('weekly', 'biweekly', 'monthly')),
  weekday          smallint check (weekday between 1 and 7),          -- ISO: 1 = Monday
  anchor           date,                                               -- biweekly: a date it falls on
  month_day        smallint check (month_day = -1 or month_day between 1 and 28),   -- -1 = last day
  nth              smallint check (nth = -1 or nth between 1 and 4),   -- with weekday: first…fourth, -1 = last
  months           smallint[] check (months is null or months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  lead_days        smallint not null default 3 check (lead_days between 0 and 30),
  active           boolean not null default true,
  template_key     text,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  constraint routines_schedule check (
    (freq = 'weekly'   and weekday is not null)
    or (freq = 'biweekly' and weekday is not null and anchor is not null and extract(isodow from anchor) = weekday)
    or (freq = 'monthly'  and ((month_day is not null and nth is null) or (nth is not null and weekday is not null and month_day is null)))
  ),
  constraint routines_person check (assignee <> 'person' or assignee_user_id is not null)
);

create index if not exists routines_project_idx on routines (project_id) where active;

create table if not exists routine_occurrences (
  routine_id uuid not null references routines(id) on delete cascade,
  due_on     date not null,
  task_id    uuid references tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (routine_id, due_on)
);

alter table routines            enable row level security;
alter table routine_occurrences enable row level security;
grant select, insert, update, delete on routines            to authenticated;
grant select                         on routine_occurrences to authenticated;
grant select, insert, update, delete on routines, routine_occurrences to service_role;

drop policy if exists "lc members read routines" on routines;
create policy "lc members read routines" on routines
  for select using (auth_is_project_member(project_id));

drop policy if exists "lc execs manage routines" on routines;
create policy "lc execs manage routines" on routines
  for all using (is_lc_exec(project_id))
  with check (is_lc_exec(project_id) and created_by = auth.uid());

drop policy if exists "lc members read routine occurrences" on routine_occurrences;
create policy "lc members read routine occurrences" on routine_occurrences
  for select using (exists (select 1 from routines r where r.id = routine_id and auth_is_project_member(r.project_id)));

create or replace function routine_due_on(r routines, d date)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case r.freq
    when 'weekly'   then extract(isodow from d) = r.weekday
    when 'biweekly' then extract(isodow from d) = r.weekday and (d - r.anchor) % 14 = 0
    when 'monthly'  then
      (r.months is null or extract(month from d)::smallint = any (r.months))
      and case
        when r.month_day = -1 then d = (date_trunc('month', d) + interval '1 month - 1 day')::date
        when r.month_day is not null then extract(day from d) = r.month_day
        when r.nth = -1 then extract(isodow from d) = r.weekday and (d + 7) > (date_trunc('month', d) + interval '1 month - 1 day')::date
        else extract(isodow from d) = r.weekday and ceil(extract(day from d) / 7.0) = r.nth
      end
    else false
  end;
$$;

create or replace function run_routines(p_project_id uuid default null, p_today date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r        routines%rowtype;
  d        date;
  v_task   uuid;
  v_who    uuid[];
  v_count  integer := 0;
begin
  -- The daily job (no signed-in user) runs every LC; a person only their own, as an exec.
  if auth.uid() is not null and (p_project_id is null or not is_lc_exec(p_project_id)) then
    raise exception 'Only the LC''s president or a VP can run its routines';
  end if;

  for r in select * from routines where active and (p_project_id is null or project_id = p_project_id) loop
    for d in select g::date from generate_series(p_today, p_today + r.lead_days, interval '1 day') as g loop
      continue when not routine_due_on(r, d);
      continue when exists (select 1 from routine_occurrences o where o.routine_id = r.id and o.due_on = d);

      v_who := case r.assignee
        when 'person' then array[r.assignee_user_id]
        when 'department_vp' then array(select vp_user_id from departments where id = r.department_id and vp_user_id is not null)
        else '{}'::uuid[] end;
      -- No VP (or no department): the LCP does it.
      if coalesce(array_length(v_who, 1), 0) = 0 then
        v_who := array(select user_id from team_members where project_id = r.project_id and role = 'president');
      end if;

      insert into tasks (project_id, title, description, due_date, department_id, created_by, scope, priority)
      values (r.project_id, r.title, coalesce(r.why, ''), d, r.department_id, r.created_by, 'lab', 'medium')
      returning id into v_task;
      insert into task_assignees (task_id, user_id)
      select v_task, u from unnest(v_who) as u
      where exists (select 1 from team_members tm where tm.project_id = r.project_id and tm.user_id = u)
      on conflict do nothing;
      insert into routine_occurrences (routine_id, due_on, task_id) values (r.id, d, v_task);
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke execute on function run_routines(uuid, date)      from public, anon;
grant  execute on function run_routines(uuid, date)      to authenticated, service_role;
revoke execute on function routine_due_on(routines, date) from public, anon;
grant  execute on function routine_due_on(routines, date) to authenticated, service_role;

notify pgrst, 'reload schema';
