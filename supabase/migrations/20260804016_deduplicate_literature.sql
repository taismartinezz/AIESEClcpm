-- Migration 016: Clean up duplicate and inconsistent literature_items.
--
-- Problems observed in QA:
--   1. "Dynamics of algorithmic content amplification on TikTok" appears in both
--      active items (deleted_at IS NULL) AND recently-removed (deleted_at IS NOT NULL).
--      This happens when the same item was imported twice: once active, once deleted.
--      Keep the active (non-deleted) copy and hard-delete the deleted duplicate.
--   2. "Ideological fragmentation of the social media ecosystem" and
--      "A Picture is Worth a Thousand (S)words" are duplicated inside the trash itself.
--      Keep the most-recently-deleted copy and hard-delete the older one.
--
-- Safe to run multiple times (idempotent via WHERE EXISTS guards).

-- ── 1. Remove soft-deleted duplicates that have an active twin ────────────────
--
-- For every deleted row that shares (project_id, title) with a non-deleted row,
-- hard-delete the deleted row.
DELETE FROM literature_items
WHERE deleted_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM literature_items twin
    WHERE twin.project_id  = literature_items.project_id
      AND twin.title       = literature_items.title
      AND twin.deleted_at  IS NULL
  );

-- ── 2. De-duplicate within the trash itself ───────────────────────────────────
--
-- Keep the most-recently-deleted row; hard-delete older duplicates.
DELETE FROM literature_items
WHERE deleted_at IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (project_id, title) id
    FROM literature_items
    WHERE deleted_at IS NOT NULL
    ORDER BY project_id, title, deleted_at DESC
  );
