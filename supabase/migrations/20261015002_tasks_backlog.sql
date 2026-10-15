-- Migration 029: LC-friendly task board — add a "backlog" column.
-- Columns are now Backlog / To do / In progress / Review / Done
-- (stored as backlog / todo / in_progress / in_review / done).
-- tasks.department_id (optional department tag) was added in migration 028.

do $$
declare
  c record;
begin
  for c in
    select con.conname
    from   pg_constraint con
    join   pg_class rel     on rel.oid = con.conrelid
    join   pg_namespace ns  on ns.oid = rel.relnamespace
    join   pg_attribute att on att.attrelid = rel.oid and att.attnum = any (con.conkey)
    where  ns.nspname = 'public' and rel.relname = 'tasks'
      and  con.contype = 'c' and att.attname = 'status'
  loop
    execute format('alter table tasks drop constraint %I', c.conname);
  end loop;
end $$;

alter table tasks
  add constraint tasks_status_check
  check (status in ('backlog', 'todo', 'in_progress', 'in_review', 'done'));

create index if not exists tasks_department_idx on tasks (department_id) where department_id is not null;

notify pgrst, 'reload schema';
