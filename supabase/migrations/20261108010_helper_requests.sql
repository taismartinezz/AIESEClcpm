-- Migration 073: the helper's feature requests, and the app's moderators.
--
-- When the helper can't find what someone asked for, the question is reported
-- here as a feature request. Moderators (the people who run the app) read and
-- triage them on Help → Feature requests.
--
--   app_moderators     who moderates the app. Add someone in the SQL Editor:
--                        insert into app_moderators (user_id)
--                        select id from auth.users where email = 'you@example.com';
--   is_app_moderator() true for them.
--   feature_requests   one row per question the helper couldn't answer. The
--                      asker can read their own; moderators read all and set
--                      the status. Nobody edits the question afterwards.
--
-- Grants are written out: some projects don't expose new objects automatically.

create table if not exists app_moderators (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  added_at   timestamptz not null default now()
);
alter table app_moderators enable row level security;

create or replace function is_app_moderator()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from app_moderators where user_id = auth.uid());
$$;

drop policy if exists "moderators see the moderator list" on app_moderators;
create policy "moderators see the moderator list" on app_moderators for select using (is_app_moderator());

create table if not exists feature_requests (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  project_id  uuid references projects(id) on delete set null,
  role        text check (role in ('member', 'vp', 'president', 'mc')),
  question    text not null check (char_length(question) between 3 and 500),
  page        text check (char_length(page) <= 200),
  -- What the helper looked at before giving up (its closest guesses), for triage.
  closest     text[] not null default '{}',
  status      text not null default 'new' check (status in ('new', 'planned', 'done', 'declined')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists feature_requests_status_idx on feature_requests (status, created_at desc);
alter table feature_requests enable row level security;

drop policy if exists "people report what they couldn't find" on feature_requests;
create policy "people report what they couldn't find" on feature_requests
  for insert with check (created_by = auth.uid() and status = 'new');
drop policy if exists "askers and moderators read requests" on feature_requests;
create policy "askers and moderators read requests" on feature_requests
  for select using (created_by = auth.uid() or is_app_moderator());

-- Moderators change the status only.
create or replace function set_feature_request_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_app_moderator() then raise exception 'Only app moderators can triage feature requests'; end if;
  if p_status not in ('new', 'planned', 'done', 'declined') then raise exception 'Unknown status %', p_status; end if;
  update feature_requests set status = p_status, updated_at = now() where id = p_id;
end;
$$;

grant select on app_moderators to authenticated;
grant select, insert on feature_requests to authenticated;
revoke execute on function is_app_moderator()                       from public, anon;
revoke execute on function set_feature_request_status(uuid, text)  from public, anon;
grant  execute on function is_app_moderator()                       to authenticated;
grant  execute on function set_feature_request_status(uuid, text)  to authenticated;

notify pgrst, 'reload schema';
