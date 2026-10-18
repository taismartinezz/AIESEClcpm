-- Migration 049: fixes from QA on the live site.
--
--   chat_messages   a message needs text or an attachment (an empty message
--                   was posted from the composer). NOT VALID: existing rows
--                   (e.g. "This message was deleted.") are left alone.
--   exchanges       email must look like an email (the form saved "notanemail").

alter table chat_messages drop constraint if exists chat_messages_not_empty;
alter table chat_messages add constraint chat_messages_not_empty
  check (deleted_at is not null or length(trim(content)) > 0 or jsonb_array_length(attachments) > 0) not valid;

alter table exchanges drop constraint if exists exchanges_email_format;
alter table exchanges add constraint exchanges_email_format
  check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') not valid;

notify pgrst, 'reload schema';

-- goals: +/− on a manual goal adds to the stored value in one statement, so
-- quick repeated clicks all count (they were each writing value + 1 from the
-- same stale value). Runs with the caller's rights: RLS decides who may edit.
create or replace function adjust_goal_value(p_goal_id uuid, p_delta numeric)
returns numeric
language sql
security invoker
set search_path = public
as $$
  update goals set current_value = greatest(0, current_value + p_delta)
   where id = p_goal_id and metric = 'manual'
  returning current_value;
$$;

revoke execute on function adjust_goal_value(uuid, numeric) from public, anon;
grant  execute on function adjust_goal_value(uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
