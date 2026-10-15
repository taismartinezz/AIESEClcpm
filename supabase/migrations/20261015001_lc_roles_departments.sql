-- Migration 028: AIESEC Local Committee roles and departments.
--
--   * Permission levels pi / researcher  →  president / vp / member
--   * System roles "PI" → "President", "Researcher" → "Member", new "VP";
--     the academic roles (Co-PI, Postdoc, …) are folded into these
--   * Per-LC departments (seeded with the eight AIESEC defaults) +
--     team_members.department_id and tasks.department_id
--   * Role helpers used by every policy below and by later migrations
--   * Joining an LC goes through join_lc_with_code(); members can no longer
--     insert arbitrary team_members rows for themselves
--
-- Idempotent: safe to run more than once.

-- ── 1. Permission values ──────────────────────────────────────────────────────

create or replace function _drop_check_constraints(p_table text, p_column text)
returns void
language plpgsql
as $$
declare
  c record;
begin
  for c in
    select con.conname
    from   pg_constraint con
    join   pg_class rel     on rel.oid = con.conrelid
    join   pg_namespace ns  on ns.oid = rel.relnamespace
    join   pg_attribute att on att.attrelid = rel.oid and att.attnum = any (con.conkey)
    where  ns.nspname = 'public' and rel.relname = p_table
      and  con.contype = 'c' and att.attname = p_column
  loop
    execute format('alter table %I drop constraint %I', p_table, c.conname);
  end loop;
end;
$$;

select _drop_check_constraints('team_members', 'role');
select _drop_check_constraints('user_profiles', 'role');
select _drop_check_constraints('lab_roles', 'permission_level');

update team_members  set role = 'president' where role = 'pi';
update team_members  set role = 'member'    where role = 'researcher';
update user_profiles set role = 'president' where role = 'pi';
update user_profiles set role = 'member'    where role = 'researcher';
update lab_roles     set permission_level = 'president' where permission_level = 'pi';
update lab_roles     set permission_level = 'member'    where permission_level = 'researcher';

alter table team_members  alter column role set default 'member';
alter table user_profiles alter column role set default 'member';
alter table lab_roles     alter column permission_level set default 'member';

alter table team_members
  add constraint team_members_role_check check (role in ('president', 'vp', 'member'));
alter table user_profiles
  add constraint user_profiles_role_check check (role in ('president', 'vp', 'member'));
alter table lab_roles
  add constraint lab_roles_permission_level_check check (permission_level in ('president', 'vp', 'member'));

drop function _drop_check_constraints(text, text);

-- ── 2. System roles ───────────────────────────────────────────────────────────

-- Rename PI → President and Researcher → Member (skip if the new name already exists).
update lab_roles lr set name = 'President'
where lr.name = 'PI' and lr.is_system
  and not exists (select 1 from lab_roles x where x.project_id = lr.project_id and x.name = 'President');
update lab_roles lr set name = 'Member'
where lr.name = 'Researcher' and lr.is_system
  and not exists (select 1 from lab_roles x where x.project_id = lr.project_id and x.name = 'Member');

insert into lab_roles (project_id, name, permission_level, is_system)
select p.id, r.name, r.level, true
from projects p
cross join (values ('President', 'president'), ('VP', 'vp'), ('Member', 'member')) as r(name, level)
on conflict (project_id, name) do nothing;

-- Fold the academic system roles into the matching AIESEC role, then drop them.
update team_members tm
set lab_role_id = target.id
from lab_roles old
join lab_roles target
  on  target.project_id = old.project_id
  and target.is_system
  and target.name = case old.permission_level when 'president' then 'President' else 'Member' end
where tm.lab_role_id = old.id
  and old.is_system
  and old.name in ('Co-PI', 'Postdoc', 'PhD Student', 'Master''s Student',
                   'Undergraduate Researcher', 'Lab Manager');

update invite_codes ic
set lab_role_id = target.id
from lab_roles old
join lab_roles target
  on  target.project_id = old.project_id
  and target.is_system
  and target.name = case old.permission_level when 'president' then 'President' else 'Member' end
where ic.lab_role_id = old.id
  and old.is_system
  and old.name in ('Co-PI', 'Postdoc', 'PhD Student', 'Master''s Student',
                   'Undergraduate Researcher', 'Lab Manager');

delete from lab_roles
where is_system
  and name in ('Co-PI', 'Postdoc', 'PhD Student', 'Master''s Student',
               'Undergraduate Researcher', 'Lab Manager');

-- Seed system roles for every new LC.
create or replace function _seed_lc_system_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into lab_roles (project_id, name, permission_level, is_system)
  values (new.id, 'President', 'president', true),
         (new.id, 'VP',        'vp',        true),
         (new.id, 'Member',    'member',    true)
  on conflict (project_id, name) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_lc_system_roles on projects;
create trigger trg_seed_lc_system_roles
  after insert on projects
  for each row execute function _seed_lc_system_roles();

-- ── 3. Departments ────────────────────────────────────────────────────────────

create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  color       text not null default '#037EF3',
  vp_user_id  uuid references user_profiles(id) on delete set null,
  -- Marks the department whose VP is in charge of finance (Finance & Legality by
  -- default). A flag, not a name match, so the president can rename departments.
  is_finance  boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (project_id, name)
);

create index if not exists departments_project_idx on departments (project_id);
create index if not exists departments_vp_idx on departments (vp_user_id);

alter table team_members
  add column if not exists department_id uuid references departments(id) on delete set null;
alter table tasks
  add column if not exists department_id uuid references departments(id) on delete set null;

create or replace function seed_default_departments(p_project_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into departments (project_id, name, color, is_finance, sort_order)
  values
    (p_project_id, 'Outgoing Global Volunteer',       '#F85A40', false, 1),
    (p_project_id, 'Outgoing Global Talent/Teacher',  '#0CB9C1', false, 2),
    (p_project_id, 'Incoming Global Volunteer',       '#D9442B', false, 3),
    (p_project_id, 'Incoming Global Talent/Teacher',  '#0A8F96', false, 4),
    (p_project_id, 'Marketing',                       '#FFC845', false, 5),
    (p_project_id, 'Talent Management',               '#00C16E', false, 6),
    (p_project_id, 'Finance & Legality',              '#037EF3', true,  7),
    (p_project_id, 'Business Development',            '#7552CC', false, 8)
  on conflict (project_id, name) do nothing;
$$;

-- Not callable through the API; only the trigger and this migration use it.
revoke execute on function seed_default_departments(uuid) from public, anon, authenticated;

create or replace function _seed_lc_departments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_default_departments(new.id);
  return new;
end;
$$;

drop trigger if exists trg_seed_lc_departments on projects;
create trigger trg_seed_lc_departments
  after insert on projects
  for each row execute function _seed_lc_departments();

-- Backfill existing LCs that have no departments yet.
select seed_default_departments(p.id)
from projects p
where not exists (select 1 from departments d where d.project_id = p.id);

-- ── 4. Role helpers ───────────────────────────────────────────────────────────
-- SECURITY DEFINER + STABLE: safe to call from RLS without recursion.

create or replace function lc_role(p_project_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from team_members
  where project_id = p_project_id and user_id = auth.uid();
$$;

create or replace function is_lc_president(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(lc_role(p_project_id) = 'president', false);
$$;

-- President or VP (the executive board).
create or replace function is_lc_exec(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(lc_role(p_project_id) in ('president', 'vp'), false);
$$;

-- Departments the caller leads as VP in this LC.
create or replace function led_department_ids(p_project_id uuid)
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select d.id
  from   departments d
  join   team_members tm on tm.project_id = d.project_id and tm.user_id = auth.uid()
  where  d.project_id = p_project_id
    and  d.vp_user_id = auth.uid()
    and  tm.role = 'vp';
$$;

-- ── 5. team_members: role sync, guards, policies ─────────────────────────────

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

  if tg_op = 'UPDATE' and auth.uid() is not null then
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

drop trigger if exists trg_team_members_role_guard on team_members;
create trigger trg_team_members_role_guard
  before insert or update on team_members
  for each row execute function _team_members_role_guard();

-- Replace the self-insert policy: only the LC's creator may insert directly (as
-- president, when creating the LC). Everyone else joins via join_lc_with_code().
drop policy if exists "user can insert own membership" on team_members;
drop policy if exists "owner joins own lc as president" on team_members;
create policy "owner joins own lc as president" on team_members
  for insert with check (
    auth.uid() = user_id
    and role = 'president'
    and exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid())
  );

drop policy if exists "president or self updates membership" on team_members;
create policy "president or self updates membership" on team_members
  for update using (user_id = auth.uid() or is_lc_president(project_id))
  with check (user_id = auth.uid() or is_lc_president(project_id));

drop policy if exists "president removes members or self leaves" on team_members;
create policy "president removes members or self leaves" on team_members
  for delete using (user_id = auth.uid() or is_lc_president(project_id));

-- ── 6. Joining an LC with an invite code ─────────────────────────────────────

create or replace function join_lc_with_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_invite invite_codes%rowtype;
  v_email  text;
  v_level  text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not exists (select 1 from user_profiles where id = v_uid) then
    raise exception 'Create your profile before joining an LC';
  end if;

  select * into v_invite from invite_codes
  where code = upper(trim(p_code))
  for update;

  if not found then
    raise exception 'Invalid invite code';
  end if;
  if v_invite.used_by is not null and v_invite.used_by <> v_uid then
    raise exception 'This invite code has already been used';
  end if;

  if v_invite.invited_email is not null then
    select email into v_email from auth.users where id = v_uid;
    if lower(coalesce(v_email, '')) <> lower(v_invite.invited_email) then
      raise exception 'This invite was sent to a different email address';
    end if;
    -- Personal invites are single-use.
    update invite_codes set used_by = v_uid, used_at = now() where id = v_invite.id;
  end if;

  select permission_level into v_level from lab_roles where id = v_invite.lab_role_id;

  insert into team_members (project_id, user_id, role, lab_role_id)
  values (v_invite.project_id, v_uid, coalesce(v_level, 'member'), v_invite.lab_role_id)
  on conflict (project_id, user_id) do nothing;

  return v_invite.project_id;
end;
$$;

revoke execute on function join_lc_with_code(text) from public, anon;
grant execute on function join_lc_with_code(text) to authenticated;

-- ── 7. Departments RLS ────────────────────────────────────────────────────────

alter table departments enable row level security;

drop policy if exists "lc members read departments" on departments;
create policy "lc members read departments" on departments
  for select using (auth_is_project_member(project_id));

drop policy if exists "president manages departments" on departments;
create policy "president manages departments" on departments
  for all using (is_lc_president(project_id))
  with check (is_lc_president(project_id));

-- A department's VP must be a VP (or the president) of the same LC.
create or replace function _departments_vp_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vp_user_id is not null and not exists (
    select 1 from team_members
    where project_id = new.project_id and user_id = new.vp_user_id and role in ('vp', 'president')
  ) then
    raise exception 'A department''s lead must be a VP of this LC';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_departments_vp_guard on departments;
create trigger trg_departments_vp_guard
  before insert or update of vp_user_id on departments
  for each row execute function _departments_vp_guard();

-- ── 8. Re-point every old PI check at the president ───────────────────────────

-- projects: the president (not only the original creator) manages LC settings.
drop policy if exists "owner can update own project" on projects;
drop policy if exists "president updates lc" on projects;
create policy "president updates lc" on projects
  for update using (auth.uid() = owner_id or is_lc_president(id));

-- lab_roles: the LC's creator must read them before joining (to pick "President").
drop policy if exists "lc owner reads roles" on lab_roles;
create policy "lc owner reads roles" on lab_roles
  for select using (exists (select 1 from projects p where p.id = project_id and p.owner_id = auth.uid()));
drop policy if exists "pi manages roles" on lab_roles;
drop policy if exists "president manages roles" on lab_roles;
create policy "president manages roles" on lab_roles
  for all using (is_lc_president(project_id))
  with check (is_lc_president(project_id));

-- invite_codes: only the president creates / revokes invites for their LC.
drop policy if exists "pi can insert invite code" on invite_codes;
drop policy if exists "president creates invite codes" on invite_codes;
create policy "president creates invite codes" on invite_codes
  for insert with check (auth.uid() = created_by and is_lc_president(project_id));
drop policy if exists "user can claim unused code" on invite_codes;
drop policy if exists "president manages invite codes" on invite_codes;
create policy "president manages invite codes" on invite_codes
  for update using (is_lc_president(project_id));
drop policy if exists "president deletes invite codes" on invite_codes;
create policy "president deletes invite codes" on invite_codes
  for delete using (is_lc_president(project_id));

-- support_resources
drop policy if exists "support_resources_pi_select_all" on support_resources;
create policy "support_resources_pi_select_all" on support_resources
  for select to authenticated using (is_lc_president(project_id));
drop policy if exists "support_resources_pi_insert" on support_resources;
create policy "support_resources_pi_insert" on support_resources
  for insert to authenticated with check (is_lc_president(project_id));
drop policy if exists "support_resources_pi_update" on support_resources;
create policy "support_resources_pi_update" on support_resources
  for update to authenticated using (is_lc_president(project_id));
drop policy if exists "support_resources_pi_delete" on support_resources;
create policy "support_resources_pi_delete" on support_resources
  for delete to authenticated using (is_lc_president(project_id));

-- chat: the old policy let a PI of ANY lab edit messages in every channel.
-- Now: your own messages, or (to pin/moderate) the president of that LC channel.
drop policy if exists "chat_messages_own_update" on chat_messages;
create policy "chat_messages_own_update" on chat_messages
  for update to authenticated
  using (
    sender_id = auth.uid()
    or (channel like 'lab:%' and is_lc_president(regexp_replace(channel, '^lab:', '')::uuid))
  );

-- groups (sub_projects): the president can manage any group in their LC.
drop policy if exists "privileged can insert sub_project_members" on sub_project_members;
create policy "privileged can insert sub_project_members" on sub_project_members
  for insert with check (
    exists (
      select 1 from sub_projects sp
      where sp.id = sub_project_members.sub_project_id
        and (sp.created_by = auth.uid() or is_lc_president(sp.project_id))
    )
  );
drop policy if exists "privileged can delete sub_project_members" on sub_project_members;
create policy "privileged can delete sub_project_members" on sub_project_members
  for delete using (
    exists (
      select 1 from sub_projects sp
      where sp.id = sub_project_members.sub_project_id
        and (sp.created_by = auth.uid() or is_lc_president(sp.project_id))
    )
  );
drop policy if exists "president updates groups" on sub_projects;
create policy "president updates groups" on sub_projects
  for update using (is_lc_president(project_id));

notify pgrst, 'reload schema';
