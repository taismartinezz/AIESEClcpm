-- Migration 031: Finance: ledger, categories and expense claims.
--
-- "In charge of finance" = the LC president, or a VP who leads a department
-- flagged departments.is_finance (Finance & Legality by default). That rule
-- lives in is_finance_lead() and is mirrored by isFinanceLead() in
-- src/lib/permissions.ts.
--
--   finance_categories  president edits; every member reads
--   finance_entries     the ledger. Finance lead: everything. Other VPs: entries
--                       tagged with a department they lead. Members: nothing.
--   expense_claims      anyone submits (pending); submitter sees their own; the
--                       finance lead sees all; other VPs see their departments'.
--                       Only review_expense_claim() changes the status, and only
--                       for the finance lead. Approving creates the matching
--                       ledger entry; moving away from approved deletes it.
--   storage 'receipts'  private bucket; files under <lc_id>/<user_id>/…; read via
--                       signed URLs by the uploader, the finance lead, or the VP
--                       of the claim's / entry's department.

-- ── 1. LC settings used by the new modules ───────────────────────────────────

alter table projects
  add column if not exists currency        text not null default 'EUR',
  add column if not exists term_start_date date;

alter table projects drop constraint if exists projects_currency_check;
alter table projects add constraint projects_currency_check check (currency ~ '^[A-Z]{3}$');

-- First day of the current AIESEC term: the president's setting, otherwise
-- 1 February (the usual term start) of this year, or last year before February.
create or replace function lc_term_start(p_project_id uuid)
returns date
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select term_start_date from projects where id = p_project_id),
    case when current_date >= make_date(extract(year from current_date)::int, 2, 1)
         then make_date(extract(year from current_date)::int, 2, 1)
         else make_date(extract(year from current_date)::int - 1, 2, 1)
    end
  );
$$;

-- ── 2. Who is in charge of finance ───────────────────────────────────────────

create or replace function is_finance_lead(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(lc_role(p_project_id) = 'president', false)
      or exists (
           select 1
           from   departments d
           join   team_members tm on tm.project_id = d.project_id and tm.user_id = auth.uid()
           where  d.project_id = p_project_id
             and  d.is_finance
             and  d.vp_user_id = auth.uid()
             and  tm.role = 'vp'
         );
$$;

-- Parses a path segment as a uuid, or null: storage paths are user input.
create or replace function _try_uuid(p text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- ── 3. Categories ─────────────────────────────────────────────────────────────

create table if not exists finance_categories (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (project_id, name)
);

create or replace function seed_default_finance_categories(p_project_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into finance_categories (project_id, name, sort_order)
  select p_project_id, c.name, c.ord
  from unnest(array['Conferences','Events','Marketing','Merchandise','Transport',
                    'Food','Sponsorship','Membership fees','Other'])
       with ordinality as c(name, ord)
  on conflict (project_id, name) do nothing;
$$;
revoke execute on function seed_default_finance_categories(uuid) from public, anon, authenticated;

create or replace function _seed_lc_finance_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_default_finance_categories(new.id);
  return new;
end;
$$;

drop trigger if exists trg_seed_lc_finance_categories on projects;
create trigger trg_seed_lc_finance_categories
  after insert on projects
  for each row execute function _seed_lc_finance_categories();

select seed_default_finance_categories(p.id)
from projects p
where not exists (select 1 from finance_categories c where c.project_id = p.id);

alter table finance_categories enable row level security;

drop policy if exists "lc members read finance categories" on finance_categories;
create policy "lc members read finance categories" on finance_categories
  for select using (auth_is_project_member(project_id));

drop policy if exists "president manages finance categories" on finance_categories;
create policy "president manages finance categories" on finance_categories
  for all using (is_lc_president(project_id)) with check (is_lc_president(project_id));

-- ── 4. Expense claims ────────────────────────────────────────────────────────

create table if not exists expense_claims (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  submitted_by     uuid not null references user_profiles(id) on delete cascade,
  amount           numeric(12,2) not null check (amount > 0),
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  expense_date     date not null default current_date,
  description      text not null check (length(trim(description)) > 0),
  department_id    uuid references departments(id) on delete set null,
  category_id      uuid references finance_categories(id) on delete set null,
  receipt_path     text not null,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by      uuid references user_profiles(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint expense_claims_rejection_needs_reason
    check (status <> 'rejected' or length(trim(coalesce(rejection_reason, ''))) > 0)
);

create index if not exists expense_claims_project_status_idx on expense_claims (project_id, status);
create index if not exists expense_claims_submitter_idx on expense_claims (submitted_by);

-- ── 5. Ledger ─────────────────────────────────────────────────────────────────

create table if not exists finance_entries (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  type          text not null check (type in ('income', 'expense')),
  amount        numeric(12,2) not null check (amount > 0),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  entry_date    date not null default current_date,
  category_id   uuid references finance_categories(id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  description   text not null default '',
  recorded_by   uuid references user_profiles(id) on delete set null,
  receipt_path  text,
  claim_id      uuid unique references expense_claims(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists finance_entries_project_date_idx on finance_entries (project_id, entry_date desc);

-- Category / department must belong to the same LC; currency defaults to the LC's.
create or replace function _finance_row_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.currency is null then
    select currency into new.currency from projects where id = new.project_id;
  end if;
  if new.category_id is not null and not exists (
    select 1 from finance_categories where id = new.category_id and project_id = new.project_id
  ) then
    raise exception 'Category does not belong to this LC';
  end if;
  if new.department_id is not null and not exists (
    select 1 from departments where id = new.department_id and project_id = new.project_id
  ) then
    raise exception 'Department does not belong to this LC';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_finance_entries_guard on finance_entries;
create trigger trg_finance_entries_guard
  before insert or update on finance_entries
  for each row execute function _finance_row_guard();

drop trigger if exists trg_expense_claims_guard on expense_claims;
create trigger trg_expense_claims_guard
  before insert or update on expense_claims
  for each row execute function _finance_row_guard();

-- Claims: only the finance lead may change status / review fields (and only
-- through review_expense_claim, which runs as the caller for this check).
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
     and not is_finance_lead(new.project_id) then
    raise exception 'Only the person in charge of finance can approve or reject claims';
  end if;
  if new.submitted_by <> old.submitted_by or new.project_id <> old.project_id then
    raise exception 'A claim cannot change owner or LC';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_expense_claim_status_guard on expense_claims;
create trigger trg_expense_claim_status_guard
  before insert or update on expense_claims
  for each row execute function _expense_claim_status_guard();

-- Approved ↔ ledger entry, and a notification to the submitter.
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
    insert into finance_entries (project_id, type, amount, currency, entry_date, category_id,
                                 department_id, description, recorded_by, receipt_path, claim_id)
    values (new.project_id, 'expense', new.amount, new.currency, new.expense_date, new.category_id,
            new.department_id, 'Expense claim: ' || new.description, new.reviewed_by, new.receipt_path, new.id)
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
        else new.description || ': Reason: ' || new.rejection_reason
      end,
      new.id, '/finance', false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_expense_claim_status_changed on expense_claims;
create trigger trg_expense_claim_status_changed
  after update of status on expense_claims
  for each row execute function _expense_claim_status_changed();

-- The one way to approve, reject or reopen a claim.
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
  if not found or not auth_is_project_member(v_claim.project_id) then
    raise exception 'Claim not found';
  end if;
  if not is_finance_lead(v_claim.project_id) then
    raise exception 'Only the person in charge of finance can approve or reject claims';
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

revoke execute on function review_expense_claim(uuid, text, text) from public, anon;
grant  execute on function review_expense_claim(uuid, text, text) to authenticated;

-- ── 6. RLS ────────────────────────────────────────────────────────────────────

alter table expense_claims  enable row level security;
alter table finance_entries enable row level security;

drop policy if exists "claims visible to submitter, finance lead, department VP" on expense_claims;
create policy "claims visible to submitter, finance lead, department VP" on expense_claims
  for select using (
    submitted_by = auth.uid()
    or is_finance_lead(project_id)
    or department_id in (select led_department_ids(project_id))
  );

drop policy if exists "members submit their own claims" on expense_claims;
create policy "members submit their own claims" on expense_claims
  for insert with check (
    submitted_by = auth.uid()
    and auth_is_project_member(project_id)
    and split_part(receipt_path, '/', 1) = project_id::text
    and split_part(receipt_path, '/', 2) = auth.uid()::text
  );

drop policy if exists "submitter edits own pending claim" on expense_claims;
create policy "submitter edits own pending claim" on expense_claims
  for update using (submitted_by = auth.uid() and status = 'pending')
  with check (submitted_by = auth.uid());

drop policy if exists "submitter withdraws own pending claim" on expense_claims;
create policy "submitter withdraws own pending claim" on expense_claims
  for delete using (submitted_by = auth.uid() and status = 'pending');

drop policy if exists "finance lead and department VPs read ledger" on finance_entries;
create policy "finance lead and department VPs read ledger" on finance_entries
  for select using (
    is_finance_lead(project_id)
    or department_id in (select led_department_ids(project_id))
  );

drop policy if exists "finance lead records entries" on finance_entries;
create policy "finance lead records entries" on finance_entries
  for insert with check (is_finance_lead(project_id) and claim_id is null and recorded_by = auth.uid());

-- Entries created from claims are managed by the claim, not edited by hand.
drop policy if exists "finance lead edits manual entries" on finance_entries;
create policy "finance lead edits manual entries" on finance_entries
  for update using (is_finance_lead(project_id) and claim_id is null)
  with check (is_finance_lead(project_id) and claim_id is null);

drop policy if exists "finance lead deletes manual entries" on finance_entries;
create policy "finance lead deletes manual entries" on finance_entries
  for delete using (is_finance_lead(project_id) and claim_id is null);

-- ── 7. Receipts bucket (private; signed URLs only) ───────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false;

drop policy if exists "receipts: upload to own folder" on storage.objects;
create policy "receipts: upload to own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
    and auth_is_project_member(_try_uuid((storage.foldername(name))[1]))
  );

drop policy if exists "receipts: read own, finance lead, department VP" on storage.objects;
create policy "receipts: read own, finance lead, department VP" on storage.objects
  for select to authenticated using (
    bucket_id = 'receipts'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or is_finance_lead(_try_uuid((storage.foldername(name))[1]))
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

drop policy if exists "receipts: delete own unclaimed" on storage.objects;
create policy "receipts: delete own unclaimed" on storage.objects
  for delete to authenticated using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
    and not exists (select 1 from expense_claims c where c.receipt_path = storage.objects.name and c.status <> 'pending')
  );

-- ── 8. Notifications: stop anyone writing into anyone's inbox ────────────────
-- Previously any signed-in user could insert a notification for any user.
-- Now: yourself, or someone you share an LC with. System notifications (claims,
-- tabling) are written by SECURITY DEFINER functions and bypass this.
drop policy if exists "authenticated can insert notifications" on notifications;
drop policy if exists "notify yourself or a fellow LC member" on notifications;
create policy "notify yourself or a fellow LC member" on notifications
  for insert with check (
    user_id = auth.uid()
    or exists (
      select 1 from team_members mine
      join team_members theirs on theirs.project_id = mine.project_id
      where mine.user_id = auth.uid() and theirs.user_id = notifications.user_id
    )
  );

notify pgrst, 'reload schema';
