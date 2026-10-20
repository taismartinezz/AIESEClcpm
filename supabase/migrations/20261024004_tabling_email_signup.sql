-- Migration 053: sign up for a tabling slot from the weekly email.
--
-- The weekly digest lists open tabling slots with a one-tap sign-up link. The
-- link is signed for one slot and one person and is handled on the server,
-- which calls this function as that person: the same checks as
-- tabling_sign_up() (a member of the LC, not started, not full, idempotent),
-- plus the reminder for the day before. Only the service role may call it.

create or replace function tabling_sign_up_as(p_slot_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot tabling_slots%rowtype;
begin
  select * into v_slot from tabling_slots where id = p_slot_id for update;
  if not found or not exists (select 1 from team_members where project_id = v_slot.project_id and user_id = p_user_id) then
    raise exception 'Slot not found';
  end if;
  if v_slot.starts_at <= now() then raise exception 'This slot has already started'; end if;
  if exists (select 1 from tabling_signups where slot_id = p_slot_id and user_id = p_user_id) then
    return 'already';
  end if;
  if v_slot.taken >= v_slot.capacity then raise exception 'This slot is full'; end if;

  insert into tabling_signups (slot_id, user_id, project_id) values (p_slot_id, p_user_id, v_slot.project_id);
  insert into reminders (user_id, project_id, scope, title, due_at, kind, linked_event_id, email_enabled, sent, completed)
  values (p_user_id, v_slot.project_id, 'personal',
          'Tabling tomorrow: ' || v_slot.purpose || ' (' || v_slot.location || ')',
          greatest(v_slot.starts_at - interval '1 day', now()),
          'tabling', p_slot_id, false, false, false);
  return 'signed_up';
end;
$$;

revoke execute on function tabling_sign_up_as(uuid, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function tabling_sign_up_as(uuid, uuid) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
