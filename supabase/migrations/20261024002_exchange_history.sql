-- Migration 051: a history for each exchange.
--
-- "Applied Oct 2 → Accepted Oct 10 (Tais)": every stage change and every change
-- of owner is recorded with who made it and when, for handovers and MC
-- reporting. Rows are written only by the trigger below (no insert/update/delete
-- policies), and you can read the history of the exchanges you can see.

create table if not exists exchange_history (
  id          uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references exchanges(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  kind        text not null check (kind in ('created', 'stage', 'owner')),
  from_value  text,
  to_value    text,
  changed_by  uuid references user_profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);

create index if not exists exchange_history_exchange_idx on exchange_history (exchange_id, changed_at);

create or replace function _exchanges_log_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by uuid := (select id from user_profiles where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into exchange_history (exchange_id, project_id, kind, to_value, changed_by)
    values (new.id, new.project_id, 'created', new.stage, v_by);
    if new.owner_id is not null then
      insert into exchange_history (exchange_id, project_id, kind, to_value, changed_by)
      values (new.id, new.project_id, 'owner', new.owner_id::text, v_by);
    end if;
    return new;
  end if;

  if new.stage is distinct from old.stage then
    insert into exchange_history (exchange_id, project_id, kind, from_value, to_value, changed_by)
    values (new.id, new.project_id, 'stage', old.stage, new.stage, v_by);
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into exchange_history (exchange_id, project_id, kind, from_value, to_value, changed_by)
    values (new.id, new.project_id, 'owner', old.owner_id::text, new.owner_id::text, v_by);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_exchanges_log_history on exchanges;
create trigger trg_exchanges_log_history
  after insert or update on exchanges
  for each row execute function _exchanges_log_history();

alter table exchange_history enable row level security;

drop policy if exists "see the history of exchanges you can see" on exchange_history;
create policy "see the history of exchanges you can see" on exchange_history
  for select using (exists (
    select 1 from exchanges e
    where e.id = exchange_history.exchange_id
      and can_work_on_exchange(e.project_id, e.department_id, e.owner_id)
  ));

-- Exchanges that existed before this migration: one "created" row dated when
-- they were created, so their history isn't blank.
insert into exchange_history (exchange_id, project_id, kind, to_value, changed_by, changed_at)
select e.id, e.project_id, 'created', e.stage, e.created_by, e.created_at
from exchanges e
where not exists (select 1 from exchange_history h where h.exchange_id = e.id);

notify pgrst, 'reload schema';
