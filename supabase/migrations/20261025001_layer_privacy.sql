-- Migration 054: keep the personal and project layers private.
--
-- Found by testing two accounts against RLS (tests/db/layers.test.ts):
--
--   1. Personal tasks were readable, editable and deletable by everyone in the
--      LC: the task policies only checked LC membership. Now a personal task is
--      its creator's alone.
--   2. Subtasks were always saved as LC tasks, so a personal task's subtasks
--      were visible to the LC. A subtask now takes its parent's layer.
--   3. Anyone signed in could add themselves to any project (a "manage own
--      membership" policy for all commands), then read its project tasks,
--      reminders and events. Now you can join only with a pending invite sent
--      to your email, and you can still leave.
--   4. Project invites were readable by everyone (tokens and emails), anyone
--      could create one for any project (e.g. inviting themselves), and anyone
--      could mark one used. Now only the project's managers (its creator or the
--      LC president) create and see them, plus the invitee, who alone can
--      accept theirs.

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function my_auth_email()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select lower(email) from auth.users where id = auth.uid();
$$;

create or replace function can_manage_sub_project(p_sub_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from sub_projects sp
    where sp.id = p_sub_project_id
      and (sp.created_by = auth.uid() or is_lc_president(sp.project_id))
  );
$$;

create or replace function has_pending_project_invite(p_sub_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from sub_project_invite_codes i
    where i.sub_project_id = p_sub_project_id
      and i.status = 'pending'
      and lower(i.invited_email) = my_auth_email()
  );
$$;

revoke execute on function my_auth_email()                  from public, anon;
revoke execute on function can_manage_sub_project(uuid)     from public, anon;
revoke execute on function has_pending_project_invite(uuid) from public, anon;
grant  execute on function my_auth_email()                  to authenticated;
grant  execute on function can_manage_sub_project(uuid)     to authenticated;
grant  execute on function has_pending_project_invite(uuid) to authenticated;

-- ── 1. Tasks: personal means personal ────────────────────────────────────────

drop policy if exists "project members can read tasks" on tasks;
create policy "project members can read tasks" on tasks
  for select using (
    (tasks.scope = 'personal' and tasks.created_by = auth.uid())
    or (
      tasks.scope <> 'personal'
      and (
        exists (select 1 from team_members tm where tm.project_id = tasks.project_id and tm.user_id = auth.uid())
        -- external collaborators: only their project's tasks
        or (
          tasks.scope = 'project' and tasks.sub_project_id is not null
          and exists (select 1 from sub_project_members spm where spm.sub_project_id = tasks.sub_project_id and spm.user_id = auth.uid())
        )
      )
    )
  );

drop policy if exists "project members can update tasks" on tasks;
create policy "project members can update tasks" on tasks
  for update
  using ((scope = 'personal' and created_by = auth.uid()) or (scope <> 'personal' and auth_is_project_member(project_id)))
  with check ((scope = 'personal' and created_by = auth.uid()) or (scope <> 'personal' and auth_is_project_member(project_id)));

drop policy if exists "project members can delete tasks" on tasks;
create policy "project members can delete tasks" on tasks
  for delete using ((scope = 'personal' and created_by = auth.uid()) or (scope <> 'personal' and auth_is_project_member(project_id)));

-- ── 2. Subtasks take their parent's layer ────────────────────────────────────

create or replace function _tasks_inherit_layer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent tasks%rowtype;
begin
  if new.parent_id is not null then
    select * into v_parent from tasks where id = new.parent_id;
    if found then
      new.scope := v_parent.scope;
      new.sub_project_id := v_parent.sub_project_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_inherit_layer on tasks;
create trigger trg_tasks_inherit_layer
  before insert or update of parent_id, scope, sub_project_id on tasks
  for each row execute function _tasks_inherit_layer();

-- Moving a task to another layer moves its subtasks too.
create or replace function _tasks_cascade_layer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update tasks set scope = new.scope, sub_project_id = new.sub_project_id
  where parent_id = new.id and (scope is distinct from new.scope or sub_project_id is distinct from new.sub_project_id);
  return new;
end;
$$;

drop trigger if exists trg_tasks_cascade_layer on tasks;
create trigger trg_tasks_cascade_layer
  after update of scope, sub_project_id on tasks
  for each row when (old.scope is distinct from new.scope or old.sub_project_id is distinct from new.sub_project_id)
  execute function _tasks_cascade_layer();

-- Existing subtasks: line them up with their parents.
update tasks s set scope = p.scope, sub_project_id = p.sub_project_id
from tasks p
where s.parent_id = p.id and (s.scope is distinct from p.scope or s.sub_project_id is distinct from p.sub_project_id);

-- ── 3. Project membership: invite only (you can still leave) ─────────────────

drop policy if exists "lab members can manage own sub_project membership" on sub_project_members;

drop policy if exists "invitees join with a pending invite" on sub_project_members;
create policy "invitees join with a pending invite" on sub_project_members
  for insert with check (user_id = auth.uid() and has_pending_project_invite(sub_project_id));

drop policy if exists "members can leave a project" on sub_project_members;
create policy "members can leave a project" on sub_project_members
  for delete using (user_id = auth.uid());

-- ── 4. Project invites ───────────────────────────────────────────────────────

drop policy if exists "anyone can look up a project invite" on sub_project_invite_codes;
drop policy if exists "lab members can read own sub_project invite codes" on sub_project_invite_codes;   -- every LC member, despite the name
drop policy if exists "managers and the invitee see project invites" on sub_project_invite_codes;
create policy "managers and the invitee see project invites" on sub_project_invite_codes
  for select using (
    invited_by = auth.uid()
    or can_manage_sub_project(sub_project_id)
    or lower(invited_email) = my_auth_email()
  );

drop policy if exists "inviter can insert project invite" on sub_project_invite_codes;
create policy "inviter can insert project invite" on sub_project_invite_codes
  for insert with check (auth.uid() = invited_by and can_manage_sub_project(sub_project_id));

drop policy if exists "user can claim pending project invite" on sub_project_invite_codes;
create policy "user can claim pending project invite" on sub_project_invite_codes
  for update
  using (status = 'pending' and lower(invited_email) = my_auth_email())
  with check (auth.uid() = used_by);

notify pgrst, 'reload schema';
