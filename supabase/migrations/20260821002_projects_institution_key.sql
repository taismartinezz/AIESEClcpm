-- Add institution_key to projects so the lab's registry resources can be resolved.

alter table projects
  add column if not exists institution_key text;

-- Set CollabLab to Northwestern so registry resources appear immediately.
-- Safe: WHERE name = 'CollabLab' targets exactly one row; UPDATE is idempotent.
update projects
  set institution_key = 'northwestern'
  where name = 'CollabLab';

notify pgrst, 'reload schema';
