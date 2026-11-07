-- Migration 060: country on people and LCs.
--
--   user_profiles.country_code  ISO 3166-1 alpha-2, asked in onboarding (or once
--                               afterwards), editable in Settings > Profile.
--   projects.country_code       the LC's country, set when it's created.
--   lcs_in_country(code)        names of LCs already on the app in a country,
--                               for the LC field's suggestions in onboarding.
--                               Names only; demo LCs left out.
-- Which countries are allowed is decided by the app (src/lib/aiesecCountries.ts);
-- the database only checks the format.

alter table user_profiles add column if not exists country_code text;
alter table user_profiles drop constraint if exists user_profiles_country_code_check;
alter table user_profiles add constraint user_profiles_country_code_check check (country_code is null or country_code ~ '^[A-Z]{2}$');

alter table projects add column if not exists country_code text;
alter table projects drop constraint if exists projects_country_code_check;
alter table projects add constraint projects_country_code_check check (country_code is null or country_code ~ '^[A-Z]{2}$');

create or replace function lcs_in_country(p_country text)
returns table (id uuid, name text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.name
  from projects p
  where p.country_code = upper(trim(p_country))
    and not coalesce(p.is_demo, false)
  order by p.name;
$$;

revoke execute on function lcs_in_country(text) from public, anon;
grant  execute on function lcs_in_country(text) to authenticated;

notify pgrst, 'reload schema';
