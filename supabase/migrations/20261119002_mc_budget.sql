-- Migration 080: the MC's own budget, budget vs actuals (as in the MC Budget Tool sheet).
--
--   mc_budget_lines     one row per account code in a fiscal year (July to June;
--                       fy_start 2026 is "26.27"). A line can have sub-lines
--                       (6251 Strategic Fund > 6251-01 ...), one level deep.
--                       prev_budget  last year's budget (Budget 25.26)
--                       budget       this year's budget (Budget 26.27)
--                       month_budgets the plan per month, July first (optional)
--                       notes        comments on the line
--   mc_budget_payments  the actuals: any number of payments per line, each with
--                       a date, the amount spent, what it was, tags (for
--                       example "FallCo 2026") and a comment. A negative amount
--                       is a refund.
--
--   Who reads: the MCP and the MC VP Finance of that MC. Nobody else, and no LC.
--   Who writes: the MC VP Finance; the MCP too while the MC has no VP Finance.
--   LC accounts stay private to their LC (migration 20261110001): this is only
--   the MC's own money.
--
-- Grants are written out: some projects don't expose new objects automatically.

create table if not exists mc_budget_lines (
  id            uuid primary key default gen_random_uuid(),
  mc_id         uuid not null references mcs(id) on delete cascade,
  fy_start      int  not null check (fy_start between 2000 and 2100),
  code          text not null check (length(trim(code)) between 1 and 20),
  name          text not null check (length(trim(name)) between 1 and 120),
  parent_id     uuid references mc_budget_lines(id) on delete cascade,
  prev_budget   numeric(14, 2),
  budget        numeric(14, 2) not null default 0,
  month_budgets numeric(14, 2)[] check (month_budgets is null or (array_ndims(month_budgets) = 1 and cardinality(month_budgets) = 12)),
  notes         text check (notes is null or length(notes) <= 2000),
  sort_order    int  not null default 0,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (mc_id, fy_start, code)
);
create index if not exists mc_budget_lines_mc_fy_idx on mc_budget_lines (mc_id, fy_start, sort_order);

create table if not exists mc_budget_payments (
  id          uuid primary key default gen_random_uuid(),
  line_id     uuid not null references mc_budget_lines(id) on delete cascade,
  mc_id       uuid not null references mcs(id) on delete cascade,
  paid_on     date not null,
  amount      numeric(14, 2) not null check (amount <> 0),
  description text not null check (length(trim(description)) between 1 and 200),
  tags        text[] not null default '{}' check (cardinality(tags) <= 10),
  comment     text check (comment is null or length(comment) <= 2000),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists mc_budget_payments_line_idx on mc_budget_payments (line_id, paid_on);
create index if not exists mc_budget_payments_mc_idx   on mc_budget_payments (mc_id, paid_on);

-- ── Who may read and write ───────────────────────────────────────────────────

create or replace function can_read_mc_budget(p_mc_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from mc_members where mc_id = p_mc_id and user_id = auth.uid() and role in ('mcp', 'vp_finance'));
$$;

create or replace function can_keep_mc_budget(p_mc_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from mc_members where mc_id = p_mc_id and user_id = auth.uid() and role = 'vp_finance')
      or (exists (select 1 from mc_members where mc_id = p_mc_id and user_id = auth.uid() and role = 'mcp')
          and not exists (select 1 from mc_members where mc_id = p_mc_id and role = 'vp_finance'));
$$;

-- ── Keeping rows consistent ──────────────────────────────────────────────────

-- A sub-line sits under a top-level line of the same MC and year.
create or replace function _mc_budget_lines_check()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent mc_budget_lines;
begin
  new.code := trim(new.code);
  new.name := trim(new.name);
  new.updated_at := now();
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'A line can''t sit under itself'; end if;
    select * into v_parent from mc_budget_lines where id = new.parent_id;
    if not found or v_parent.mc_id <> new.mc_id or v_parent.fy_start <> new.fy_start then
      raise exception 'A sub-line must sit under a line of the same budget year';
    end if;
    if v_parent.parent_id is not null then raise exception 'Sub-lines go one level deep'; end if;
    if exists (select 1 from mc_budget_lines where parent_id = new.id) then
      raise exception 'This line has sub-lines, so it can''t become one';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.mc_id <> old.mc_id or new.fy_start <> old.fy_start) then
    raise exception 'A line stays in its MC and budget year';
  end if;
  return new;
end;
$$;

drop trigger if exists mc_budget_lines_check on mc_budget_lines;
create trigger mc_budget_lines_check before insert or update on mc_budget_lines
  for each row execute function _mc_budget_lines_check();

-- A payment belongs to its line's MC, and falls inside that line's year (1 July to 30 June).
create or replace function _mc_budget_payments_check()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_line mc_budget_lines;
begin
  select * into v_line from mc_budget_lines where id = new.line_id;
  if not found then raise exception 'No such budget line'; end if;
  new.mc_id := v_line.mc_id;
  new.description := trim(new.description);
  new.tags := coalesce((select array_agg(distinct t order by t) from unnest(new.tags) x, lateral (select trim(x) as t) y where t <> '' and length(t) <= 40), '{}');
  new.updated_at := now();
  if new.paid_on < make_date(v_line.fy_start, 7, 1) or new.paid_on > make_date(v_line.fy_start + 1, 6, 30) then
    raise exception 'The date must fall in the budget year (1 July % to 30 June %)', v_line.fy_start, v_line.fy_start + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists mc_budget_payments_check on mc_budget_payments;
create trigger mc_budget_payments_check before insert or update on mc_budget_payments
  for each row execute function _mc_budget_payments_check();

-- ── Row-level security ───────────────────────────────────────────────────────

alter table mc_budget_lines    enable row level security;
alter table mc_budget_payments enable row level security;

drop policy if exists "mc finance reads the budget"  on mc_budget_lines;
drop policy if exists "mc finance adds lines"        on mc_budget_lines;
drop policy if exists "mc finance edits lines"       on mc_budget_lines;
drop policy if exists "mc finance removes lines"     on mc_budget_lines;
create policy "mc finance reads the budget" on mc_budget_lines for select using (can_read_mc_budget(mc_id));
create policy "mc finance adds lines"       on mc_budget_lines for insert with check (can_keep_mc_budget(mc_id));
create policy "mc finance edits lines"      on mc_budget_lines for update using (can_keep_mc_budget(mc_id)) with check (can_keep_mc_budget(mc_id));
create policy "mc finance removes lines"    on mc_budget_lines for delete using (can_keep_mc_budget(mc_id));

drop policy if exists "mc finance reads payments"    on mc_budget_payments;
drop policy if exists "mc finance records payments"  on mc_budget_payments;
drop policy if exists "mc finance edits payments"    on mc_budget_payments;
drop policy if exists "mc finance removes payments"  on mc_budget_payments;
create policy "mc finance reads payments"   on mc_budget_payments for select using (can_read_mc_budget(mc_id));
-- The trigger sets mc_id from the line, so checking it covers the line's MC.
create policy "mc finance records payments" on mc_budget_payments for insert with check (can_keep_mc_budget(mc_id));
create policy "mc finance edits payments"   on mc_budget_payments for update using (can_keep_mc_budget(mc_id)) with check (can_keep_mc_budget(mc_id));
create policy "mc finance removes payments" on mc_budget_payments for delete using (can_keep_mc_budget(mc_id));

revoke all on table mc_budget_lines, mc_budget_payments from anon;
grant select, insert, update, delete on table mc_budget_lines, mc_budget_payments to authenticated;

revoke execute on function can_read_mc_budget(uuid)        from public, anon;
revoke execute on function can_keep_mc_budget(uuid)        from public, anon;
revoke execute on function _mc_budget_lines_check()        from public, anon, authenticated;
revoke execute on function _mc_budget_payments_check()     from public, anon, authenticated;
grant  execute on function can_read_mc_budget(uuid)        to authenticated;
grant  execute on function can_keep_mc_budget(uuid)        to authenticated;

notify pgrst, 'reload schema';
