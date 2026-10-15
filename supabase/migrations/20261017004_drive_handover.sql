-- Migration 037: LC Drive (Bookmarks with folders and files) and term handover.
--
--   drive_folders     LC-wide folders, seeded per LC: Templates, Brand kit,
--                     Job descriptions, Important links, Handover. Every
--                     member sees them; the exec board manages them.
--   bookmarks         now "drive items": a link or an uploaded file, optionally
--                     in a folder. Personal items are visible only to their
--                     owner (previously any LC member could read them).
--   storage 'lc-drive' private bucket for uploaded files, opened through
--                     signed URLs; LC members read, the uploader or the exec
--                     board deletes.
--   handover_notes    one note per department per term (plus LC-wide notes from
--                     the president) for whoever takes over next. The exec board
--                     reads all; a department's members read theirs; the
--                     department's VP (or the president) writes.

-- ── 1. Folders ────────────────────────────────────────────────────────────────

create table if not exists drive_folders (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  sort_order  integer not null default 0,
  created_by  uuid references user_profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (project_id, name)
);

create or replace function seed_default_drive_folders(p_project_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into drive_folders (project_id, name, sort_order)
  select p_project_id, f.name, f.ord
  from unnest(array['Templates', 'Brand kit', 'Job descriptions', 'Important links', 'Handover'])
       with ordinality as f(name, ord)
  on conflict (project_id, name) do nothing;
$$;
revoke execute on function seed_default_drive_folders(uuid) from public, anon, authenticated;

create or replace function _seed_lc_drive_folders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_default_drive_folders(new.id);
  return new;
end;
$$;

drop trigger if exists trg_seed_lc_drive_folders on projects;
create trigger trg_seed_lc_drive_folders
  after insert on projects
  for each row execute function _seed_lc_drive_folders();

select seed_default_drive_folders(p.id)
from projects p
where not exists (select 1 from drive_folders f where f.project_id = p.id);

alter table drive_folders enable row level security;

drop policy if exists "lc members see folders" on drive_folders;
create policy "lc members see folders" on drive_folders
  for select using (auth_is_project_member(project_id));

drop policy if exists "exec manages folders" on drive_folders;
create policy "exec manages folders" on drive_folders
  for all using (is_lc_exec(project_id)) with check (is_lc_exec(project_id));

-- ── 2. Drive items (bookmarks) ───────────────────────────────────────────────

alter table bookmarks
  add column if not exists folder_id    uuid references drive_folders(id) on delete set null,
  add column if not exists kind         text not null default 'link',
  add column if not exists storage_path text,
  add column if not exists file_name    text,
  add column if not exists mime_type    text,
  add column if not exists size_bytes   bigint;

alter table bookmarks drop constraint if exists bookmarks_kind_check;
alter table bookmarks add constraint bookmarks_kind_check check (
  (kind = 'link' and storage_path is null)
  or (kind = 'file' and storage_path is not null)
);

create or replace function _bookmarks_folder_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.folder_id is not null and not exists (
    select 1 from drive_folders where id = new.folder_id and project_id = new.project_id
  ) then
    raise exception 'Folder does not belong to this LC';
  end if;
  if new.kind = 'file' and split_part(new.storage_path, '/', 1) <> new.project_id::text then
    raise exception 'File is not stored under this LC';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bookmarks_folder_guard on bookmarks;
create trigger trg_bookmarks_folder_guard
  before insert or update on bookmarks
  for each row execute function _bookmarks_folder_guard();

-- Personal items were readable by every LC member; keep them private.
drop policy if exists "project members can read bookmarks" on bookmarks;
create policy "project members can read bookmarks" on bookmarks
  for select using (
    (coalesce(scope, 'lab') <> 'personal' and auth_is_project_member(project_id))
    or (scope = 'personal' and added_by = auth.uid())
    or (
      scope = 'project'
      and sub_project_id is not null
      and exists (
        select 1 from sub_project_members spm
        where spm.sub_project_id = bookmarks.sub_project_id and spm.user_id = auth.uid()
      )
    )
  );

drop policy if exists "members can update shared bookmarks" on bookmarks;
create policy "members can update shared bookmarks" on bookmarks
  for update using (
    (scope = 'personal' and added_by = auth.uid())
    or (coalesce(scope, 'lab') <> 'personal' and auth_is_project_member(project_id))
  ) with check (auth_is_project_member(project_id) or added_by = auth.uid());

-- ── 3. Files bucket ──────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('lc-drive', 'lc-drive', false, 26214400)
on conflict (id) do update set public = false;

drop policy if exists "lc-drive: members upload to their LC" on storage.objects;
create policy "lc-drive: members upload to their LC" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'lc-drive' and auth_is_project_member(_try_uuid((storage.foldername(name))[1]))
  );

drop policy if exists "lc-drive: members read their LC" on storage.objects;
create policy "lc-drive: members read their LC" on storage.objects
  for select to authenticated using (
    bucket_id = 'lc-drive'
    and auth_is_project_member(_try_uuid((storage.foldername(name))[1]))
    -- personal files stay with their owner
    and not exists (
      select 1 from bookmarks b
      where b.storage_path = storage.objects.name and b.scope = 'personal' and b.added_by <> auth.uid()
    )
  );

drop policy if exists "lc-drive: uploader or exec deletes" on storage.objects;
create policy "lc-drive: uploader or exec deletes" on storage.objects
  for delete to authenticated using (
    bucket_id = 'lc-drive'
    and (owner = auth.uid() or is_lc_exec(_try_uuid((storage.foldername(name))[1])))
  );

-- ── 4. Handover notes ────────────────────────────────────────────────────────

create table if not exists handover_notes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  department_id uuid references departments(id) on delete cascade,   -- null = LC-wide (president)
  term_label    text not null check (length(trim(term_label)) > 0),  -- e.g. "2026/27"
  title         text not null check (length(trim(title)) > 0),
  body          text not null default '',
  updated_by    uuid references user_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique nulls not distinct (project_id, department_id, term_label)
);

create or replace function _handover_guard()
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
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists trg_handover_guard on handover_notes;
create trigger trg_handover_guard
  before insert or update on handover_notes
  for each row execute function _handover_guard();

alter table handover_notes enable row level security;

drop policy if exists "handover readable by exec and the department" on handover_notes;
create policy "handover readable by exec and the department" on handover_notes
  for select using (
    is_lc_exec(project_id)
    or (department_id is not null and department_id = my_department_id(project_id))
  );

drop policy if exists "handover written by the department VP or president" on handover_notes;
create policy "handover written by the department VP or president" on handover_notes
  for all using (
    is_lc_president(project_id) or (department_id is not null and department_id in (select led_department_ids(project_id)))
  ) with check (
    is_lc_president(project_id) or (department_id is not null and department_id in (select led_department_ids(project_id)))
  );

notify pgrst, 'reload schema';
