-- Migration 055: the project layer means the project's members.
--
-- Reminders and calendar events already worked this way. Tasks, LC Drive links
-- and project chat didn't:
--   * project tasks and Drive links were visible to the whole LC;
--   * project chat was readable by the whole LC, but not by the project's
--     outside collaborators;
--   * outside collaborators could see project tasks but not edit, assign or
--     complete them.
-- One rule now decides every layer:
--   personal  its owner
--   project   the project's members (LC members and outside collaborators)
--   LC        the LC's members

create or replace function can_see_layer(p_project_id uuid, p_scope text, p_sub_project_id uuid, p_owner uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case coalesce(p_scope, 'lab')
    when 'personal' then p_owner = auth.uid()
    when 'project'  then p_sub_project_id is not null
                         and exists (select 1 from sub_projects sp where sp.id = p_sub_project_id and sp.project_id = p_project_id)
                         and auth_uid_is_sub_project_member(p_sub_project_id)
    else auth_is_project_member(p_project_id)
  end;
$$;

revoke execute on function can_see_layer(uuid, text, uuid, uuid) from public, anon;
grant  execute on function can_see_layer(uuid, text, uuid, uuid) to authenticated;

-- ── Tasks ────────────────────────────────────────────────────────────────────

drop policy if exists "project members can read tasks"   on tasks;
drop policy if exists "project members can insert tasks" on tasks;
drop policy if exists "project members can update tasks" on tasks;
drop policy if exists "project members can delete tasks" on tasks;

create policy "project members can read tasks" on tasks
  for select using (can_see_layer(project_id, scope, sub_project_id, created_by));
create policy "project members can insert tasks" on tasks
  for insert with check (created_by = auth.uid() and can_see_layer(project_id, scope, sub_project_id, created_by));
create policy "project members can update tasks" on tasks
  for update using (can_see_layer(project_id, scope, sub_project_id, created_by))
  with check (can_see_layer(project_id, scope, sub_project_id, created_by));
create policy "project members can delete tasks" on tasks
  for delete using (can_see_layer(project_id, scope, sub_project_id, created_by));

-- Assignees: on any task you can see (RLS on tasks decides).
drop policy if exists "project members manage task assignees" on task_assignees;
create policy "project members manage task assignees" on task_assignees
  for all using (exists (select 1 from tasks t where t.id = task_assignees.task_id))
  with check (exists (select 1 from tasks t where t.id = task_assignees.task_id));

-- ── LC Drive links ───────────────────────────────────────────────────────────

drop policy if exists "project members can read bookmarks"   on bookmarks;
drop policy if exists "project members can insert bookmarks" on bookmarks;
drop policy if exists "members can update shared bookmarks"  on bookmarks;
drop policy if exists "members can delete bookmarks"         on bookmarks;
drop policy if exists "adder can delete bookmarks"           on bookmarks;

create policy "project members can read bookmarks" on bookmarks
  for select using (can_see_layer(project_id, scope, sub_project_id, added_by));
create policy "project members can insert bookmarks" on bookmarks
  for insert with check (added_by = auth.uid() and can_see_layer(project_id, scope, sub_project_id, added_by));
create policy "members can update shared bookmarks" on bookmarks
  for update using (can_see_layer(project_id, scope, sub_project_id, added_by))
  with check (can_see_layer(project_id, scope, sub_project_id, added_by));
create policy "members can delete bookmarks" on bookmarks
  for delete using (can_see_layer(project_id, scope, sub_project_id, added_by));

-- ── Project chat ─────────────────────────────────────────────────────────────

drop policy if exists "chat_messages_member_select" on chat_messages;
create policy "chat_messages_member_select"
  on chat_messages for select to authenticated
  using (
    (channel like 'lab:%' and auth_is_project_member(regexp_replace(channel, '^lab:', '')::uuid))
    or (channel like 'dm:%' and auth.uid()::text = any(string_to_array(regexp_replace(channel, '^dm:', ''), ':')))
    or (channel like 'project:%' and auth_uid_is_sub_project_member(regexp_replace(channel, '^project:', '')::uuid))
  );

drop policy if exists "chat_messages_member_insert" on chat_messages;
create policy "chat_messages_member_insert"
  on chat_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      (channel like 'lab:%' and auth_is_project_member(regexp_replace(channel, '^lab:', '')::uuid))
      or (channel like 'dm:%' and auth.uid()::text = any(string_to_array(regexp_replace(channel, '^dm:', ''), ':')))
      or (channel like 'project:%' and auth_uid_is_sub_project_member(regexp_replace(channel, '^project:', '')::uuid))
    )
  );

notify pgrst, 'reload schema';
