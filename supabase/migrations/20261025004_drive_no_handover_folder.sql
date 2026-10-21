-- Migration 057: one Handover, not two.
--
-- Handover notes are a tab in the Drive now, so the default "Handover" folder
-- is a second, confusing Handover. New LCs no longer get it, and existing
-- LCs lose it only if it's empty (a folder someone put files in stays).

create or replace function seed_default_drive_folders(p_project_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into drive_folders (project_id, name, sort_order)
  select p_project_id, f.name, f.ord
  from unnest(array['Templates', 'Brand kit', 'Job descriptions', 'Important links'])
       with ordinality as f(name, ord)
  on conflict (project_id, name) do nothing;
$$;
revoke execute on function seed_default_drive_folders(uuid) from public, anon, authenticated;

delete from drive_folders f
 where f.name = 'Handover'
   and not exists (select 1 from bookmarks b where b.folder_id = f.id);

-- The onboarding step that pointed at that folder.
update onboarding_steps
   set description = 'It is in the LC Drive, in Templates, and the Handover tab has notes from last term.'
 where description = 'It is in the LC Drive, in Handover or Templates.';

create or replace function seed_default_onboarding_steps(p_project_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into onboarding_steps (project_id, title, description, sort_order)
  select p_project_id, s.title, s.descr, s.ord
  from (values
    ('Meet your VP',                    'A first 1:1 with the VP of your department.', 1),
    ('Join the LC chat',                'Say hi in the LC channel in Chat.', 2),
    ('Read the LC handbook',            'It is in the LC Drive, in Templates, and the Handover tab has notes from last term.', 3),
    ('Attend your first LC meeting',    null, 4),
    ('Do your first check-in',          'About a minute, every two weeks. Only averages are shared.', 5)
  ) as s(title, descr, ord)
  where not exists (select 1 from onboarding_steps where project_id = p_project_id);
$$;
revoke execute on function seed_default_onboarding_steps(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
