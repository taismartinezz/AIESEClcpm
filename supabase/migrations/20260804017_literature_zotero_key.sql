-- Migration 017: Add zotero_key column for stable per-item deduplication.
--
-- Problem: literature_items has a partial unique index on (project_id, doi)
-- WHERE doi IS NOT NULL.  Items without a DOI have no dedup key at all: every
-- re-sync of a Zotero collection creates fresh duplicate rows for those items
-- regardless of how many times they already exist in the DB.
--
-- Fix: add a stable Zotero item key (8-char alphanumeric, e.g. "AIXIUGN3")
-- stored as zotero_key.  A unique partial index prevents inserting the same
-- Zotero item twice into the same project, even when doi IS NULL.
--
-- Idempotent: IF NOT EXISTS guards let this run multiple times safely.

-- ── 1. Add the column ─────────────────────────────────────────────────────────
ALTER TABLE literature_items
  ADD COLUMN IF NOT EXISTS zotero_key varchar(32) DEFAULT NULL;

-- ── 2. Unique partial index ────────────────────────────────────────────────────
-- Scoped to project, active rows only.  NULL values are excluded so non-Zotero
-- items (manual adds, BibTeX, DOI lookup) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS literature_items_project_zotero_key_unique
  ON literature_items (project_id, zotero_key)
  WHERE zotero_key IS NOT NULL AND deleted_at IS NULL;

-- ── 3. Backfill hint (cannot be automated: run after deploying the app code) ─
-- Once the app populates zotero_key on new syncs you can optionally backfill
-- existing rows via the Zotero API, but that requires user credentials.
-- The new unique index prevents future duplicates without a backfill;
-- existing duplicate rows can be cleaned up separately (see migration 016).
