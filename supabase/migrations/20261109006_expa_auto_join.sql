-- Migration 077: signing in with EXPA puts you in your LC or MC, with your role.
--
-- No invite code or member code: EXPA already says where someone holds a
-- position and which one. At sign-in the server works out their placement
-- (src/lib/expa-profile.ts placementFromExpa) and stores it with their EXPA
-- profile, which only the server writes. join_from_expa() then:
--
--   * finds the LC by its EXPA id, or the first time by name and country
--     (LC names are unique per country) and remembers the id;
--     the MC by its EXPA id, or by country (one MC per country);
--   * creates their profile from EXPA (name, photo, country) if they have none;
--   * adds them: LCP → president, LCVP → VP (leading their department if it
--     has no VP yet), anyone else with a position → member, in the department
--     of their function; MCP → MCP, anyone else on the MC → MC member.
--
-- Only on first joining: roles the president changes later stay as they set
-- them. When the LC or MC isn't on the app yet, nothing is created here: an
-- LCP or MCP sets it up as before, everyone else waits for them.
--
-- Grants are written out: some projects don't expose new objects automatically.

alter table projects add column if not exists expa_lc_id text;
alter table mcs      add column if not exists expa_mc_id text;
create unique index if not exists projects_expa_lc_idx on projects (expa_lc_id) where expa_lc_id is not null;
create unique index if not exists mcs_expa_mc_idx      on mcs (expa_mc_id)      where expa_mc_id is not null;

-- The EXPA ids decide who joins where, so nobody sets them by hand: only
-- join_from_expa() and this trigger do. An LC or MC created by someone who is
-- its LCP or MCP on EXPA gets their office's id right away.

-- The EXPA office id of the caller's own placement, when it's this kind and role.
create or replace function _expa_office_of(p_user uuid, p_kind text, p_role text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(profile #>> '{placement,expaId}', '') from expa_connections
  where user_id = p_user and p_user = auth.uid() and profile #>> '{placement,kind}' = p_kind and profile #>> '{placement,role}' = p_role;
$$;

revoke execute on function _expa_office_of(uuid, text, text) from public, anon;
grant  execute on function _expa_office_of(uuid, text, text) to authenticated;

-- Runs as the caller (not security definer), so current_user tells the API
-- apart from our own functions.
create or replace function _expa_entity_ids()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_lc boolean := tg_table_name = 'projects';
  v_id text;
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'UPDATE' then
      if v_lc then new.expa_lc_id := old.expa_lc_id; else new.expa_mc_id := old.expa_mc_id; end if;
      return new;
    end if;
    if v_lc then new.expa_lc_id := null; else new.expa_mc_id := null; end if;
  end if;
  if tg_op <> 'INSERT' then return new; end if;

  if v_lc then
    if new.expa_lc_id is null and not coalesce(new.is_demo, false) then
      v_id := _expa_office_of(new.owner_id, 'lc', 'president');
      if v_id is not null and _expa_id_free('lc', v_id) then new.expa_lc_id := v_id; end if;
    end if;
  elsif new.expa_mc_id is null then
    v_id := _expa_office_of(new.created_by, 'mc', 'mcp');
    if v_id is not null and _expa_id_free('mc', v_id) then new.expa_mc_id := v_id; end if;
  end if;
  return new;
end;
$$;

-- Not yet taken by another LC or MC (which the caller may not be able to see).
create or replace function _expa_id_free(p_kind text, p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when p_kind = 'lc' then not exists (select 1 from projects where expa_lc_id = p_id)
              else not exists (select 1 from mcs where expa_mc_id = p_id) end;
$$;

revoke execute on function _expa_id_free(text, text) from public, anon;
grant  execute on function _expa_id_free(text, text) to authenticated;

drop trigger if exists trg_projects_expa_lc_id on projects;
create trigger trg_projects_expa_lc_id before insert or update of expa_lc_id on projects
  for each row execute function _expa_entity_ids();
drop trigger if exists trg_mcs_expa_mc_id on mcs;
create trigger trg_mcs_expa_mc_id before insert or update of expa_mc_id on mcs
  for each row execute function _expa_entity_ids();

-- The LC's department for a kind of work (DepartmentKey in expa-profile.ts):
-- by the products it runs, else by name, since presidents rename them.
create or replace function _expa_department(p_project_id uuid, p_key text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select d.id from departments d
  where d.project_id = p_project_id
    and case p_key
      when 'ogv' then 'ogv' = any (d.products) or d.name ~* 'outgoing.*volunteer'
      when 'ogt' then d.products && array['ogta', 'ogte'] or d.name ~* 'outgoing.*(talent|teacher)'
      when 'igv' then 'igv' = any (d.products) or d.name ~* 'incoming.*volunteer'
      when 'igt' then d.products && array['igta', 'igte'] or d.name ~* 'incoming.*(talent|teacher)'
      when 'mkt' then d.name ~* 'marketing|brand|communication'
      when 'tm'  then d.name ~* 'talent management|people|human'
      when 'fin' then d.is_finance or d.name ~* 'financ|legal'
      when 'bd'  then d.name ~* 'business development|partnership'
      else false
    end
  order by d.sort_order
  limit 1;
$$;

revoke execute on function _expa_department(uuid, text) from public, anon, authenticated;

create or replace function join_from_expa(p_timezone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  jsonb;
  v_pl       jsonb;
  v_kind     text;
  v_expa     text;
  v_name     text;
  v_country  text;
  v_role     text;
  v_target   uuid;
  v_title    text;
  v_dep      uuid;
  v_full     text;
  v_parts    text[];
  v_photo    text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select profile into v_profile from expa_connections where user_id = v_uid;
  v_pl := v_profile -> 'placement';
  if v_pl is null or jsonb_typeof(v_pl) <> 'object' then
    return jsonb_build_object('status', 'none');
  end if;
  v_kind    := v_pl ->> 'kind';
  v_expa    := nullif(trim(v_pl ->> 'expaId'), '');
  v_name    := nullif(trim(v_pl ->> 'name'), '');
  v_country := upper(nullif(trim(v_pl ->> 'country'), ''));
  if v_country !~ '^[A-Z]{2}$' then v_country := null; end if;
  v_role    := v_pl ->> 'role';

  -- Find the LC or MC.
  if v_kind = 'lc' then
    if v_role is null or v_role not in ('president', 'vp', 'member') then v_role := 'member'; end if;
    if v_expa is not null then
      select id, name into v_target, v_title from projects where expa_lc_id = v_expa;
    end if;
    if v_target is null and v_country is not null and lc_name_key(v_name) <> '' then
      select p.id, p.name into v_target, v_title from projects p
      where p.country_code = v_country and not coalesce(p.is_demo, false)
        and lc_name_key(p.name) = lc_name_key(v_name)
        and (p.expa_lc_id is null or v_expa is null)
      limit 1;
      if v_target is not null and v_expa is not null then
        update projects set expa_lc_id = v_expa where id = v_target and expa_lc_id is null;
      end if;
    end if;
    if v_target is null then
      return jsonb_build_object('status', case when v_role = 'president' then 'create_lc' else 'lc_missing' end,
                                'kind', 'lc', 'name', v_name);
    end if;
    if exists (select 1 from team_members where project_id = v_target and user_id = v_uid) then
      return jsonb_build_object('status', 'already', 'kind', 'lc', 'id', v_target, 'name', v_title);
    end if;
  elsif v_kind = 'mc' then
    v_role := case when v_role = 'mcp' then 'mcp' else 'member' end;
    if v_expa is not null then
      select id, name into v_target, v_title from mcs where expa_mc_id = v_expa;
    end if;
    if v_target is null and v_country is not null then
      select id, name into v_target, v_title from mcs
      where country_code = v_country and (expa_mc_id is null or v_expa is null);
      if v_target is not null and v_expa is not null then
        update mcs set expa_mc_id = v_expa where id = v_target and expa_mc_id is null;
      end if;
    end if;
    if v_target is null then
      return jsonb_build_object('status', case when v_role = 'mcp' then 'create_mc' else 'mc_missing' end,
                                'kind', 'mc', 'name', v_name);
    end if;
    if exists (select 1 from mc_members where mc_id = v_target and user_id = v_uid) then
      return jsonb_build_object('status', 'already', 'kind', 'mc', 'id', v_target, 'name', v_title);
    end if;
  else
    return jsonb_build_object('status', 'none');
  end if;

  -- Their profile, from EXPA, when they have none yet.
  v_full  := coalesce(nullif(trim(v_profile ->> 'fullName'), ''),
                      (select split_part(email, '@', 1) from auth.users where id = v_uid), 'Member');
  v_parts := regexp_split_to_array(v_full, '\s+');
  v_photo := v_profile ->> 'photoUrl';
  insert into user_profiles (id, name, role, avatar_initials, avatar_color, avatar_url, country_code)
  values (v_uid, left(v_full, 120), 'member',
          upper(left(v_parts[1], 1) || case when cardinality(v_parts) > 1 then left(v_parts[cardinality(v_parts)], 1) else '' end),
          '#B4D4E3', case when v_photo ~* '^https://' then v_photo end, v_country)
  on conflict (id) do nothing;
  if p_timezone is not null and length(p_timezone) between 1 and 64 then
    insert into user_settings (user_id, timezone) values (v_uid, p_timezone) on conflict (user_id) do nothing;
  end if;

  if v_kind = 'lc' then
    v_dep := _expa_department(v_target, v_pl ->> 'department');
    insert into team_members (project_id, user_id, role, lab_role_id, department_id)
    values (v_target, v_uid, v_role,
            (select id from lab_roles where project_id = v_target and is_system and permission_level = v_role limit 1),
            v_dep)
    on conflict (project_id, user_id) do nothing;
    if v_role = 'vp' and v_dep is not null then
      update departments set vp_user_id = v_uid where id = v_dep and vp_user_id is null;
    end if;
  else
    insert into mc_members (mc_id, user_id, role) values (v_target, v_uid, v_role) on conflict do nothing;
  end if;

  return jsonb_build_object('status', 'joined', 'kind', v_kind, 'id', v_target, 'name', v_title, 'role', v_role);
end;
$$;

revoke execute on function join_from_expa(text) from public, anon;
grant  execute on function join_from_expa(text) to authenticated;

notify pgrst, 'reload schema';
