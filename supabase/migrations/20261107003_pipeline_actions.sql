-- Migration 062: pipeline actions.
--
-- 1. Round-robin: a new exchange with no owner goes to the next member of the
--    department that runs the product (members whose term hasn't ended; VPs
--    aren't in the rotation). The department remembers who got the last one.
--    The president turns it off per department (departments.auto_assign).
-- 2. Contact log: calls, WhatsApps, emails and meetings with an EP. The first
--    one (notes don't count) sets exchanges.first_contacted_at, which the app
--    uses for the "contact within 48h" rule.
-- 3. Drop reason: an exchange can be marked dropped (price, parents, timing,
--    ghosted, other) without losing the stage it reached.
-- 4. Checklist: per-stage items (prep session, visa, insurance...) ticked off
--    per exchange. The items are defined in the app; the table stores ticks.
-- 5. NPS: the 0-10 score (and comment) an EP gives after the exchange.

-- ── 1. Round-robin ───────────────────────────────────────────────────────────

alter table departments
  add column if not exists auto_assign           boolean not null default true,
  add column if not exists last_assigned_user_id uuid references user_profiles(id) on delete set null;

-- Runs after trg_exchanges_guard (triggers fire in name order), so the
-- department is already filled in.
create or replace function _exchanges_round_robin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auto boolean;
  v_last uuid;
  v_next uuid;
begin
  if new.owner_id is not null or new.department_id is null then
    return new;
  end if;
  select auto_assign, last_assigned_user_id into v_auto, v_last
  from departments where id = new.department_id
  for update;
  if not coalesce(v_auto, false) then
    return new;
  end if;

  -- The member after the last one assigned, wrapping around.
  select tm.user_id into v_next
  from team_members tm
  where tm.project_id = new.project_id
    and tm.department_id = new.department_id
    and tm.role = 'member'
    and (tm.term_end is null or tm.term_end >= current_date)
  order by (v_last is not null and tm.user_id::text <= v_last::text), tm.user_id::text
  limit 1;
  if v_next is null then
    return new;
  end if;

  new.owner_id := v_next;
  update departments set last_assigned_user_id = v_next where id = new.department_id;
  return new;
end;
$$;

drop trigger if exists trg_exchanges_round_robin on exchanges;
create trigger trg_exchanges_round_robin
  before insert on exchanges
  for each row execute function _exchanges_round_robin();

-- ── 2-5. New columns on exchanges ────────────────────────────────────────────

alter table exchanges
  add column if not exists first_contacted_at timestamptz,
  add column if not exists dropped_at         timestamptz,
  add column if not exists drop_reason        text,
  add column if not exists drop_note          text,
  add column if not exists nps                smallint,
  add column if not exists nps_comment        text;

alter table exchanges drop constraint if exists exchanges_drop_reason_check;
alter table exchanges add constraint exchanges_drop_reason_check
  check (drop_reason is null or drop_reason in ('price', 'parents', 'timing', 'ghosted', 'other'));
alter table exchanges drop constraint if exists exchanges_dropped_has_reason;
alter table exchanges add constraint exchanges_dropped_has_reason
  check ((dropped_at is null) = (drop_reason is null));
alter table exchanges drop constraint if exists exchanges_nps_check;
alter table exchanges add constraint exchanges_nps_check
  check (nps is null or nps between 0 and 10);
alter table exchanges drop constraint if exists exchanges_text_lengths;
alter table exchanges add constraint exchanges_text_lengths
  check (coalesce(length(drop_note), 0) <= 500 and coalesce(length(nps_comment), 0) <= 1000);

-- ── 2. Contact log ───────────────────────────────────────────────────────────

create table if not exists exchange_contacts (
  id          uuid primary key default gen_random_uuid(),
  exchange_id uuid not null references exchanges(id) on delete cascade,
  kind        text not null check (kind in ('call', 'whatsapp', 'email', 'meeting', 'note')),
  body        text check (body is null or length(body) <= 2000),
  happened_at timestamptz not null default now(),
  created_by  uuid references user_profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists exchange_contacts_exchange_idx on exchange_contacts (exchange_id, happened_at desc);

-- first_contacted_at = the earliest real contact, kept right when entries are
-- added or removed.
create or replace function _exchange_contacts_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(new.exchange_id, old.exchange_id);
begin
  update exchanges
  set first_contacted_at = (select min(happened_at) from exchange_contacts where exchange_id = v_id and kind <> 'note')
  where id = v_id;
  return null;
end;
$$;

drop trigger if exists trg_exchange_contacts_sync on exchange_contacts;
create trigger trg_exchange_contacts_sync
  after insert or update or delete on exchange_contacts
  for each row execute function _exchange_contacts_sync();

alter table exchange_contacts enable row level security;

drop policy if exists "see contacts of exchanges you can see" on exchange_contacts;
create policy "see contacts of exchanges you can see" on exchange_contacts
  for select using (exists (
    select 1 from exchanges e
    where e.id = exchange_contacts.exchange_id
      and can_work_on_exchange(e.project_id, e.department_id, e.owner_id)
  ));

drop policy if exists "log contacts on exchanges you work on" on exchange_contacts;
create policy "log contacts on exchanges you work on" on exchange_contacts
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from exchanges e
      where e.id = exchange_contacts.exchange_id
        and can_work_on_exchange(e.project_id, e.department_id, e.owner_id)
    )
  );

drop policy if exists "remove your own contact entries" on exchange_contacts;
create policy "remove your own contact entries" on exchange_contacts
  for delete using (
    created_by = auth.uid()
    and exists (
      select 1 from exchanges e
      where e.id = exchange_contacts.exchange_id
        and can_work_on_exchange(e.project_id, e.department_id, e.owner_id)
    )
  );

-- ── 4. Checklist ─────────────────────────────────────────────────────────────

create table if not exists exchange_checklist (
  exchange_id uuid not null references exchanges(id) on delete cascade,
  item_key    text not null check (item_key ~ '^[a-z][a-z_]{0,39}$'),
  done_by     uuid references user_profiles(id) on delete set null default auth.uid(),
  done_at     timestamptz not null default now(),
  primary key (exchange_id, item_key)
);

alter table exchange_checklist enable row level security;

drop policy if exists "see checklists of exchanges you can see" on exchange_checklist;
create policy "see checklists of exchanges you can see" on exchange_checklist
  for select using (exists (
    select 1 from exchanges e
    where e.id = exchange_checklist.exchange_id
      and can_work_on_exchange(e.project_id, e.department_id, e.owner_id)
  ));

drop policy if exists "tick checklists of exchanges you work on" on exchange_checklist;
create policy "tick checklists of exchanges you work on" on exchange_checklist
  for insert with check (
    done_by = auth.uid()
    and exists (
      select 1 from exchanges e
      where e.id = exchange_checklist.exchange_id
        and can_work_on_exchange(e.project_id, e.department_id, e.owner_id)
    )
  );

drop policy if exists "untick checklists of exchanges you work on" on exchange_checklist;
create policy "untick checklists of exchanges you work on" on exchange_checklist
  for delete using (exists (
    select 1 from exchanges e
    where e.id = exchange_checklist.exchange_id
      and can_work_on_exchange(e.project_id, e.department_id, e.owner_id)
  ));

notify pgrst, 'reload schema';
