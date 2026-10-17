-- Migration 048: Connect Google Calendar (read-only) from Scheduling.
--
-- google_connections keeps each person's Google access / refresh token. No
-- one reads it through the API: only the server (service role) uses it to
-- fetch that person's own calendar for their own Scheduling view. The app
-- asks google_calendar_status() whether you're connected and
-- disconnect_google_calendar() to forget the tokens.
-- (The original app kept these tokens on user_profiles, which LC members can
-- read; this table replaces that.)

create table if not exists google_connections (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  google_email  text,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  scope         text,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table google_connections enable row level security;   -- no policies: service role only
revoke all on google_connections from anon, authenticated;

create or replace function google_calendar_status()
returns table (connected_at timestamptz, google_email text)
language sql
security definer
stable
set search_path = public
as $$
  select connected_at, google_email from google_connections where user_id = auth.uid();
$$;

create or replace function disconnect_google_calendar()
returns void
language sql
security definer
set search_path = public
as $$
  delete from google_connections where user_id = auth.uid();
$$;

revoke execute on function google_calendar_status()     from public, anon;
revoke execute on function disconnect_google_calendar() from public, anon;
grant  execute on function google_calendar_status()     to authenticated;
grant  execute on function disconnect_google_calendar() to authenticated;

notify pgrst, 'reload schema';
