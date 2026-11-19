-- Migration 079: EXPA decides where you belong and your role. No codes.
--
--   join_from_expa     at every EXPA sign-in, not only the first:
--                        * LC: department and VP / member follow EXPA (the LCP
--                          is never changed from EXPA; handing it over is a step
--                          of its own).
--                        * MC: if it isn't on the app yet, whoever signs in first
--                          sets it up from EXPA (name, country), in their own
--                          EXPA role: an MC VP Finance becomes its VP Finance,
--                          not its MCP. Signing in again brings the role in line
--                          with EXPA. An MC can be without an MCP until its MCP
--                          signs in.
--   LCs and MCs        an LC belongs to its country's MC automatically (by
--                      country), when either is set up or its country changes.
--                      The LC and member codes are no longer needed.
--
-- The role guards let join_from_expa through with a flag it sets for its own
-- transaction (app.expa_sync); API callers can't set it.

create or replace function _team_members_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level text;
  v_caller_is_president boolean;
begin
  -- Keep role (permission) and lab_role_id (title) consistent.
  if tg_op = 'INSERT' or new.lab_role_id is distinct from old.lab_role_id then
    if new.lab_role_id is not null then
      select permission_level into v_level from lab_roles
      where id = new.lab_role_id and project_id = new.project_id;
      if v_level is null then
        raise exception 'Role does not belong to this LC';
      end if;
      new.role := v_level;
    end if;
  elsif new.role is distinct from old.role then
    select id into new.lab_role_id from lab_roles
    where project_id = new.project_id and is_system and permission_level = new.role
    limit 1;
  end if;

  if tg_op = 'UPDATE' and auth.uid() is not null and not coalesce(current_setting('app.expa_sync', true), '') = 'on' then
    v_caller_is_president := exists (
      select 1 from team_members
      where project_id = new.project_id and user_id = auth.uid() and role = 'president'
    );
    -- Only the president changes roles; members may only change their own department.
    if (new.role is distinct from old.role) and not v_caller_is_president then
      raise exception 'Only the LC president can change roles';
    end if;
    if (new.department_id is distinct from old.department_id)
       and not v_caller_is_president and new.user_id <> auth.uid() then
      raise exception 'Only the LC president can move other members between departments';
    end if;
    -- Never leave an LC without a president.
    if old.role = 'president' and new.role <> 'president' and not exists (
      select 1 from team_members
      where project_id = new.project_id and role = 'president' and user_id <> new.user_id
    ) then
      raise exception 'An LC needs at least one president';
    end if;
  end if;

  if new.department_id is not null and not exists (
    select 1 from departments where id = new.department_id and project_id = new.project_id
  ) then
    raise exception 'Department does not belong to this LC';
  end if;

  return new;
end;
$$;

create or replace function mc_members_keep_an_mcp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- join_from_expa may leave an MC without an MCP until the MCP signs in with EXPA.
  if old.role = 'mcp' and not coalesce(current_setting('app.expa_sync', true), '') = 'on'
     and (tg_op = 'DELETE' or new.role <> 'mcp')
     and exists (select 1 from mcs where id = old.mc_id)         -- not when the whole MC is deleted
     and not exists (select 1 from mc_members where mc_id = old.mc_id and role = 'mcp' and user_id <> old.user_id)
  then
    raise exception 'The MC needs an MCP. Hand it over to someone on the team before you leave.';
  end if;
  if tg_op = 'DELETE' then
    -- Someone who leaves can't accept a handover any more.
    update mcs set handover_to = null, handover_offered_at = null where id = old.mc_id and handover_to = old.user_id;
    return old;
  end if;
  return new;
end;
$$;

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
  v_cur_role text;
  v_cur_dep  uuid;
  v_updated  boolean := false;
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
    select role, department_id into v_cur_role, v_cur_dep from team_members where project_id = v_target and user_id = v_uid;
    if found then
      -- Already in: department and VP / member follow EXPA. The LCP is never
      -- changed from EXPA (an LC has one, handed over on purpose).
      perform set_config('app.expa_sync', 'on', true);
      v_dep := _expa_department(v_target, v_pl ->> 'department');
      if v_dep is not null and v_dep is distinct from v_cur_dep then
        update team_members set department_id = v_dep where project_id = v_target and user_id = v_uid;
        v_updated := true;
      end if;
      if v_cur_role <> 'president' and v_role in ('vp', 'member') and v_role <> v_cur_role then
        update team_members
           set role = v_role,
               lab_role_id = (select id from lab_roles where project_id = v_target and is_system and permission_level = v_role limit 1)
         where project_id = v_target and user_id = v_uid;
        if v_role = 'member' then
          update departments set vp_user_id = null where project_id = v_target and vp_user_id = v_uid;
        end if;
        v_updated := true;
      end if;
      if v_role = 'vp' and v_cur_role <> 'president' and coalesce(v_dep, v_cur_dep) is not null then
        update departments set vp_user_id = v_uid where id = coalesce(v_dep, v_cur_dep) and vp_user_id is null;
      end if;
      perform set_config('app.expa_sync', '', true);
      return jsonb_build_object('status', 'already', 'kind', 'lc', 'id', v_target, 'name', v_title,
                                'role', case when v_cur_role = 'president' then 'president' else v_role end, 'updated', v_updated);
    end if;
  elsif v_kind = 'mc' then
    v_role := case when v_role = 'mcp' then 'mcp' when v_role = 'vp_finance' then 'vp_finance' else 'member' end;
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
    -- Not on the app yet: anyone on the MC sets it up from EXPA (no codes), in
    -- their own EXPA role. Until the MCP signs in, it can be without an MCP.
    if v_target is null then
      if v_country is null then
        return jsonb_build_object('status', 'mc_missing', 'kind', 'mc', 'name', v_name);
      end if;
      -- EXPA's office name, as "AIESEC in …" (the MCP can rename it).
      v_title := left(case when v_name ~* '^aiesec' then v_name else 'AIESEC in ' || coalesce(v_name, v_country) end, 80);
      begin
        insert into mcs (name, country_code, created_by, expa_mc_id) values (v_title, v_country, v_uid, v_expa)
        returning id into v_target;
      exception when unique_violation then
        select id, name into v_target, v_title from mcs where country_code = v_country;
      end;
    end if;
    select role into v_cur_role from mc_members where mc_id = v_target and user_id = v_uid;
    if found then
      -- Already in: the role follows EXPA (an MC finance VP who set the MC up becomes its VP Finance).
      if v_role <> v_cur_role then
        perform set_config('app.expa_sync', 'on', true);
        update mc_members set role = v_role where mc_id = v_target and user_id = v_uid;
        perform set_config('app.expa_sync', '', true);
        v_updated := true;
      end if;
      return jsonb_build_object('status', 'already', 'kind', 'mc', 'id', v_target, 'name', v_title, 'role', v_role, 'updated', v_updated);
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

-- ── An LC belongs to its country's MC ───────────────────────────────────────

create or replace function _projects_mc_by_country()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mc_id is null and new.country_code is not null and not coalesce(new.is_demo, false) then
    new.mc_id := (select id from mcs where country_code = new.country_code);
  end if;
  return new;
end;
$$;
revoke execute on function _projects_mc_by_country() from public, anon, authenticated;

drop trigger if exists trg_projects_mc_by_country on projects;
create trigger trg_projects_mc_by_country
  before insert or update of country_code on projects
  for each row execute function _projects_mc_by_country();

create or replace function _mcs_link_country_lcs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.country_code is not null then
    update projects set mc_id = new.id
     where mc_id is null and country_code = new.country_code and not coalesce(is_demo, false);
  end if;
  return new;
end;
$$;
revoke execute on function _mcs_link_country_lcs() from public, anon, authenticated;

drop trigger if exists trg_mcs_link_country_lcs on mcs;
create trigger trg_mcs_link_country_lcs
  after insert or update of country_code on mcs
  for each row execute function _mcs_link_country_lcs();

-- LCs already on the app join their country's MC now.
update projects p set mc_id = m.id
  from mcs m
 where p.mc_id is null and p.country_code = m.country_code and not coalesce(p.is_demo, false);

notify pgrst, 'reload schema';
