-- Migration 076: getting to know the EB (the planning template's EB member
-- profiles): per LC, each president or VP answers about their role and how
-- they work. Read by their LC only (not on user_profiles, which people from
-- shared groups outside the LC can read); written by the person themselves.

create table if not exists eb_profiles (
  project_id        uuid not null references projects(id) on delete cascade,
  user_id           uuid not null references user_profiles(id) on delete cascade,
  skills            text check (skills is null or length(skills) <= 1000),
  why_elected       text check (why_elected is null or length(why_elected) <= 1000),
  impact            text check (impact is null or length(impact) <= 1000),
  working_style     text check (working_style is null or length(working_style) <= 1000),
  frustrations      text check (frustrations is null or length(frustrations) <= 1000),
  needs_help_signs  text check (needs_help_signs is null or length(needs_help_signs) <= 1000),
  appreciation      text check (appreciation is null or length(appreciation) <= 1000),
  updated_at        timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table eb_profiles enable row level security;
grant select, insert, update, delete on eb_profiles to authenticated;
grant select, insert, update, delete on eb_profiles to service_role;

drop policy if exists "lc members read eb profiles" on eb_profiles;
create policy "lc members read eb profiles" on eb_profiles
  for select using (auth_is_project_member(project_id));

-- Your own, while you're on the LC's EB.
drop policy if exists "eb members write their own" on eb_profiles;
create policy "eb members write their own" on eb_profiles
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_lc_exec(project_id));

notify pgrst, 'reload schema';
