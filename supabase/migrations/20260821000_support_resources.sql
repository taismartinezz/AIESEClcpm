-- support_invitation line on the lab (PI-authored, shown on the fork screen)
alter table projects
  add column if not exists support_invitation text;

-- ── support_resources ─────────────────────────────────────────────────────────
-- Stores lab-specific support contacts. "lab" = the projects row the lab maps to.
-- The prompt used the term "lab_id" but this schema uses project_id throughout.

create table if not exists support_resources (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  label           text not null,
  description     text,
  confidentiality text,
  category        text not null check (category in ('urgent','counseling','academic','workplace','health','other')),
  contact_type    text not null check (contact_type in ('phone','url','email','in_person')),
  contact_value   text not null,
  availability    text,
  is_pinned       boolean not null default false,
  sort_order      int    not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create or replace function _support_resources_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_support_resources_updated_at on support_resources;
create trigger trg_support_resources_updated_at
  before update on support_resources
  for each row execute function _support_resources_set_updated_at();

alter table support_resources enable row level security;

-- Lab members see active resources for their lab
drop policy if exists "support_resources_member_select" on support_resources;
create policy "support_resources_member_select"
  on support_resources for select to authenticated
  using (
    active = true
    and exists (
      select 1 from team_members tm
      where tm.project_id = support_resources.project_id
        and tm.user_id = auth.uid()
    )
  );

-- PI/admin also see inactive rows (for the admin table)
drop policy if exists "support_resources_pi_select_all" on support_resources;
create policy "support_resources_pi_select_all"
  on support_resources for select to authenticated
  using (
    exists (
      select 1 from team_members tm
      where tm.project_id = support_resources.project_id
        and tm.user_id = auth.uid()
        and tm.role = 'pi'
    )
  );

drop policy if exists "support_resources_pi_insert" on support_resources;
create policy "support_resources_pi_insert"
  on support_resources for insert to authenticated
  with check (
    exists (
      select 1 from team_members tm
      where tm.project_id = project_id
        and tm.user_id = auth.uid()
        and tm.role = 'pi'
    )
  );

drop policy if exists "support_resources_pi_update" on support_resources;
create policy "support_resources_pi_update"
  on support_resources for update to authenticated
  using (
    exists (
      select 1 from team_members tm
      where tm.project_id = support_resources.project_id
        and tm.user_id = auth.uid()
        and tm.role = 'pi'
    )
  );

drop policy if exists "support_resources_pi_delete" on support_resources;
create policy "support_resources_pi_delete"
  on support_resources for delete to authenticated
  using (
    exists (
      select 1 from team_members tm
      where tm.project_id = support_resources.project_id
        and tm.user_id = auth.uid()
        and tm.role = 'pi'
    )
  );

notify pgrst, 'reload schema';
