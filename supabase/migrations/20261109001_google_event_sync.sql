-- Migration 072: LC events in members' Google Calendars.
--
-- People who connected Google Calendar (with permission to add events) get
-- their LC's events in it: added when an event they're invited to is created,
-- updated when it changes, removed when it's deleted, when they're no longer
-- invited, or when they answer "Not going". The server does it with their
-- own Google token (google_connections, service role only).
--
--   google_connections.add_events   the person's switch (on by default).
--   google_event_links              which Google event belongs to which LC
--                                   event, per person. No foreign key to
--                                   lc_events on purpose: when an event is
--                                   deleted, the links are what tell the
--                                   server which Google events to remove.
--   google_calendar_status()        now also says whether the connection may
--                                   add events (older connections were
--                                   read-only and need reconnecting).
--   The switch is flipped through /api/google/add-events, which also adds or
--   removes the events right away.
--
-- Grants are written out: some projects don't expose new objects automatically.

alter table google_connections add column if not exists add_events boolean not null default true;

create table if not exists google_event_links (
  user_id          uuid not null references auth.users(id) on delete cascade,
  event_id         uuid not null,
  google_event_id  text not null,
  synced_at        timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index if not exists google_event_links_event_idx on google_event_links (event_id);

alter table google_event_links enable row level security;   -- no policies: service role only
revoke all on google_event_links from anon, authenticated;
grant select, insert, update, delete on google_event_links to service_role;
grant select, insert, update, delete on google_connections to service_role;

drop function if exists google_calendar_status();
create or replace function google_calendar_status()
returns table (connected_at timestamptz, google_email text, can_add_events boolean, add_events boolean)
language sql
security definer
stable
set search_path = public
as $$
  select connected_at, google_email, coalesce(scope, '') like '%calendar.events%', add_events
  from google_connections where user_id = auth.uid();
$$;

revoke execute on function google_calendar_status()      from public, anon;
grant  execute on function google_calendar_status()      to authenticated;

notify pgrst, 'reload schema';
