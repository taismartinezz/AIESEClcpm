-- Migration 035: Exchange pipeline and term goals (KPIs).
--
--   departments.products   which AIESEC products a department runs
--                          (ogv, ogta, ogte, igv, igta, igte).
--   exchanges              one exchange participant (EP) moving through
--                          Signed up → Applied → Accepted → Approved →
--                          Realized → Finished. Holds personal data, so only
--                          the president, the department running the product
--                          (its VP and members) and the person who owns the
--                          exchange can see it.
--   goals                  term targets per department (or the whole LC).
--                          'pipeline' goals count exchanges that reached a
--                          stage in the goal's date range; 'manual' goals are
--                          updated by hand. Every LC member can see goals and
--                          their progress (via goal_progress(), which returns
--                          counts only); the president and the department's
--                          VP manage them.

-- ── 1. Products per department ───────────────────────────────────────────────

alter table departments add column if not exists products text[] not null default '{}';
alter table departments drop constraint if exists departments_products_check;
alter table departments add constraint departments_products_check
  check (products <@ array['ogv', 'ogta', 'ogte', 'igv', 'igta', 'igte']);

update departments set products = case name
    when 'Outgoing Global Volunteer'      then array['ogv']
    when 'Outgoing Global Talent/Teacher' then array['ogta', 'ogte']
    when 'Incoming Global Volunteer'      then array['igv']
    when 'Incoming Global Talent/Teacher' then array['igta', 'igte']
  end
where products = '{}'
  and name in ('Outgoing Global Volunteer', 'Outgoing Global Talent/Teacher',
               'Incoming Global Volunteer', 'Incoming Global Talent/Teacher');

create or replace function seed_default_departments(p_project_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into departments (project_id, name, color, is_finance, sort_order, products)
  values
    (p_project_id, 'Outgoing Global Volunteer',       '#F85A40', false, 1, array['ogv']),
    (p_project_id, 'Outgoing Global Talent/Teacher',  '#0CB9C1', false, 2, array['ogta', 'ogte']),
    (p_project_id, 'Incoming Global Volunteer',       '#D9442B', false, 3, array['igv']),
    (p_project_id, 'Incoming Global Talent/Teacher',  '#0A8F96', false, 4, array['igta', 'igte']),
    (p_project_id, 'Marketing',                       '#FFC845', false, 5, '{}'),
    (p_project_id, 'Talent Management',               '#00C16E', false, 6, '{}'),
    (p_project_id, 'Finance & Legality',              '#037EF3', true,  7, '{}'),
    (p_project_id, 'Business Development',            '#7552CC', false, 8, '{}')
  on conflict (project_id, name) do nothing;
$$;
revoke execute on function seed_default_departments(uuid) from public, anon, authenticated;

-- ── 2. Exchanges ──────────────────────────────────────────────────────────────

create table if not exists exchanges (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  product       text not null check (product in ('ogv', 'ogta', 'ogte', 'igv', 'igta', 'igte')),
  stage         text not null default 'signed_up'
                check (stage in ('signed_up', 'applied', 'accepted', 'approved', 'realized', 'finished')),
  person_name   text not null check (length(trim(person_name)) > 0),
  email         text,
  phone         text,
  opportunity   text,          -- project or position
  host_entity   text,          -- host LC / country (outgoing) or home LC / country (incoming)
  expa_id       text,
  expa_url      text check (expa_url is null or expa_url ~* '^https://'),
  department_id uuid references departments(id) on delete set null,
  owner_id      uuid references user_profiles(id) on delete set null,
  notes         text,
  signed_up_at  date not null default current_date,
  applied_at    date,
  accepted_at   date,
  approved_at   date,
  realized_at   date,
  finished_at   date,
  created_by    uuid references user_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists exchanges_project_product_idx on exchanges (project_id, product, stage);

-- Fill in the department running the product, date every stage reached, and
-- keep owner / department inside the LC.
create or replace function _exchanges_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank integer := array_position(array['signed_up', 'applied', 'accepted', 'approved', 'realized', 'finished'], new.stage);
begin
  if new.department_id is null then
    select id into new.department_id from departments
    where project_id = new.project_id and new.product = any (products)
    order by sort_order limit 1;
  elsif not exists (select 1 from departments where id = new.department_id and project_id = new.project_id) then
    raise exception 'Department does not belong to this LC';
  end if;
  if new.owner_id is not null and not exists (
    select 1 from team_members where project_id = new.project_id and user_id = new.owner_id
  ) then
    raise exception 'The owner must be a member of this LC';
  end if;

  -- Reaching a stage implies the earlier ones; keep dates already recorded.
  if v_rank >= 2 then new.applied_at  := coalesce(new.applied_at,  current_date); end if;
  if v_rank >= 3 then new.accepted_at := coalesce(new.accepted_at, current_date); end if;
  if v_rank >= 4 then new.approved_at := coalesce(new.approved_at, current_date); end if;
  if v_rank >= 5 then new.realized_at := coalesce(new.realized_at, current_date); end if;
  if v_rank >= 6 then new.finished_at := coalesce(new.finished_at, current_date); end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_exchanges_guard on exchanges;
create trigger trg_exchanges_guard
  before insert or update on exchanges
  for each row execute function _exchanges_guard();

-- Who may see / work on an exchange.
create or replace function can_work_on_exchange(p_project_id uuid, p_department_id uuid, p_owner_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_lc_president(p_project_id)
      or p_owner_id = auth.uid()
      or exists (
           select 1 from team_members tm
           where tm.project_id = p_project_id and tm.user_id = auth.uid()
             and p_department_id is not null and tm.department_id = p_department_id
         )
      or p_department_id in (select led_department_ids(p_project_id));
$$;

alter table exchanges enable row level security;

drop policy if exists "department sees its exchanges" on exchanges;
create policy "department sees its exchanges" on exchanges
  for select using (can_work_on_exchange(project_id, department_id, owner_id));

drop policy if exists "department adds exchanges" on exchanges;
create policy "department adds exchanges" on exchanges
  for insert with check (
    auth_is_project_member(project_id)
    and created_by = auth.uid()
    and (
      is_lc_president(project_id)
      or exists (
        select 1 from departments d
        where d.project_id = exchanges.project_id and exchanges.product = any (d.products)
          and (d.vp_user_id = auth.uid()
               or d.id = (select tm.department_id from team_members tm where tm.project_id = exchanges.project_id and tm.user_id = auth.uid()))
      )
    )
  );

drop policy if exists "department updates exchanges" on exchanges;
create policy "department updates exchanges" on exchanges
  for update using (can_work_on_exchange(project_id, department_id, owner_id))
  with check (can_work_on_exchange(project_id, department_id, owner_id));

drop policy if exists "president or department VP deletes exchanges" on exchanges;
create policy "president or department VP deletes exchanges" on exchanges
  for delete using (is_lc_president(project_id) or department_id in (select led_department_ids(project_id)));

-- ── 3. Goals ──────────────────────────────────────────────────────────────────

create table if not exists goals (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  department_id uuid references departments(id) on delete cascade,   -- null = whole LC
  title         text not null check (length(trim(title)) > 0),
  metric        text not null check (metric in ('manual', 'pipeline')),
  product       text check (product in ('ogv', 'ogta', 'ogte', 'igv', 'igta', 'igte')),
  stage         text check (stage in ('signed_up', 'applied', 'accepted', 'approved', 'realized', 'finished')),
  target        numeric not null check (target > 0),
  current_value numeric not null default 0 check (current_value >= 0),
  unit          text,
  starts_on     date not null,
  ends_on       date not null,
  created_by    uuid references user_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint goals_dates check (ends_on >= starts_on),
  constraint goals_pipeline_needs_stage check (metric = 'manual' or stage is not null)
);

create index if not exists goals_project_idx on goals (project_id, ends_on);

create or replace function _goals_guard()
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
  return new;
end;
$$;

drop trigger if exists trg_goals_guard on goals;
create trigger trg_goals_guard
  before insert or update on goals
  for each row execute function _goals_guard();

alter table goals enable row level security;

drop policy if exists "lc members see goals" on goals;
create policy "lc members see goals" on goals
  for select using (auth_is_project_member(project_id));

drop policy if exists "president or department VP manages goals" on goals;
create policy "president or department VP manages goals" on goals
  for all using (
    is_lc_president(project_id) or (department_id is not null and department_id in (select led_department_ids(project_id)))
  ) with check (
    is_lc_president(project_id) or (department_id is not null and department_id in (select led_department_ids(project_id)))
  );

-- Progress for every goal in the LC: counts only, so members see KPI progress
-- without seeing the exchange participants behind it.
create or replace function goal_progress(p_project_id uuid)
returns table (goal_id uuid, current numeric)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  if not auth_is_project_member(p_project_id) then
    return;
  end if;
  return query
  select g.id,
         case when g.metric = 'manual' then g.current_value
         else (
           select count(*)::numeric
           from   exchanges e
           where  e.project_id = g.project_id
             and  (g.product is not null and e.product = g.product
                   or g.product is null and (g.department_id is null or e.department_id = g.department_id))
             and  (case g.stage
                     when 'signed_up' then e.signed_up_at
                     when 'applied'   then e.applied_at
                     when 'accepted'  then e.accepted_at
                     when 'approved'  then e.approved_at
                     when 'realized'  then e.realized_at
                     when 'finished'  then e.finished_at
                   end) between g.starts_on and g.ends_on
         ) end
  from goals g
  where g.project_id = p_project_id;
end;
$$;

revoke execute on function goal_progress(uuid) from public, anon;
grant  execute on function goal_progress(uuid) to authenticated;

notify pgrst, 'reload schema';
