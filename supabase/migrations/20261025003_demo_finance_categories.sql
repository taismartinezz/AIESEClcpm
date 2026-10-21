-- Migration 056: the demo LC's sample finance entries get their categories.
--
-- "Sponsorship: Demo Bank" showed as Uncategorised although the LC has a
-- Sponsorship category: the demo seed never set category_id. New demo LCs now
-- file their entries, and existing demo LCs are fixed below.

create or replace function _categorise_demo_finance(p_lc uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update finance_entries e
     set category_id = c.id
    from finance_categories c
   where e.project_id = p_lc
     and c.project_id = p_lc
     and e.category_id is null
     and c.name = case
           when e.description ilike 'Sponsorship%' then 'Sponsorship'
           when e.description ilike 'Posters%'     then 'Marketing'
         end;
$$;
revoke execute on function _categorise_demo_finance(uuid) from public, anon, authenticated;

create or replace function create_demo_lc()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lc uuid := _create_demo_lc_base();
begin
  perform _seed_demo_people(v_lc, auth.uid());
  perform _categorise_demo_finance(v_lc);
  return v_lc;
end;
$$;

revoke execute on function create_demo_lc() from public, anon;
grant  execute on function create_demo_lc() to authenticated;

-- Demo LCs that already exist.
select _categorise_demo_finance(id) from projects where is_demo;

notify pgrst, 'reload schema';
