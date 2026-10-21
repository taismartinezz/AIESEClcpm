-- Migration 003: Standardize scope vocabulary to personal | lab | project across all features.
-- Canonical set: ('personal', 'lab', 'project'): no more 'my'.
--
-- Live tables affected:
--   reminders.scope: CHECK was ('personal', 'lab'), expand to include 'project'
--   literature_items.library: no CHECK existed on the live column; add one now
--                              + update any 'my' rows to 'personal' (safe no-op; 0 rows)
--
-- Tables added by migration 002 (tasks, bookmarks, schedule_events) already have
-- the expanded constraint written in migration 002: no action needed here.

-- ── reminders.scope ───────────────────────────────────────────────────────────
-- Drop any existing CHECK constraint on reminders.scope (name may vary),
-- then add the expanded constraint.

do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where rel.relname = 'reminders'
    and ns.nspname = 'public'
    and con.contype = 'c'
    and con.conname ilike '%scope%';

  if cname is not null then
    execute 'alter table reminders drop constraint ' || quote_ident(cname);
  end if;
end $$;

alter table reminders
  add constraint reminders_scope_check
    check (scope in ('personal', 'lab', 'project'));

-- ── literature_items.library ──────────────────────────────────────────────────
-- The live DB column is `library` (not `scope`) with no CHECK constraint.
-- First migrate any stale 'my' values (0 rows currently; included for safety).
-- Then add the canonical CHECK constraint.

update literature_items
  set library = 'personal'
  where library = 'my';

do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where rel.relname = 'literature_items'
    and ns.nspname = 'public'
    and con.contype = 'c'
    and con.conname ilike '%library%';

  if cname is not null then
    execute 'alter table literature_items drop constraint ' || quote_ident(cname);
  end if;
end $$;

alter table literature_items
  add constraint literature_items_library_check
    check (library in ('lab', 'personal', 'project'));
