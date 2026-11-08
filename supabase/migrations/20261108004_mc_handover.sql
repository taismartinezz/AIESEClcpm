-- Migration 067: handing the MC over to the next MCP.
--
-- MCPs change every term. Until now the MC belonged to whoever created it,
-- forever. Now:
--
--   1. The next MCP joins the MC with the member code, like anyone on the team.
--   2. The current MCP picks them in the team list ("Make MCP"):
--      offer_mcp_handover() stores the offer on the MC (mcs.handover_to).
--   3. The next MCP accepts (accept_mcp_handover). They become the MCP; the old
--      MCP stays on the MC as a member, so they can help with the transition,
--      and leaves whenever they like. Either side can cancel before that.
--
-- Also:
--   mc_team()                  the people on the MC, with names, for MC members.
--   new_mc_member_code()       the MCP gives the MC a new member code, so last
--                              term's team can't rejoin with the old one.
--   mc_members_keep_an_mcp     an MC can never be left without an MCP: the MCP
--                              can't leave or be demoted until they hand over.
--                              (Deleting the whole MC still works.)
--
-- Grants are written out: some projects don't expose new objects automatically.

alter table mcs add column if not exists handover_to uuid references auth.users(id) on delete set null;
alter table mcs add column if not exists handover_offered_at timestamptz;

-- ── Who's on the MC ──────────────────────────────────────────────────────────

create or replace function mc_team(p_mc_id uuid)
returns table (user_id uuid, name text, role text, joined_at timestamptz, is_me boolean, handover_pending boolean)
language sql
security definer
stable
set search_path = public
as $$
  select m.user_id,
         coalesce(nullif(trim(up.name), ''), 'Unnamed'),
         m.role,
         m.joined_at,
         m.user_id = auth.uid(),
         coalesce(mc.handover_to = m.user_id, false)
  from mc_members m
  join mcs mc on mc.id = m.mc_id
  left join user_profiles up on up.id = m.user_id
  where m.mc_id = p_mc_id and is_mc_member(p_mc_id)
  order by (m.role = 'mcp') desc, lower(coalesce(up.name, '')), m.joined_at;
$$;

-- ── Handover ─────────────────────────────────────────────────────────────────

create or replace function offer_mcp_handover(p_mc_id uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_mcp(p_mc_id) then
    raise exception 'Only the MCP can hand the MC over.';
  end if;
  if p_to = auth.uid() then
    raise exception 'You are already the MCP.';
  end if;
  if not exists (select 1 from mc_members where mc_id = p_mc_id and user_id = p_to) then
    raise exception 'They need to join the MC with the member code first.';
  end if;
  update mcs set handover_to = p_to, handover_offered_at = now() where id = p_mc_id;
end;
$$;

-- The MCP takes the offer back, or the person it was offered to declines.
create or replace function cancel_mcp_handover(p_mc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_mcp(p_mc_id) or exists (select 1 from mcs where id = p_mc_id and handover_to = auth.uid())) then
    raise exception 'Only the MCP, or the person it was offered to, can cancel the handover.';
  end if;
  update mcs set handover_to = null, handover_offered_at = null where id = p_mc_id;
end;
$$;

create or replace function accept_mcp_handover(p_mc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_to uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select handover_to into v_to from mcs where id = p_mc_id for update;
  if v_to is distinct from auth.uid() then
    raise exception 'There is no handover waiting for you. Ask the MCP to choose you again.';
  end if;
  if not exists (select 1 from mc_members where mc_id = p_mc_id and user_id = auth.uid()) then
    raise exception 'You are no longer on this MC. Join again with the member code.';
  end if;
  -- Promote first, then step the old MCP down, so the MC always has an MCP.
  update mc_members set role = 'mcp' where mc_id = p_mc_id and user_id = auth.uid();
  update mc_members set role = 'member' where mc_id = p_mc_id and user_id <> auth.uid() and role = 'mcp';
  update mcs set handover_to = null, handover_offered_at = null where id = p_mc_id;
end;
$$;

-- ── New member code ──────────────────────────────────────────────────────────

create or replace function new_mc_member_code(p_mc_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  if not is_mcp(p_mc_id) then
    raise exception 'Only the MCP can change the member code.';
  end if;
  loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    exit when not exists (select 1 from mcs where member_code = v_code or lc_code = v_code);
  end loop;
  update mcs set member_code = v_code where id = p_mc_id;
  return v_code;
end;
$$;

-- ── An MC always has an MCP ──────────────────────────────────────────────────

create or replace function mc_members_keep_an_mcp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'mcp'
     and (tg_op = 'DELETE' or new.role <> 'mcp')
     and exists (select 1 from mcs where id = old.mc_id)         -- not when the whole MC is deleted
     and not exists (select 1 from mc_members where mc_id = old.mc_id and role = 'mcp' and user_id <> old.user_id)
  then
    raise exception 'The MC needs an MCP. Hand it over to someone on the team before you leave.';
  end if;
  if tg_op = 'DELETE' then
    -- Someone who leaves can't accept a handover any more.
    update mcs set handover_to = null, handover_offered_at = null where id = old.mc_id and handover_to = old.user_id;
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists mc_members_keep_an_mcp on mc_members;
create trigger mc_members_keep_an_mcp
  before update or delete on mc_members
  for each row execute function mc_members_keep_an_mcp();

revoke execute on function mc_team(uuid)                   from public, anon;
revoke execute on function offer_mcp_handover(uuid, uuid)  from public, anon;
revoke execute on function cancel_mcp_handover(uuid)       from public, anon;
revoke execute on function accept_mcp_handover(uuid)       from public, anon;
revoke execute on function new_mc_member_code(uuid)        from public, anon;
grant  execute on function mc_team(uuid)                   to authenticated;
grant  execute on function offer_mcp_handover(uuid, uuid)  to authenticated;
grant  execute on function cancel_mcp_handover(uuid)       to authenticated;
grant  execute on function accept_mcp_handover(uuid)       to authenticated;
grant  execute on function new_mc_member_code(uuid)        to authenticated;

notify pgrst, 'reload schema';
