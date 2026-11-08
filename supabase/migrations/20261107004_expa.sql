-- Migration 063: connect EXPA (AIESEC's GIS) and sync applications.
--
-- A member connects their EXPA account once (OAuth with auth.aiesec.org). The
-- server keeps their tokens in expa_connections, which no one reads through
-- the API, and uses them to read applications of their home LC from the GIS
-- GraphQL API. The applications go into the pipeline through import_exchanges,
-- run as that member, so the usual department rules decide what they can add.
--
--   expa_connections    one row per member: tokens, their EXPA name and home LC.
--   expa_oauth_states   the random "state" of a connect or sign-in in
--                       progress, so the callback knows who started it and
--                       why (kept 10 minutes).
--   expa_status()       for the app: am I connected, as whom, last sync.
--   expa_profile()      my EXPA name, photo, LC, entity and positions, so
--                       onboarding can fill them in.
--   disconnect_expa()   forget my tokens.
--   auth_user_id_by_email(email)  server only: is there already a Glow account
--                       with this email? "Continue with EXPA" signs into an
--                       account linked to that EXPA person, or creates a new
--                       one; it never takes over an existing account by email.

create table if not exists expa_connections (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  expa_person_id  text,
  expa_name       text,
  home_lc_id      text,
  home_lc_name    text,
  access_token    text not null,
  refresh_token   text,
  expires_at      timestamptz,
  connected_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_synced_at  timestamptz,
  -- Name, photo, LC, entity and positions from EXPA, for filling in onboarding.
  profile         jsonb not null default '{}'::jsonb
);

alter table expa_connections add column if not exists profile jsonb not null default '{}'::jsonb;

-- One Glow account per EXPA person.
create unique index if not exists expa_connections_person_idx on expa_connections (expa_person_id);

alter table expa_connections enable row level security;   -- no policies: service role only
revoke all on expa_connections from anon, authenticated;
-- Granted explicitly: projects where new tables aren't exposed automatically
-- would otherwise refuse the server too ("permission denied for table …").
grant select, insert, update, delete on expa_connections to service_role;

create table if not exists expa_oauth_states (
  state       text primary key check (length(state) >= 32),
  purpose     text not null default 'connect' check (purpose in ('connect', 'login')),
  user_id     uuid references auth.users(id) on delete cascade,     -- who is connecting; none for a sign-in
  created_at  timestamptz not null default now(),
  check (purpose = 'login' or user_id is not null)
);

alter table expa_oauth_states enable row level security;  -- no policies: service role only
revoke all on expa_oauth_states from anon, authenticated;
grant select, insert, update, delete on expa_oauth_states to service_role;

create or replace function expa_status()
returns table (connected_at timestamptz, expa_name text, home_lc_name text, last_synced_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select connected_at, expa_name, home_lc_name, last_synced_at from expa_connections where user_id = auth.uid();
$$;

create or replace function disconnect_expa()
returns void
language sql
security definer
set search_path = public
as $$
  delete from expa_connections where user_id = auth.uid();
$$;

-- Your own EXPA profile details (no tokens), for onboarding.
create or replace function expa_profile()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select profile from expa_connections where user_id = auth.uid();
$$;

revoke execute on function expa_profile() from public, anon;
grant  execute on function expa_profile() to authenticated;

create or replace function auth_user_id_by_email(p_email text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

revoke execute on function auth_user_id_by_email(text) from public, anon, authenticated;
grant  execute on function auth_user_id_by_email(text) to service_role;

revoke execute on function expa_status()     from public, anon;
revoke execute on function disconnect_expa() from public, anon;
grant  execute on function expa_status()     to authenticated;
grant  execute on function disconnect_expa() to authenticated;

notify pgrst, 'reload schema';
