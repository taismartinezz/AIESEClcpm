-- Migration 072: the MC's finance view across LCs, and an optional university account.
--
--   finance_entries.account   'lc' (the LC account the MC VP Finance keeps, as
--                             in the National Finance Tracker) or 'university'
--                             (money the university gives the LC). Existing
--                             entries are LC account entries.
--   projects.has_university_account
--                             the LC turns the university account on when its
--                             university gives it money. Off by default.
--   set_university_account()  the LC's finance lead (president or finance VP)
--                             or the MC VP Finance turns it on or off. Turning
--                             it off hides it; entries are kept.
--   Who may write (enforced here, not just in the UI):
--     LC account               MC VP Finance (unchanged)
--     university account       MC VP Finance, and the LC's finance lead
--   Who may read: LC president and VPs, the MC VP Finance (unchanged), and now
--   the MCP of the LC's MC too (read-only).
--   mc_finance_lcs(mc)        the MC's linked LCs with what the finance view
--                             needs, for the MCP and the VP Finance only.
--
-- Grants are written out: some projects don't expose new objects automatically.

alter table finance_entries add column if not exists account text not null default 'lc';
alter table finance_entries drop constraint if exists finance_entries_account_check;
alter table finance_entries add constraint finance_entries_account_check check (account in ('lc', 'university'));
create index if not exists finance_entries_project_account_idx on finance_entries (project_id, account, entry_date);

alter table projects add column if not exists has_university_account boolean not null default false;

-- ── Who may read and write ───────────────────────────────────────────────────

-- The MCP of the MC this LC is linked to.
create or replace function is_mc_mcp_of_lc(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from projects p
    join mc_members m on m.mc_id = p.mc_id
    where p.id = p_project_id and m.user_id = auth.uid() and m.role = 'mcp'
  );
$$;

create or replace function can_read_finance(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_mc_vp_finance(p_project_id)
      or is_mc_mcp_of_lc(p_project_id)
      or coalesce(lc_role(p_project_id) in ('president', 'vp'), false);
$$;

create or replace function can_write_finance(p_project_id uuid, p_account text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_mc_vp_finance(p_project_id)
      or (p_account = 'university'
          and is_finance_lead(p_project_id)
          and exists (select 1 from projects where id = p_project_id and has_university_account));
$$;

drop policy if exists "MC VP Finance records entries"         on finance_entries;
drop policy if exists "MC VP Finance edits entries"           on finance_entries;
drop policy if exists "MC VP Finance deletes manual entries"  on finance_entries;
drop policy if exists "finance keepers record entries"        on finance_entries;
drop policy if exists "finance keepers edit entries"          on finance_entries;
drop policy if exists "finance keepers delete manual entries" on finance_entries;

create policy "finance keepers record entries" on finance_entries
  for insert with check (claim_id is null and recorded_by = auth.uid() and can_write_finance(project_id, account));
-- Entries made by an approved claim follow the claim (un-approving removes them).
create policy "finance keepers edit entries" on finance_entries
  for update using (claim_id is null and can_write_finance(project_id, account))
  with check (claim_id is null and can_write_finance(project_id, account));
create policy "finance keepers delete manual entries" on finance_entries
  for delete using (claim_id is null and can_write_finance(project_id, account));

-- The change log keeps which account an entry was in.
create or replace function _finance_entries_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by uuid := (select id from user_profiles where id = auth.uid());
  v_keep text[] := array['type', 'amount', 'entry_date', 'description', 'payment_method', 'processed_via', 'area', 'notes', 'account'];
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from projects where id = old.project_id) then return old; end if;
    insert into finance_entry_changes (entry_id, project_id, op, changed_by, old_values)
    values (old.id, old.project_id, 'delete', v_by, (select jsonb_object_agg(k, v) from jsonb_each(to_jsonb(old)) e(k, v) where k = any (v_keep)));
    return old;
  end if;
  v_new := (select jsonb_object_agg(k, v) from jsonb_each(to_jsonb(new)) e(k, v) where k = any (v_keep));
  if tg_op = 'INSERT' then
    insert into finance_entry_changes (entry_id, project_id, op, changed_by, new_values) values (new.id, new.project_id, 'insert', v_by, v_new);
    return new;
  end if;
  v_old := (select jsonb_object_agg(k, v) from jsonb_each(to_jsonb(old)) e(k, v) where k = any (v_keep));
  if v_old is distinct from v_new then
    insert into finance_entry_changes (entry_id, project_id, op, changed_by, old_values, new_values)
    select new.id, new.project_id, 'update', v_by,
           jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
    from unnest(v_keep) k
    where v_old -> k is distinct from v_new -> k;
  end if;
  return new;
end;
$$;

-- ── University account on/off ────────────────────────────────────────────────

create or replace function set_university_account(p_project_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_finance_lead(p_project_id) or is_mc_vp_finance(p_project_id)) then
    raise exception 'Only the LC''s finance lead or the MC VP Finance can change this';
  end if;
  update projects set has_university_account = coalesce(p_on, false) where id = p_project_id;
end;
$$;

-- ── The MC's LCs, for the finance view ───────────────────────────────────────

create or replace function mc_finance_lcs(p_mc_id uuid)
returns table (project_id uuid, name text, currency text, term_start_date date, finance_reviewed_on date, has_university_account boolean)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.name, p.currency, coalesce(p.term_start_date, mc_term_start(p_mc_id)), p.finance_reviewed_on, p.has_university_account
  from projects p
  where p.mc_id = p_mc_id
    and not coalesce(p.is_demo, false)
    and exists (select 1 from mc_members m where m.mc_id = p_mc_id and m.user_id = auth.uid() and m.role in ('mcp', 'vp_finance'))
  order by p.name;
$$;

revoke execute on function is_mc_mcp_of_lc(uuid)                from public, anon;
revoke execute on function can_read_finance(uuid)               from public, anon;
revoke execute on function can_write_finance(uuid, text)        from public, anon;
revoke execute on function set_university_account(uuid, boolean) from public, anon;
revoke execute on function mc_finance_lcs(uuid)                 from public, anon;
grant  execute on function is_mc_mcp_of_lc(uuid)                to authenticated;
grant  execute on function can_read_finance(uuid)               to authenticated;
grant  execute on function can_write_finance(uuid, text)        to authenticated;
grant  execute on function set_university_account(uuid, boolean) to authenticated;
grant  execute on function mc_finance_lcs(uuid)                 to authenticated;

notify pgrst, 'reload schema';
