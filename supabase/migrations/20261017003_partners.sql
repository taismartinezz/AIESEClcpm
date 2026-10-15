-- Migration 036: Partner CRM (Business Development, iGT and anyone working with companies).
--
--   partners            company / organisation, stage, owner, next follow-up.
--   partner_contacts    people at the partner (names, emails, phones).
--   partner_activities  dated log of calls, emails, meetings and notes.
--
-- Visibility: the executive board (president and VPs) sees every partner;
-- other members see their own department's partners and the ones they own.
-- Contacts and activities follow their partner.

create table if not exists partners (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  industry       text,
  website        text check (website is null or website ~* '^https?://'),
  stage          text not null default 'lead'
                 check (stage in ('lead', 'contacted', 'meeting', 'proposal', 'negotiation', 'partner', 'lost')),
  department_id  uuid references departments(id) on delete set null,
  owner_id       uuid references user_profiles(id) on delete set null,
  next_follow_up date,
  notes          text,
  created_by     uuid references user_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists partners_project_stage_idx on partners (project_id, stage);
create index if not exists partners_follow_up_idx on partners (project_id, owner_id, next_follow_up);

create table if not exists partner_contacts (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references partners(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  role_title  text,
  email       text,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists partner_activities (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references partners(id) on delete cascade,
  kind        text not null default 'note' check (kind in ('note', 'call', 'email', 'meeting')),
  body        text not null check (length(trim(body)) > 0),
  happened_on date not null default current_date,
  author_id   uuid references user_profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists partner_activities_partner_idx on partner_activities (partner_id, happened_on desc);

create or replace function _partners_guard()
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
  if new.owner_id is not null and not exists (
    select 1 from team_members where project_id = new.project_id and user_id = new.owner_id
  ) then
    raise exception 'The owner must be a member of this LC';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_partners_guard on partners;
create trigger trg_partners_guard
  before insert or update on partners
  for each row execute function _partners_guard();

-- The caller's own department in an LC (null if none).
create or replace function my_department_id(p_project_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select department_id from team_members where project_id = p_project_id and user_id = auth.uid();
$$;

-- Partner visibility from the row's own columns (usable while the row is being
-- inserted, unlike a lookup by id).
create or replace function partner_visible(p_project_id uuid, p_department_id uuid, p_owner_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_lc_exec(p_project_id)
      or p_owner_id = auth.uid()
      or (p_department_id is not null and p_department_id = my_department_id(p_project_id));
$$;

-- Can the caller see / work on an existing partner? (for contacts and activities)
create or replace function can_work_on_partner(p_partner_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from partners p
    where p.id = p_partner_id and partner_visible(p.project_id, p.department_id, p.owner_id)
  );
$$;

alter table partners           enable row level security;
alter table partner_contacts   enable row level security;
alter table partner_activities enable row level security;

drop policy if exists "partners visible to exec, department and owner" on partners;
create policy "partners visible to exec, department and owner" on partners
  for select using (partner_visible(project_id, department_id, owner_id));

drop policy if exists "members add partners for their department" on partners;
create policy "members add partners for their department" on partners
  for insert with check (
    created_by = auth.uid()
    and auth_is_project_member(project_id)
    and (
      is_lc_exec(project_id)
      or department_id = my_department_id(project_id)
    )
  );

drop policy if exists "people who can see a partner can update it" on partners;
create policy "people who can see a partner can update it" on partners
  for update using (partner_visible(project_id, department_id, owner_id)) with check (auth_is_project_member(project_id));

drop policy if exists "president, department VP or creator deletes partners" on partners;
create policy "president, department VP or creator deletes partners" on partners
  for delete using (
    is_lc_president(project_id)
    or created_by = auth.uid()
    or (department_id is not null and department_id in (select led_department_ids(project_id)))
  );

drop policy if exists "contacts follow their partner" on partner_contacts;
create policy "contacts follow their partner" on partner_contacts
  for all using (can_work_on_partner(partner_id)) with check (can_work_on_partner(partner_id));

drop policy if exists "activities follow their partner" on partner_activities;
create policy "activities follow their partner" on partner_activities
  for select using (can_work_on_partner(partner_id));

drop policy if exists "log activity on visible partners" on partner_activities;
create policy "log activity on visible partners" on partner_activities
  for insert with check (can_work_on_partner(partner_id) and author_id = auth.uid());

drop policy if exists "authors edit their own activity" on partner_activities;
create policy "authors edit their own activity" on partner_activities
  for delete using (author_id = auth.uid());

notify pgrst, 'reload schema';
