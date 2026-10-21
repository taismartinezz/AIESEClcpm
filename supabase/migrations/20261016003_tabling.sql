-- Migration 033: Tabling: shift slots, sign-ups and the after-slot log.
--
--   tabling_slots    VPs and the president create slots (optionally repeating
--                    weekly). Everyone in the LC sees them, including `taken`.
--   tabling_signups  members sign up / withdraw only through tabling_sign_up()
--                    and tabling_withdraw(), until the slot starts. Sign-up locks
--                    the slot row (SELECT … FOR UPDATE) so two people can never
--                    both take the last place. After the slot starts, its
--                    creator (or the president) marks attended / no-show and
--                    can add walk-ins. Only attended time counts as hours.
--   reminders        signing up creates a personal reminder due the day before;
--                    withdrawing (or the slot being deleted) removes it.

create table if not exists tabling_slots (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  location      text not null check (length(trim(location)) > 0),
  purpose       text not null check (length(trim(purpose)) > 0),
  capacity      integer not null check (capacity between 1 and 50),
  taken         integer not null default 0,     -- maintained by trigger; non-walk-in sign-ups
  department_id uuid references departments(id) on delete set null,
  series_id     uuid,                           -- slots created together by "repeat weekly"
  created_by    uuid references user_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint tabling_slots_times check (ends_at > starts_at),
  constraint tabling_slots_not_overfull check (taken <= capacity)
);

create index if not exists tabling_slots_project_start_idx on tabling_slots (project_id, starts_at);

create table if not exists tabling_signups (
  slot_id      uuid not null references tabling_slots(id) on delete cascade,
  user_id      uuid not null references user_profiles(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  status       text not null default 'signed_up' check (status in ('signed_up', 'attended', 'no_show')),
  walk_in      boolean not null default false,
  signed_up_at timestamptz not null default now(),
  marked_by    uuid references user_profiles(id) on delete set null,
  marked_at    timestamptz,
  primary key (slot_id, user_id)
);

create index if not exists tabling_signups_user_idx on tabling_signups (project_id, user_id);

-- ── Who may manage a slot: its creator (while still exec) or the president ──

create or replace function can_manage_tabling_slot(p_slot_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from tabling_slots s
    where s.id = p_slot_id
      and (is_lc_president(s.project_id) or (s.created_by = auth.uid() and is_lc_exec(s.project_id)))
  );
$$;

-- ── Keep `taken` in step with sign-ups; tidy reminders on removal ────────────

create or replace function _tabling_signups_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and not new.walk_in then
    update tabling_slots set taken = taken + 1 where id = new.slot_id;  -- check constraint guards capacity
  elsif tg_op = 'DELETE' then
    if not old.walk_in then
      update tabling_slots set taken = greatest(taken - 1, 0) where id = old.slot_id;
    end if;
    delete from reminders
     where user_id = old.user_id and kind = 'tabling' and linked_event_id = old.slot_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_tabling_signups_changed on tabling_signups;
create trigger trg_tabling_signups_changed
  after insert or delete on tabling_signups
  for each row execute function _tabling_signups_changed();

create or replace function _tabling_slot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.department_id is not null and not exists (
    select 1 from departments where id = new.department_id and project_id = new.project_id
  ) then
    raise exception 'Department does not belong to this LC';
  end if;
  if tg_op = 'UPDATE' and new.capacity < old.taken then
    raise exception 'Capacity can''t be lower than the % people already signed up', old.taken;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tabling_slot_guard on tabling_slots;
create trigger trg_tabling_slot_guard
  before insert or update on tabling_slots
  for each row execute function _tabling_slot_guard();

-- ── Creating slots (with "repeat weekly until") ──────────────────────────────

create or replace function create_tabling_slots(
  p_project_id    uuid,
  p_starts_at     timestamptz,
  p_ends_at       timestamptz,
  p_location      text,
  p_purpose       text,
  p_capacity      integer,
  p_department_id uuid default null,
  p_repeat_until  date default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series uuid := case when p_repeat_until is not null then gen_random_uuid() end;
  v_offset interval := interval '0';
  v_count  integer := 0;
begin
  if not is_lc_exec(p_project_id) then
    raise exception 'Only VPs and the president can create tabling slots';
  end if;
  if p_repeat_until is not null and p_repeat_until < p_starts_at::date then
    raise exception 'Repeat-until date is before the first slot';
  end if;

  loop
    insert into tabling_slots (project_id, starts_at, ends_at, location, purpose, capacity, department_id, series_id, created_by)
    values (p_project_id, p_starts_at + v_offset, p_ends_at + v_offset, trim(p_location), trim(p_purpose),
            p_capacity, p_department_id, v_series, auth.uid());
    v_count  := v_count + 1;
    v_offset := v_offset + interval '7 days';
    exit when p_repeat_until is null
           or (p_starts_at + v_offset)::date > p_repeat_until
           or v_count >= 52;   -- at most a year of weekly slots per call
  end loop;
  return v_count;
end;
$$;

-- ── Signing up and withdrawing ───────────────────────────────────────────────

create or replace function tabling_sign_up(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot tabling_slots%rowtype;
begin
  -- Lock the slot so concurrent sign-ups for the last place run one at a time.
  select * into v_slot from tabling_slots where id = p_slot_id for update;
  if not found or not auth_is_project_member(v_slot.project_id) then
    raise exception 'Slot not found';
  end if;
  if v_slot.starts_at <= now() then
    raise exception 'This slot has already started';
  end if;
  if exists (select 1 from tabling_signups where slot_id = p_slot_id and user_id = auth.uid()) then
    return;  -- already signed up
  end if;
  if v_slot.taken >= v_slot.capacity then
    raise exception 'This slot is full';
  end if;

  insert into tabling_signups (slot_id, user_id, project_id) values (p_slot_id, auth.uid(), v_slot.project_id);

  insert into reminders (user_id, project_id, scope, title, due_at, kind, linked_event_id, email_enabled, sent, completed)
  values (auth.uid(), v_slot.project_id, 'personal',
          'Tabling tomorrow: ' || v_slot.purpose || ' (' || v_slot.location || ')',
          greatest(v_slot.starts_at - interval '1 day', now()),
          'tabling', p_slot_id, false, false, false);
end;
$$;

create or replace function tabling_withdraw(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot tabling_slots%rowtype;
begin
  select * into v_slot from tabling_slots where id = p_slot_id for update;
  if not found then
    raise exception 'Slot not found';
  end if;
  if v_slot.starts_at <= now() then
    raise exception 'You can''t withdraw once the slot has started';
  end if;
  delete from tabling_signups where slot_id = p_slot_id and user_id = auth.uid() and not walk_in;
end;
$$;

-- ── After the slot: attended / no-show, walk-ins ─────────────────────────────

create or replace function tabling_mark(p_slot_id uuid, p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot tabling_slots%rowtype;
begin
  select * into v_slot from tabling_slots where id = p_slot_id;
  if not found or not can_manage_tabling_slot(p_slot_id) then
    raise exception 'Only the slot''s creator or the president can mark attendance';
  end if;
  if v_slot.starts_at > now() then
    raise exception 'Attendance can be marked once the slot has started';
  end if;
  if p_status not in ('attended', 'no_show', 'signed_up') then
    raise exception 'Unknown status %', p_status;
  end if;

  update tabling_signups
     set status = p_status,
         marked_by = case when p_status = 'signed_up' then null else auth.uid() end,
         marked_at = case when p_status = 'signed_up' then null else now() end
   where slot_id = p_slot_id and user_id = p_user_id;
  if not found then
    raise exception 'That person did not sign up for this slot';
  end if;
end;
$$;

create or replace function tabling_add_walk_in(p_slot_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot tabling_slots%rowtype;
begin
  select * into v_slot from tabling_slots where id = p_slot_id;
  if not found or not can_manage_tabling_slot(p_slot_id) then
    raise exception 'Only the slot''s creator or the president can add walk-ins';
  end if;
  if v_slot.starts_at > now() then
    raise exception 'Walk-ins can be added once the slot has started';
  end if;
  if not exists (select 1 from team_members where project_id = v_slot.project_id and user_id = p_user_id) then
    raise exception 'Walk-ins must be members of this LC';
  end if;
  insert into tabling_signups (slot_id, user_id, project_id, status, walk_in, marked_by, marked_at)
  values (p_slot_id, p_user_id, v_slot.project_id, 'attended', true, auth.uid(), now())
  on conflict (slot_id, user_id) do update set status = 'attended', marked_by = auth.uid(), marked_at = now();
end;
$$;

revoke execute on function create_tabling_slots(uuid, timestamptz, timestamptz, text, text, integer, uuid, date) from public, anon;
revoke execute on function tabling_sign_up(uuid)             from public, anon;
revoke execute on function tabling_withdraw(uuid)            from public, anon;
revoke execute on function tabling_mark(uuid, uuid, text)    from public, anon;
revoke execute on function tabling_add_walk_in(uuid, uuid)   from public, anon;
grant  execute on function create_tabling_slots(uuid, timestamptz, timestamptz, text, text, integer, uuid, date) to authenticated;
grant  execute on function tabling_sign_up(uuid)             to authenticated;
grant  execute on function tabling_withdraw(uuid)            to authenticated;
grant  execute on function tabling_mark(uuid, uuid, text)    to authenticated;
grant  execute on function tabling_add_walk_in(uuid, uuid)   to authenticated;

-- ── Report: hours (attended only), no-shows and sign-ups per member ──────────
-- President: everyone. VP: members of departments they lead, plus themselves.
-- Member: only themselves.

create or replace function tabling_report(p_project_id uuid, p_from date default null, p_to date default null)
returns table (user_id uuid, hours numeric, attended integer, no_shows integer, upcoming integer)
language plpgsql
security definer
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role text := lc_role(p_project_id);
begin
  if v_role is null then
    return;
  end if;
  return query
  select su.user_id,
         round(coalesce(sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600)
                         filter (where su.status = 'attended'), 0)::numeric, 2),
         (count(*) filter (where su.status = 'attended'))::integer,
         (count(*) filter (where su.status = 'no_show'))::integer,
         (count(*) filter (where su.status = 'signed_up' and s.starts_at > now()))::integer
  from   tabling_signups su
  join   tabling_slots s on s.id = su.slot_id
  where  su.project_id = p_project_id
    and  (p_from is null or s.starts_at::date >= p_from)
    and  (p_to   is null or s.starts_at::date <= p_to)
    and  (
           v_role = 'president'
        or su.user_id = auth.uid()
        or (v_role = 'vp' and in_led_department(p_project_id, su.user_id))
    )
  group  by su.user_id;
end;
$$;

revoke execute on function tabling_report(uuid, date, date) from public, anon;
grant  execute on function tabling_report(uuid, date, date) to authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table tabling_slots   enable row level security;
alter table tabling_signups enable row level security;

drop policy if exists "lc members see tabling slots" on tabling_slots;
create policy "lc members see tabling slots" on tabling_slots
  for select using (auth_is_project_member(project_id));

drop policy if exists "creator or president edits slots" on tabling_slots;
create policy "creator or president edits slots" on tabling_slots
  for update using (can_manage_tabling_slot(id)) with check (is_lc_exec(project_id));

drop policy if exists "creator or president deletes slots" on tabling_slots;
create policy "creator or president deletes slots" on tabling_slots
  for delete using (can_manage_tabling_slot(id));

-- No insert policy: slots are created through create_tabling_slots().
-- No insert/update/delete policies on sign-ups: only the functions above write them.

drop policy if exists "sign-up visibility by role" on tabling_signups;
create policy "sign-up visibility by role" on tabling_signups
  for select using (
    user_id = auth.uid()
    or is_lc_president(project_id)
    or can_manage_tabling_slot(slot_id)
    or (is_lc_exec(project_id) and in_led_department(project_id, user_id))
  );

notify pgrst, 'reload schema';
