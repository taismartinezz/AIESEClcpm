-- Migration 009: Soft-delete columns for literature_items
-- Required for the "Recently removed" feature in the Literature module.
-- Without these columns every SELECT against literature_items returns HTTP 400
-- because the app code filters on deleted_at which does not exist yet.
--
-- Safe to run multiple times (all statements are IF NOT EXISTS / OR REPLACE).

alter table literature_items
  add column if not exists deleted_at  timestamptz,
  add column if not exists deleted_by  uuid references auth.users(id);

-- Efficient index for the "Recently removed" query which orders by deleted_at DESC
-- and filters WHERE deleted_at IS NOT NULL.
create index if not exists literature_items_deleted_at_idx
  on literature_items (project_id, deleted_at)
  where deleted_at is not null;

-- No RLS changes needed: the existing "project members can manage literature"
-- policy (for all) already allows lab members to UPDATE a row's deleted_at back
-- to NULL (restore) and to SELECT soft-deleted rows for the trash view.
-- Soft-deleted rows remain readable by the owner's lab: that is intentional so
-- the "Recently removed" panel can list and restore them.
