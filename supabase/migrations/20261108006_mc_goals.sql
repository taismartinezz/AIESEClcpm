-- Migration 069: targets per LC, and the signals behind "Needs attention".
--
--   mc_term_start(mc)   the MC's current term start (its term_start, or the
--                       latest 1 February), the same rule as mc_dashboard().
--   mc_lc_targets       what the MC expects from each LC this term, per product
--                       and metric (approved / realized). MC members read and
--                       set them; an LC's president reads their own LC's.
--   mc_lc_health(mc)    per linked LC, counts and dates only (never names):
--                       last approval, approvals in the last 30 days, approved
--                       exchanges waiting 60+ days to realize, last pipeline
--                       change, how many exchanges came from EXPA, and the last
--                       EXPA sync by anyone in the LC.
--
-- Grants are written out: some projects don't expose new objects automatically.

create or replace function mc_term_start(p_mc_id uuid)
returns date
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(term_start,
           case when current_date >= make_date(extract(year from current_date)::int, 2, 1)
                then make_date(extract(year from current_date)::int, 2, 1)
                else make_date(extract(year from current_date)::int - 1, 2, 1) end)
  from mcs where id = p_mc_id;
$$;

create table if not exists mc_lc_targets (
  mc_id      uuid not null references mcs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  product    text not null check (product in ('ogv', 'ogta', 'ogte', 'igv', 'igta', 'igte')),
  metric     text not null check (metric in ('approved', 'realized')),
  term_start date not null,
  target     integer not null check (target between 0 and 100000),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (mc_id, project_id, product, metric, term_start)
);

alter table mc_lc_targets enable row level security;
grant select, insert, update, delete on mc_lc_targets to authenticated;
grant select, insert, update, delete on mc_lc_targets to service_role;

drop policy if exists "mc members and the lc's president read targets" on mc_lc_targets;
create policy "mc members and the lc's president read targets" on mc_lc_targets
  for select using (is_mc_member(mc_id) or is_lc_president(project_id));

-- Is the LC linked to this MC? (MC members can't read projects themselves.)
create or replace function lc_in_mc(p_project_id uuid, p_mc_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from projects where id = p_project_id and mc_id = p_mc_id);
$$;
revoke execute on function lc_in_mc(uuid, uuid) from public, anon;
grant  execute on function lc_in_mc(uuid, uuid) to authenticated;

-- Only for LCs linked to the MC.
drop policy if exists "mc members set targets for linked lcs" on mc_lc_targets;
create policy "mc members set targets for linked lcs" on mc_lc_targets
  for insert with check (is_mc_member(mc_id) and lc_in_mc(project_id, mc_id));

drop policy if exists "mc members change targets" on mc_lc_targets;
create policy "mc members change targets" on mc_lc_targets
  for update using (is_mc_member(mc_id))
  with check (is_mc_member(mc_id) and lc_in_mc(project_id, mc_id));

drop policy if exists "mc members remove targets" on mc_lc_targets;
create policy "mc members remove targets" on mc_lc_targets
  for delete using (is_mc_member(mc_id));

create or replace function mc_lc_health(p_mc_id uuid)
returns table (
  project_id uuid, last_approved date, approved_30d integer, stuck_approved integer,
  last_activity timestamptz, from_expa integer, total integer, last_expa_sync timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  if not is_mc_member(p_mc_id) then
    return;
  end if;
  return query
  select p.id,
         (select max(e.approved_at) from exchanges e where e.project_id = p.id),
         (select count(*)::int from exchanges e where e.project_id = p.id and e.approved_at > current_date - 30),
         (select count(*)::int from exchanges e where e.project_id = p.id and e.stage = 'approved' and e.approved_at <= current_date - 60),
         (select max(e.updated_at) from exchanges e where e.project_id = p.id),
         (select count(*)::int from exchanges e where e.project_id = p.id and e.expa_id is not null),
         (select count(*)::int from exchanges e where e.project_id = p.id),
         (select max(ec.last_synced_at) from expa_connections ec join team_members tm on tm.user_id = ec.user_id where tm.project_id = p.id)
  from projects p
  where p.mc_id = p_mc_id
  order by p.name;
end;
$$;

revoke execute on function mc_term_start(uuid) from public, anon;
revoke execute on function mc_lc_health(uuid)  from public, anon;
grant  execute on function mc_term_start(uuid) to authenticated;
grant  execute on function mc_lc_health(uuid)  to authenticated;

notify pgrst, 'reload schema';
