-- Migration 071: the MC reaches its LCs.
--
--   mc_messages        an announcement from the MC to every linked LC, or to
--                      one LC (project_id); kind 'nudge' is the "please update
--                      your numbers" sent from Needs attention. MC members
--                      write and read them; members of the LCs they're for
--                      read them on their dashboard.
--   lc_national(lc)    for an LC's members: its MC (id, name) and the MC's
--                      term start, so the dashboard can show national targets.
--   mc_lc_targets      now also readable by the LC's VPs (was: president), so
--                      they see the targets for their products.
--
-- Grants are written out: some projects don't expose new objects automatically.

create table if not exists mc_messages (
  id         uuid primary key default gen_random_uuid(),
  mc_id      uuid not null references mcs(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,      -- null = every linked LC
  kind       text not null default 'announcement' check (kind in ('announcement', 'nudge')),
  body       text not null check (length(trim(body)) between 1 and 2000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists mc_messages_mc_idx on mc_messages (mc_id, created_at desc);

-- Is the caller in an LC this MC message is for?
create or replace function in_lc_of_mc(p_mc_id uuid, p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from team_members tm join projects p on p.id = tm.project_id
    where tm.user_id = auth.uid() and p.mc_id = p_mc_id and (p_project_id is null or p.id = p_project_id)
  );
$$;

alter table mc_messages enable row level security;
grant select, insert, delete on mc_messages to authenticated;
grant select, insert, update, delete on mc_messages to service_role;

drop policy if exists "mc and its lcs read messages" on mc_messages;
create policy "mc and its lcs read messages" on mc_messages
  for select using (is_mc_member(mc_id) or in_lc_of_mc(mc_id, project_id));

drop policy if exists "mc members send messages" on mc_messages;
create policy "mc members send messages" on mc_messages
  for insert with check (
    is_mc_member(mc_id) and created_by = auth.uid()
    and (project_id is null or lc_in_mc(project_id, mc_id))
  );

drop policy if exists "the sender or the mcp deletes messages" on mc_messages;
create policy "the sender or the mcp deletes messages" on mc_messages
  for delete using (created_by = auth.uid() or is_mcp(mc_id));

create or replace function lc_national(p_project_id uuid)
returns table (mc_id uuid, mc_name text, term_start date)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.name, mc_term_start(m.id)
  from projects p join mcs m on m.id = p.mc_id
  where p.id = p_project_id and auth_is_project_member(p_project_id);
$$;

drop policy if exists "mc members and the lc's president read targets" on mc_lc_targets;
drop policy if exists "mc members and the lc's execs read targets" on mc_lc_targets;
create policy "mc members and the lc's execs read targets" on mc_lc_targets
  for select using (is_mc_member(mc_id) or is_lc_exec(project_id));

revoke execute on function in_lc_of_mc(uuid, uuid) from public, anon;
revoke execute on function lc_national(uuid)       from public, anon;
grant  execute on function in_lc_of_mc(uuid, uuid) to authenticated;
grant  execute on function lc_national(uuid)       to authenticated;

notify pgrst, 'reload schema';
