-- Migration 020: Replace partial unique index on lit_annotations with a full one.
--
-- Problem: the partial index from migration 018 , 
--   CREATE UNIQUE INDEX ... ON lit_annotations (item_id, zotero_key)
--   WHERE zotero_key IS NOT NULL
--: cannot be used as an ON CONFLICT target by Supabase's JS client because
-- there is no way to pass the matching WHERE clause through .upsert().
-- Every upsert call therefore fails with "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification" and falls through to the
-- plain-insert fallback, which produces duplicate rows on re-sync.
--
-- Fix: drop and recreate as a non-partial index. This is safe because PostgreSQL
-- unique indexes never treat NULL as equal to NULL, so rows with zotero_key IS NULL
-- continue to coexist freely: the uniqueness guarantee only applies to non-NULL
-- pairs of (item_id, zotero_key).
--
-- Cleanup: delete any annotation rows that were inserted via the fallback path
-- (zotero_key IS NULL, page_number IS NOT NULL, parent item has a zotero_key).
-- These are orphaned Zotero annotations with no stable key; they would become
-- duplicates on the next re-sync once the upsert path works correctly.
-- Manually-created annotations are NOT affected: they never have page_number set.

BEGIN;

DROP INDEX IF EXISTS lit_annotations_item_zotero_key_unique;

CREATE UNIQUE INDEX lit_annotations_item_zotero_key_unique
  ON lit_annotations (item_id, zotero_key);

-- Remove orphaned fallback-inserted Zotero annotation rows.
-- Criteria: no zotero_key + has a page_number (PDF-anchored → came from Zotero)
-- + parent item is a Zotero import (has zotero_key).
-- Manual annotations never have page_number set, so they are unaffected.
DELETE FROM lit_annotations
WHERE zotero_key IS NULL
  AND page_number IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM literature_items
    WHERE id = lit_annotations.item_id
      AND zotero_key IS NOT NULL
      AND deleted_at IS NULL
  );

COMMIT;
