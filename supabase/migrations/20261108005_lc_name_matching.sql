-- Migration 068: LC name matching for every alphabet, and no race.
--
-- 1. lc_name_key() knew only Western European accents, so "Eskişehir" and
--    "Eskisehir" were different LCs, and names in other scripts were dropped
--    entirely. Now: lower case, decompose (NFD) and drop every accent mark,
--    map the letters that don't decompose (ı ł ø æ œ ß đ ð þ ħ), drop filler
--    words, and keep letters and digits of any script ("Москва" stays).
--    Mirrored by lcNameKey() in src/lib/lcNames.ts; a test checks they agree.
-- 2. Two people creating the same LC at the same moment could both get past
--    the check. The trigger now takes a lock per country and name first, so
--    the second waits, then sees the first and is refused.
--
-- (Migration 20261108004 is left for the MC handover.)

create or replace function lc_name_key(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
           regexp_replace(
             replace(replace(replace(replace(
               translate(
                 regexp_replace(normalize(lower(coalesce(p_name, '')), NFD), '[\u0300-\u036f]', '', 'g'),
                 'ıłøđðħŀ', 'iloddhl'),
               'æ', 'ae'), 'œ', 'oe'), 'ß', 'ss'), 'þ', 'th'),
             '\m(aiesec|in|at|en|em|de|del|da|do|of|the|lc)\M', '', 'g'),
           '[^[:alnum:]]+', '', 'g');
$$;

create or replace function _projects_unique_lc_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key   text;
  v_other text;
begin
  v_key := lc_name_key(new.name);
  if new.country_code is null or coalesce(new.is_demo, false) or v_key = '' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and v_key = lc_name_key(old.name)
     and new.country_code is not distinct from old.country_code then
    return new;
  end if;
  -- One at a time per country and name, until this transaction ends: a second
  -- identical LC created at the same moment waits here, then finds this one.
  perform pg_advisory_xact_lock(hashtextextended('lc:' || new.country_code || ':' || v_key, 0));
  select p.name into v_other
  from projects p
  where p.id <> new.id
    and p.country_code = new.country_code
    and not coalesce(p.is_demo, false)
    and lc_name_key(p.name) = v_key
  limit 1;
  if v_other is not null then
    raise exception '% is already set up. Ask its LCP for an invite to join it.', v_other;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
