-- Migration 066: no duplicate MCs or LCs.
--
-- 1. One MC per country. An MC's country is its key: a unique index (even a bug
--    can't make two), and creating an MC needs one. The app names it "AIESEC
--    in <country>". mc_in_country() lets the setup screen say "AIESEC in
--    Portugal is already set up: ask your MCP for the member code" before
--    anyone clicks Create.
-- 2. One LC per name within a country. A new LC (or a rename) whose name
--    matches another LC in the same country is refused, ignoring case, accents,
--    punctuation and filler words ("AIESEC in Lisbon" = "aiesec Lisbon").
--    Different spellings ("Lisboa") still get through; picking from EXPA's
--    LC list would close that. Demo LCs are left out. Existing duplicates
--    aren't touched: only new names are checked.
--
-- Grants are written out: some projects don't expose new objects automatically.

-- ── 1. MCs ───────────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from mcs where country_code is not null group by country_code having count(*) > 1) then
    raise exception 'Two MCs share a country. Delete or merge one first; to see them: select country_code, array_agg(name) from mcs group by 1 having count(*) > 1;';
  end if;
end $$;

create unique index if not exists mcs_one_per_country on mcs (country_code) where country_code is not null;

-- The MC already set up in a country (its name), or null.
create or replace function mc_in_country(p_country text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select name from mcs where country_code = upper(trim(p_country));
$$;

create or replace function create_mc(p_name text, p_country text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_country text := nullif(upper(trim(coalesce(p_country, ''))), '');
  v_taken   text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if v_country is null then raise exception 'Pick your MC''s country'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Give the MC a name'; end if;
  if length(trim(p_name)) > 80 then raise exception 'Keep the MC name under 80 characters'; end if;
  select name into v_taken from mcs where country_code = v_country;
  if v_taken is not null then
    raise exception '% is already set up. Ask your MCP for the member code to join it.', v_taken;
  end if;
  begin
    insert into mcs (name, country_code, created_by) values (trim(p_name), v_country, auth.uid()) returning id into v_id;
  exception when unique_violation then
    -- Someone set it up at the same moment.
    raise exception '% is already set up. Ask your MCP for the member code to join it.', (select name from mcs where country_code = v_country);
  end;
  insert into mc_members (mc_id, user_id, role) values (v_id, auth.uid(), 'mcp');
  return v_id;
end;
$$;

revoke execute on function mc_in_country(text)    from public, anon;
revoke execute on function create_mc(text, text)  from public, anon;
grant  execute on function mc_in_country(text)    to authenticated;
grant  execute on function create_mc(text, text)  to authenticated;

-- ── 2. LCs ───────────────────────────────────────────────────────────────────

-- "AIESEC in Lisbón!" → "lisbon": what two LC names are compared by.
create or replace function lc_name_key(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
           regexp_replace(
             translate(lower(coalesce(p_name, '')), 'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'),
             '\m(aiesec|in|at|en|em|de|del|da|do|of|the|lc)\M', '', 'g'),
           '[^a-z0-9]+', '', 'g');
$$;

create or replace function _projects_unique_lc_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_other text;
begin
  if new.country_code is null or coalesce(new.is_demo, false) or lc_name_key(new.name) = '' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and lc_name_key(new.name) = lc_name_key(old.name)
     and new.country_code is not distinct from old.country_code then
    return new;
  end if;
  select p.name into v_other
  from projects p
  where p.id <> new.id
    and p.country_code = new.country_code
    and not coalesce(p.is_demo, false)
    and lc_name_key(p.name) = lc_name_key(new.name)
  limit 1;
  if v_other is not null then
    raise exception '% is already set up. Ask its LCP for an invite to join it.', v_other;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_unique_lc_name on projects;
create trigger trg_projects_unique_lc_name
  before insert or update of name, country_code on projects
  for each row execute function _projects_unique_lc_name();

notify pgrst, 'reload schema';
