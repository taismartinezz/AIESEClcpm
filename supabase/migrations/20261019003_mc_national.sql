-- Migration 042: Member Committees (MC): the national view.
--
--   mcs               a national entity (e.g. "AIESEC in Portugal"). Has two
--                     codes: member_code (MC members join with it) and
--                     lc_code (an LCP links their LC with it).
--   mc_members        people on the MC. They are NOT members of any LC through
--                     this, so they never see an LC's tasks, chat, exchanges
--                     or wellbeing data.
--   projects.mc_id    the MC an LC belongs to, set by the LC's president.
--   mc_dashboard()    per-LC numbers for MC members: counts only (approved,
--                     realized, completed, applied this term per product, and
--                     member count). No names, no personal data, no pulse.

create table if not exists mcs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  member_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  lc_code     text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  term_start  date,                                  -- national term start; default 1 February
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists mc_members (
  mc_id     uuid not null references mcs(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('mcp', 'member')),
  joined_at timestamptz not null default now(),
  primary key (mc_id, user_id)
);

alter table projects add column if not exists mc_id uuid references mcs(id) on delete set null;

create or replace function is_mc_member(p_mc_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from mc_members where mc_id = p_mc_id and user_id = auth.uid());
$$;

create or replace function is_mcp(p_mc_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from mc_members where mc_id = p_mc_id and user_id = auth.uid() and role = 'mcp');
$$;

alter table mcs        enable row level security;
alter table mc_members enable row level security;

-- MC members see their MC (with codes); an LC's president sees the MC their LC belongs to (name only via the view below).
drop policy if exists "mc members read their mc" on mcs;
create policy "mc members read their mc" on mcs for select using (is_mc_member(id));

drop policy if exists "mcp updates their mc" on mcs;
create policy "mcp updates their mc" on mcs for update using (is_mcp(id)) with check (is_mcp(id));

drop policy if exists "mc members see each other" on mc_members;
create policy "mc members see each other" on mc_members for select using (is_mc_member(mc_id));

drop policy if exists "mcp removes members or self leaves" on mc_members;
create policy "mcp removes members or self leaves" on mc_members for delete using (user_id = auth.uid() or is_mcp(mc_id));

-- ── Creating and joining ─────────────────────────────────────────────────────

create or replace function create_mc(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into mcs (name, created_by) values (trim(p_name), auth.uid()) returning id into v_id;
  insert into mc_members (mc_id, user_id, role) values (v_id, auth.uid(), 'mcp');
  return v_id;
end;
$$;

create or replace function join_mc(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into v_id from mcs where member_code = upper(trim(p_code));
  if v_id is null then raise exception 'Invalid MC code'; end if;
  insert into mc_members (mc_id, user_id) values (v_id, auth.uid()) on conflict do nothing;
  return v_id;
end;
$$;

-- The LC's president links (or, with null, unlinks) their LC.
create or replace function link_lc_to_mc(p_project_id uuid, p_lc_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_mc mcs%rowtype;
begin
  if not is_lc_president(p_project_id) then
    raise exception 'Only the LC president can link the LC to an MC';
  end if;
  if p_lc_code is null or trim(p_lc_code) = '' then
    update projects set mc_id = null where id = p_project_id;
    return null;
  end if;
  select * into v_mc from mcs where lc_code = upper(trim(p_lc_code));
  if not found then raise exception 'Invalid MC code'; end if;
  update projects set mc_id = v_mc.id where id = p_project_id;
  return v_mc.name;
end;
$$;

-- Name of the MC an LC belongs to (for the LC's settings page).
create or replace function lc_mc_name(p_project_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select m.name from projects p join mcs m on m.id = p.mc_id
  where p.id = p_project_id and auth_is_project_member(p_project_id);
$$;

-- An MC member may remove an LC from their MC.
create or replace function unlink_lc_from_mc(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from projects where id = p_project_id and mc_id is not null and is_mcp(mc_id)) then
    raise exception 'Only the MCP can remove an LC from the MC';
  end if;
  update projects set mc_id = null where id = p_project_id;
end;
$$;

-- ── National dashboard ───────────────────────────────────────────────────────

create or replace function mc_dashboard(p_mc_id uuid, p_from date default null, p_to date default null)
returns table (
  project_id uuid, lc_name text, members integer, product text,
  applied integer, approved integer, realized integer, completed integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_from date;
  v_to   date := coalesce(p_to, current_date);
begin
  if not is_mc_member(p_mc_id) then
    return;
  end if;
  select coalesce(p_from, term_start,
           case when current_date >= make_date(extract(year from current_date)::int, 2, 1)
                then make_date(extract(year from current_date)::int, 2, 1)
                else make_date(extract(year from current_date)::int - 1, 2, 1) end)
    into v_from from mcs where id = p_mc_id;

  return query
  select p.id, p.name,
         (select count(*)::int from team_members tm where tm.project_id = p.id),
         pr.code,
         (select count(*)::int from exchanges e where e.project_id = p.id and e.product = pr.code and e.applied_at   between v_from and v_to),
         (select count(*)::int from exchanges e where e.project_id = p.id and e.product = pr.code and e.approved_at  between v_from and v_to),
         (select count(*)::int from exchanges e where e.project_id = p.id and e.product = pr.code and e.realized_at  between v_from and v_to),
         (select count(*)::int from exchanges e where e.project_id = p.id and e.product = pr.code and e.completed_at between v_from and v_to)
  from projects p
  cross join unnest(array['ogv', 'ogta', 'ogte', 'igv', 'igta', 'igte']) as pr(code)
  where p.mc_id = p_mc_id
  order by p.name, pr.code;
end;
$$;

revoke execute on function create_mc(text)                     from public, anon;
revoke execute on function join_mc(text)                       from public, anon;
revoke execute on function link_lc_to_mc(uuid, text)           from public, anon;
revoke execute on function lc_mc_name(uuid)                    from public, anon;
revoke execute on function unlink_lc_from_mc(uuid)             from public, anon;
revoke execute on function mc_dashboard(uuid, date, date)      from public, anon;
grant  execute on function create_mc(text)                     to authenticated;
grant  execute on function join_mc(text)                       to authenticated;
grant  execute on function link_lc_to_mc(uuid, text)           to authenticated;
grant  execute on function lc_mc_name(uuid)                    to authenticated;
grant  execute on function unlink_lc_from_mc(uuid)             to authenticated;
grant  execute on function mc_dashboard(uuid, date, date)      to authenticated;

notify pgrst, 'reload schema';
