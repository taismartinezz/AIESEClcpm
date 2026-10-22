-- Migration 059: Finance follows the MC's National Finance Tracker, and only
-- the MC VP Finance changes it.
--
--   finance_entries   new columns from the tracker: payment_method,
--                     processed_via, area (MXP, OGX, LCP, F&L…), notes; and an
--                     'opening' type for the opening balance (not income).
--   projects          currency defaults to USD; finance_reviewed_on = the
--                     last time the MC reviewed the account ("growth since").
--   mc_members.role   'vp_finance': named by the MCP. They see and keep the
--                     ledger of every LC linked to their MC.
--   Who may do what (enforced here, not just in the UI):
--     MC VP Finance            read, add, edit, delete, import, approve claims
--     LCP and VPs              read the ledger; submit claims
--     members                  submit and see their own claims only
--   finance_entry_changes    who changed an entry, when, old → new.
--   import_finance_entries() the tracker import; skips rows already there
--                            (same date, description and amount).

-- ── 1. Tracker columns ───────────────────────────────────────────────────────

alter table finance_entries
  add column if not exists payment_method text,
  add column if not exists processed_via  text,
  add column if not exists area           text,
  add column if not exists notes          text;

alter table finance_entries drop constraint if exists finance_entries_type_check;
alter table finance_entries add constraint finance_entries_type_check check (type in ('income', 'expense', 'opening'));

alter table expense_claims add column if not exists area text;

alter table projects alter column currency set default 'USD';
alter table projects add column if not exists finance_reviewed_on date;

-- ── 2. MC VP Finance ─────────────────────────────────────────────────────────

alter table mc_members drop constraint if exists mc_members_role_check;
alter table mc_members add constraint mc_members_role_check check (role in ('mcp', 'member', 'vp_finance'));

-- Is the caller the VP Finance of the MC this LC is linked to?
create or replace function is_mc_vp_finance(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from projects p
    join mc_members m on m.mc_id = p.mc_id
    where p.id = p_project_id and m.user_id = auth.uid() and m.role = 'vp_finance'
  );
$$;

-- For the LC: does it have someone who can keep its books? (Banner when not.)
create or replace function lc_finance_keeper(p_project_id uuid)
returns table (has_keeper boolean, reviewed_on date)
language sql
security definer
stable
set search_path = public
as $$
  select exists (
           select 1 from projects p join mc_members m on m.mc_id = p.mc_id
           where p.id = p_project_id and m.role = 'vp_finance'
         ),
         (select finance_reviewed_on from projects where id = p_project_id)
  where auth_is_project_member(p_project_id) or is_mc_vp_finance(p_project_id);
$$;

-- The MCP names (or un-names) a VP Finance among the MC's members.
create or replace function set_mc_member_role(p_mc_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_mcp(p_mc_id) then raise exception 'Only the MCP can change MC roles'; end if;
  if p_role not in ('member', 'vp_finance') then raise exception 'Unknown role %', p_role; end if;
  update mc_members set role = p_role where mc_id = p_mc_id and user_id = p_user_id and role <> 'mcp';
  if not found then raise exception 'That person is not a member of this MC (or is the MCP)'; end if;
end;
$$;

-- The LCs whose books the caller keeps, with what the Finance page needs.
create or replace function mc_finance_lcs()
returns table (project_id uuid, name text, currency text, term_start_date date, finance_reviewed_on date)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.name, p.currency, p.term_start_date, p.finance_reviewed_on
  from projects p
  join mc_members m on m.mc_id = p.mc_id
  where m.user_id = auth.uid() and m.role = 'vp_finance' and not coalesce(p.is_demo, false)
  order by p.name;
$$;

-- The MC VP Finance records that they reviewed the account (growth "since").
create or replace function mark_finance_reviewed(p_project_id uuid, p_on date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_mc_vp_finance(p_project_id) then raise exception 'Only the MC VP Finance can do this'; end if;
  update projects set finance_reviewed_on = p_on where id = p_project_id;
end;
$$;

revoke execute on function is_mc_vp_finance(uuid)                 from public, anon;
revoke execute on function lc_finance_keeper(uuid)                from public, anon;
revoke execute on function set_mc_member_role(uuid, uuid, text)   from public, anon;
revoke execute on function mc_finance_lcs()                       from public, anon;
revoke execute on function mark_finance_reviewed(uuid, date)      from public, anon;
grant  execute on function is_mc_vp_finance(uuid)                 to authenticated;
grant  execute on function lc_finance_keeper(uuid)                to authenticated;
grant  execute on function set_mc_member_role(uuid, uuid, text)   to authenticated;
grant  execute on function mc_finance_lcs()                       to authenticated;
grant  execute on function mark_finance_reviewed(uuid, date)      to authenticated;

-- ── 3. Who may read and change the ledger ────────────────────────────────────

create or replace function can_read_finance(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_mc_vp_finance(p_project_id) or coalesce(lc_role(p_project_id) in ('president', 'vp'), false);
$$;
revoke execute on function can_read_finance(uuid) from public, anon;
grant  execute on function can_read_finance(uuid) to authenticated;

drop policy if exists "finance lead and department VPs read ledger" on finance_entries;
drop policy if exists "finance lead records entries"                on finance_entries;
drop policy if exists "finance lead edits manual entries"           on finance_entries;
drop policy if exists "finance lead deletes manual entries"         on finance_entries;

create policy "LC exec and MC VP Finance read the ledger" on finance_entries
  for select using (can_read_finance(project_id));
create policy "MC VP Finance records entries" on finance_entries
  for insert with check (is_mc_vp_finance(project_id) and claim_id is null and recorded_by = auth.uid());
-- Entries made by an approved claim follow the claim (un-approving removes them).
create policy "MC VP Finance edits entries" on finance_entries
  for update using (is_mc_vp_finance(project_id) and claim_id is null) with check (is_mc_vp_finance(project_id) and claim_id is null);
create policy "MC VP Finance deletes manual entries" on finance_entries
  for delete using (is_mc_vp_finance(project_id) and claim_id is null);

-- ── 4. Claims: the MC VP Finance approves ────────────────────────────────────

drop policy if exists "claims visible to submitter, finance lead, department VP" on expense_claims;
create policy "claims visible to submitter, finance lead, department VP" on expense_claims
  for select using (
    submitted_by = auth.uid()
    or is_finance_lead(project_id)
    or is_mc_vp_finance(project_id)
    or department_id in (select led_department_ids(project_id))
  );

create or replace function _expense_claim_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and (new.status <> 'pending' or new.reviewed_by is not null) then
      raise exception 'New claims start as pending';
    end if;
    return new;
  end if;
  if (new.status, new.rejection_reason, new.reviewed_by, new.reviewed_at)
       is distinct from (old.status, old.rejection_reason, old.reviewed_by, old.reviewed_at)
     and auth.uid() is not null
     and not is_mc_vp_finance(new.project_id) then
    raise exception 'Only your MC VP Finance can approve or reject claims';
  end if;
  if new.submitted_by <> old.submitted_by or new.project_id <> old.project_id then
    raise exception 'A claim cannot change owner or LC';
  end if;
  return new;
end;
$$;

create or replace function review_expense_claim(p_claim_id uuid, p_status text, p_reason text default null)
returns expense_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim expense_claims%rowtype;
begin
  select * into v_claim from expense_claims where id = p_claim_id for update;
  if not found or not (auth_is_project_member(v_claim.project_id) or is_mc_vp_finance(v_claim.project_id)) then
    raise exception 'Claim not found';
  end if;
  if not is_mc_vp_finance(v_claim.project_id) then
    raise exception 'Only your MC VP Finance can approve or reject claims';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Unknown status %', p_status;
  end if;
  if p_status = 'rejected' and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Rejecting a claim requires a reason';
  end if;

  update expense_claims
     set status           = p_status,
         rejection_reason = case when p_status = 'rejected' then trim(p_reason) end,
         reviewed_by      = case when p_status = 'pending' then null else auth.uid() end,
         reviewed_at      = case when p_status = 'pending' then null else now() end
   where id = p_claim_id
  returning * into v_claim;
  return v_claim;
end;
$$;

-- Approval creates exactly one ledger entry, in the tracker's terms.
create or replace function _expense_claim_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'approved' then
    insert into finance_entries (project_id, type, amount, currency, entry_date, category_id, department_id,
                                 description, recorded_by, receipt_path, claim_id, area, notes)
    values (new.project_id, 'expense', new.amount, new.currency, new.expense_date, new.category_id, new.department_id,
            'Expense claim: ' || new.description, new.reviewed_by, new.receipt_path, new.id,
            coalesce(new.area, (select name from departments where id = new.department_id)),
            'Reimbursed the ' || to_char(current_date, 'MM/DD/YYYY'))
    on conflict (claim_id) do nothing;
  elsif old.status = 'approved' then
    delete from finance_entries where claim_id = new.id;
  end if;

  if new.status in ('approved', 'rejected') then
    insert into notifications (user_id, type, title, body, related_id, link_to, read)
    values (
      new.submitted_by,
      'claim_' || new.status,
      case new.status when 'approved' then 'Expense claim approved' else 'Expense claim rejected' end,
      case new.status
        when 'approved' then new.currency || ' ' || new.amount || ': ' || new.description
        else new.description || '. Reason: ' || new.rejection_reason
      end,
      new.id, '/finance', false
    );
  end if;
  return new;
end;
$$;

-- Receipts: the MC VP Finance reads them too (to check claims).
drop policy if exists "receipts: read own, finance lead, department VP" on storage.objects;
create policy "receipts: read own, finance lead, department VP" on storage.objects
  for select to authenticated using (
    bucket_id = 'receipts'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or is_finance_lead(_try_uuid((storage.foldername(name))[1]))
      or is_mc_vp_finance(_try_uuid((storage.foldername(name))[1]))
      or exists (
        select 1 from expense_claims c
        where c.receipt_path = storage.objects.name
          and c.department_id in (select led_department_ids(c.project_id))
      )
      or exists (
        select 1 from finance_entries e
        where e.receipt_path = storage.objects.name
          and e.department_id in (select led_department_ids(e.project_id))
      )
    )
  );

-- ── 5. Audit trail ───────────────────────────────────────────────────────────

create table if not exists finance_entry_changes (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null,                       -- kept after the entry is deleted
  project_id uuid not null references projects(id) on delete cascade,
  op         text not null check (op in ('insert', 'update', 'delete')),
  changed_by uuid references user_profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  old_values jsonb,
  new_values jsonb
);
create index if not exists finance_entry_changes_entry_idx on finance_entry_changes (entry_id, changed_at);

create or replace function _finance_entries_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by uuid := (select id from user_profiles where id = auth.uid());
  v_keep text[] := array['type', 'amount', 'entry_date', 'description', 'payment_method', 'processed_via', 'area', 'notes'];
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    -- The whole LC is being deleted (cascade): nothing to keep a log for.
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
    -- Only the fields that changed.
    insert into finance_entry_changes (entry_id, project_id, op, changed_by, old_values, new_values)
    select new.id, new.project_id, 'update', v_by,
           jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
    from unnest(v_keep) k
    where v_old -> k is distinct from v_new -> k;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_finance_entries_log on finance_entries;
create trigger trg_finance_entries_log
  after insert or update or delete on finance_entries
  for each row execute function _finance_entries_log();

alter table finance_entry_changes enable row level security;
drop policy if exists "finance readers see the change log" on finance_entry_changes;
create policy "finance readers see the change log" on finance_entry_changes
  for select using (can_read_finance(project_id));

-- ── 6. Import from the tracker ───────────────────────────────────────────────

-- p_rows: [{ date, type, amount, description, payment_method, processed_via, area, notes }]
-- Rows already in the ledger (same date, description and amount) are skipped.
create or replace function import_finance_entries(p_project_id uuid, p_rows jsonb)
returns table (inserted integer, updated integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_inserted integer := 0;
begin
  if not is_mc_vp_finance(p_project_id) then raise exception 'Only your MC VP Finance can import the finance tracker'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if (r ->> 'type') not in ('income', 'expense', 'opening') or (r ->> 'amount')::numeric <= 0 then
      raise exception 'Bad row: %', r;
    end if;
    if exists (
      select 1 from finance_entries
      where project_id = p_project_id and entry_date = (r ->> 'date')::date
        and description = coalesce(r ->> 'description', '') and amount = (r ->> 'amount')::numeric
    ) then continue; end if;
    insert into finance_entries (project_id, type, amount, entry_date, description, payment_method, processed_via, area, notes, recorded_by)
    values (p_project_id, r ->> 'type', (r ->> 'amount')::numeric, (r ->> 'date')::date, coalesce(r ->> 'description', ''),
            nullif(r ->> 'payment_method', ''), nullif(r ->> 'processed_via', ''), nullif(r ->> 'area', ''), nullif(r ->> 'notes', ''), auth.uid());
    v_inserted := v_inserted + 1;
  end loop;
  return query select v_inserted, 0;
end;
$$;
revoke execute on function import_finance_entries(uuid, jsonb) from public, anon;
grant  execute on function import_finance_entries(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
