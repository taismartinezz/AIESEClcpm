-- DB-level backstop against duplicate DOIs within a project.
-- A partial unique index (not a constraint) so NULL DOIs and soft-deleted rows are excluded.
-- If two items in the same project have the same DOI and are both active, the second insert/update
-- will fail at the DB level: this catches any case where the client-side dupe check is bypassed
-- (e.g. concurrent syncs, direct API writes, or stale snapshot misses).
--
-- IMPORTANT: Run this AFTER 20260728012_literature_volume_pages.sql has been applied.
-- If the index creation fails because duplicates already exist, identify them first with:
--   SELECT doi, project_id, COUNT(*) FROM literature_items
--   WHERE doi IS NOT NULL AND deleted_at IS NULL
--   GROUP BY doi, project_id HAVING COUNT(*) > 1;
-- Then merge or delete the extras, then re-run.

CREATE UNIQUE INDEX IF NOT EXISTS literature_items_project_doi_unique
  ON literature_items (project_id, doi)
  WHERE doi IS NOT NULL AND deleted_at IS NULL;
