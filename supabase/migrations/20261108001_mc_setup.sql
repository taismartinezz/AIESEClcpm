-- Migration 064: setting up an MC, harder to get wrong.
--
-- 1. mcs.country_code: the MC's country, picked when the MCP creates it, so the
--    national view can list LCs on the app in that country that haven't
--    linked yet (lcs_in_country gives names only).
-- 2. Names: an MC name is 1-80 characters.
-- 3. Codes: the two codes are easy to mix up. Typing the LC code where the
--    member code goes (or the other way round) now says which code it was.
--
-- Grants are written out: some projects don't expose new objects automatically.

alter table mcs add column if not exists country_code text;
alter table mcs drop constraint if exists mcs_country_code_check;
alter table mcs add constraint mcs_country_code_check check (country_code is null or country_code ~ '^[A-Z]{2}$');
alter table mcs drop constraint if exists mcs_name_length;
alter table mcs add constraint mcs_name_length check (length(trim(name)) between 1 and 80) not valid;

drop function if exists create_mc(text);
create or replace function create_mc(p_name text, p_country text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Give the MC a name'; end if;
  if length(trim(p_name)) > 80 then raise exception 'Keep the MC name under 80 characters'; end if;
  insert into mcs (name, country_code, created_by)
  values (trim(p_name), nullif(upper(trim(coalesce(p_country, ''))), ''), auth.uid())
  returning id into v_id;
  insert into mc_members (mc_id, user_id, role) values (v_id, auth.uid(), 'mcp');
  return v_id;
end;
$$;

create or replace function join_mc(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into v_id from mcs where member_code = upper(trim(p_code));
  if v_id is null then
    if exists (select 1 from mcs where lc_code = upper(trim(p_code))) then
      raise exception 'That is an LC code: it is for LC presidents to link their LC. To join the MC, ask your MCP for the member code.';
    end if;
    raise exception 'No MC has that member code. Check it with your MCP.';
  end if;
  insert into mc_members (mc_id, user_id) values (v_id, auth.uid()) on conflict do nothing;
  return v_id;
end;
$$;

create or replace function link_lc_to_mc(p_project_id uuid, p_lc_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_mc mcs%rowtype;
begin
  if not is_lc_president(p_project_id) then
    raise exception 'Only the LC president can link the LC to an MC';
  end if;
  if p_lc_code is null or trim(p_lc_code) = '' then
    update projects set mc_id = null where id = p_project_id;
    return null;
  end if;
  select * into v_mc from mcs where lc_code = upper(trim(p_lc_code));
  if not found then
    if exists (select 1 from mcs where member_code = upper(trim(p_lc_code))) then
      raise exception 'That is the MC''s member code, for people on the national team. Ask your MC for the LC code.';
    end if;
    raise exception 'No MC has that LC code. Check it with your MC.';
  end if;
  update projects set mc_id = v_mc.id where id = p_project_id;
  return v_mc.name;
end;
$$;

-- The MC's linked LCs by name, for "not linked yet" (MC members only).
create or replace function mc_linked_lcs(p_mc_id uuid)
returns table (id uuid, name text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.name from projects p
  where p.mc_id = p_mc_id and is_mc_member(p_mc_id)
  order by p.name;
$$;

revoke execute on function create_mc(text, text)       from public, anon;
revoke execute on function join_mc(text)               from public, anon;
revoke execute on function link_lc_to_mc(uuid, text)   from public, anon;
revoke execute on function mc_linked_lcs(uuid)         from public, anon;
grant  execute on function create_mc(text, text)       to authenticated;
grant  execute on function join_mc(text)               to authenticated;
grant  execute on function link_lc_to_mc(uuid, text)   to authenticated;
grant  execute on function mc_linked_lcs(uuid)         to authenticated;

notify pgrst, 'reload schema';
