-- Migration 074: membership criteria (the planning template's "Membership
-- criteria"): what an LC must meet to keep full-member status.
--
--   lc_compliance_info     what the app can't know: BoA members, university
--                          affiliation, and a debt repayment plan when the
--                          balance is below zero. Set by the LC's execs.
--   lc_compliance_checks   monthly deadlines ticked off: 'sona' (to the MC by
--                          the 1st) and 'hr_report' (HR data, by the end of the
--                          month), one row per kind and month.
--   lc_compliance(lc)      for the LC's execs, in one call: the bank balance
--                          (from the books, which not every exec may read),
--                          outgoing approvals and partner meetings in the last
--                          12 months, the info above and the monthly checks.
--                          The app turns it into green / yellow / red.
--
-- Grants are written out: some projects don't expose new objects automatically.

create table if not exists lc_compliance_info (
  project_id            uuid primary key references projects(id) on delete cascade,
  boa_members           smallint not null default 0 check (boa_members between 0 and 50),
  university_affiliated boolean not null default false,
  debt_plan             text check (debt_plan is null or length(debt_plan) <= 2000),
  updated_by            uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at            timestamptz not null default now()
);

create table if not exists lc_compliance_checks (
  project_id uuid not null references projects(id) on delete cascade,
  kind       text not null check (kind in ('sona', 'hr_report')),
  month      date not null check (extract(day from month) = 1),     -- the month it's for
  done_on    date not null default current_date,
  done_by    uuid references auth.users(id) on delete set null default auth.uid(),
  primary key (project_id, kind, month)
);

alter table lc_compliance_info   enable row level security;
alter table lc_compliance_checks enable row level security;
grant select, insert, update, delete on lc_compliance_info, lc_compliance_checks to authenticated;
grant select, insert, update, delete on lc_compliance_info, lc_compliance_checks to service_role;

drop policy if exists "lc execs keep compliance info" on lc_compliance_info;
create policy "lc execs keep compliance info" on lc_compliance_info
  for all using (is_lc_exec(project_id)) with check (is_lc_exec(project_id));

drop policy if exists "lc execs tick compliance checks" on lc_compliance_checks;
create policy "lc execs tick compliance checks" on lc_compliance_checks
  for all using (is_lc_exec(project_id)) with check (is_lc_exec(project_id));

create or replace function lc_compliance(p_project_id uuid)
returns table (
  balance numeric, currency text, approvals_12m integer, meetings_12m integer,
  boa_members integer, university_affiliated boolean, debt_plan text, checks jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
begin
  if not is_lc_exec(p_project_id) then
    return;
  end if;
  return query
  select
    -- Income and the opening balance add; expenses subtract.
    coalesce((select sum(case when f.type = 'expense' then -f.amount else f.amount end) from finance_entries f where f.project_id = p_project_id), 0),
    (select p.currency from projects p where p.id = p_project_id),
    (select count(*)::int from exchanges e where e.project_id = p_project_id
       and e.product in ('ogv', 'ogta', 'ogte') and e.approved_at > current_date - 365),
    (select count(*)::int from partner_activities a join partners pa on pa.id = a.partner_id
       where pa.project_id = p_project_id and a.kind = 'meeting' and a.happened_on > current_date - 365),
    coalesce((select i.boa_members::int from lc_compliance_info i where i.project_id = p_project_id), 0),
    coalesce((select i.university_affiliated from lc_compliance_info i where i.project_id = p_project_id), false),
    (select i.debt_plan from lc_compliance_info i where i.project_id = p_project_id),
    coalesce((select jsonb_agg(jsonb_build_object('kind', c.kind, 'month', c.month, 'done_on', c.done_on) order by c.month)
              from lc_compliance_checks c where c.project_id = p_project_id and c.month > current_date - 400), '[]'::jsonb);
end;
$$;

revoke execute on function lc_compliance(uuid) from public, anon;
grant  execute on function lc_compliance(uuid) to authenticated;

notify pgrst, 'reload schema';
