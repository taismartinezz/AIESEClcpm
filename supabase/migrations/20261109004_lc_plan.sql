-- Migration 075: the LC's plan (the planning template's Intro, EB Identity,
-- Team Understanding and LC Calendar tabs).
--
--   lc_identity     one per LC: team name, vision, values, non-negotiable
--                   rules, ambition, headline goals, the EB's main channel
--                   and links to the other tools it uses.
--   lc_swot         strengths, weaknesses, opportunities and threats, each
--                   tagged with the areas it affects; lc_identity.swot_takeaways
--                   holds what the EB takes from it.
--   lc_battles      each month's key priorities ("battles"), with who owns them.
--
-- Everyone in the LC reads them; the president and VPs write them.
-- Grants are written out: some projects don't expose new objects automatically.

create table if not exists lc_identity (
  project_id      uuid primary key references projects(id) on delete cascade,
  team_name       text check (team_name is null or length(team_name) <= 120),
  vision          text check (vision is null or length(vision) <= 2000),
  values          text[] not null default '{}',
  rules           text[] not null default '{}',
  ambition        text check (ambition is null or length(ambition) <= 2000),
  headline_goals  text check (headline_goals is null or length(headline_goals) <= 2000),
  main_channel    text check (main_channel is null or length(main_channel) <= 200),
  tool_links      jsonb not null default '[]'::jsonb,     -- [{ label, url }]
  swot_takeaways  text check (swot_takeaways is null or length(swot_takeaways) <= 4000),
  updated_by      uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at      timestamptz not null default now(),
  constraint lc_identity_lists check (cardinality(values) <= 20 and cardinality(rules) <= 30)
);

create table if not exists lc_swot (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  kind        text not null check (kind in ('strength', 'weakness', 'opportunity', 'threat')),
  body        text not null check (length(trim(body)) between 1 and 500),
  areas       text[] not null default '{}',               -- LCP, MXP, oGX, iGX, MKT, FIN, BD…
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists lc_battles (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  title       text not null check (length(trim(title)) between 1 and 200),
  owner_id    uuid references user_profiles(id) on delete set null,
  done        boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists lc_swot_project_idx    on lc_swot (project_id, kind);
create index if not exists lc_battles_project_idx on lc_battles (project_id, month);

alter table lc_identity enable row level security;
alter table lc_swot     enable row level security;
alter table lc_battles  enable row level security;
grant select, insert, update, delete on lc_identity, lc_swot, lc_battles to authenticated;
grant select, insert, update, delete on lc_identity, lc_swot, lc_battles to service_role;

drop policy if exists "lc members read identity" on lc_identity;
create policy "lc members read identity" on lc_identity for select using (auth_is_project_member(project_id));
drop policy if exists "lc execs write identity" on lc_identity;
create policy "lc execs write identity" on lc_identity for all using (is_lc_exec(project_id)) with check (is_lc_exec(project_id));

drop policy if exists "lc members read swot" on lc_swot;
create policy "lc members read swot" on lc_swot for select using (auth_is_project_member(project_id));
drop policy if exists "lc execs write swot" on lc_swot;
create policy "lc execs write swot" on lc_swot for all using (is_lc_exec(project_id)) with check (is_lc_exec(project_id));

drop policy if exists "lc members read battles" on lc_battles;
create policy "lc members read battles" on lc_battles for select using (auth_is_project_member(project_id));
drop policy if exists "lc execs write battles" on lc_battles;
create policy "lc execs write battles" on lc_battles for all using (is_lc_exec(project_id)) with check (is_lc_exec(project_id));

-- The owner of a battle can tick it off too.
drop policy if exists "battle owners tick them off" on lc_battles;
create policy "battle owners tick them off" on lc_battles for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- A battle's owner must be in the LC.
create or replace function _lc_battles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is not null and not exists (select 1 from team_members where project_id = new.project_id and user_id = new.owner_id) then
    raise exception 'The owner must be a member of this LC';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_lc_battles_guard on lc_battles;
create trigger trg_lc_battles_guard before insert or update on lc_battles for each row execute function _lc_battles_guard();

notify pgrst, 'reload schema';
