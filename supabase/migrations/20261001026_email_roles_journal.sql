-- Migration 026: email notifications, expanded lab roles, journal encryption
-- All statements are idempotent; safe to run more than once.

-- 1. Notification preference columns on user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS notif_task_assigned boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_lab_win       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_digest        boolean NOT NULL DEFAULT false;

-- 2. Invite email tracking
ALTER TABLE invite_codes
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz DEFAULT NULL;

-- 3. Project columns for lab configuration
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS active_prompt_ids     text[]  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_prompts        jsonb   DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS research_participation text   DEFAULT 'private';

-- 4. Backfill active_prompt_ids for projects that have never had it set (NULL only).
--    NULL = "not configured yet"; empty array = "PI chose none". After this backfill,
--    NULL rows will never exist for active labs.
UPDATE projects
SET active_prompt_ids = ARRAY['jp2', 'jp7', 'jp11']
WHERE active_prompt_ids IS NULL;

-- 5. Expanded default lab roles — insert missing roles for each existing project.
INSERT INTO lab_roles (project_id, name, permission_level, is_system)
SELECT p.id, r.name, r.permission_level, true
FROM projects p
CROSS JOIN (VALUES
  ('Co-PI',                    'pi'),
  ('Postdoc',                  'researcher'),
  ('PhD Student',              'researcher'),
  ('Master''s Student',        'researcher'),
  ('Undergraduate Researcher', 'researcher'),
  ('Lab Manager',              'researcher')
) AS r(name, permission_level)
WHERE NOT EXISTS (
  SELECT 1 FROM lab_roles lr
  WHERE lr.project_id = p.id AND lr.name = r.name
);

-- 6. Separate plaintext checkin scores column so get_wellbeing_rollup continues
--    to work after journal content is encrypted.
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS checkin_scores jsonb DEFAULT NULL;

-- Backfill checkin_scores from existing plaintext entries (one-time).
-- Entries already encrypted will have content->>'enc' = 'aes-gcm-v1' and are skipped.
UPDATE journal_entries
SET checkin_scores = content -> 'checkin'
WHERE checkin_scores IS NULL
  AND content IS NOT NULL
  AND (content ->> 'enc') IS DISTINCT FROM 'aes-gcm-v1'
  AND content -> 'checkin' IS NOT NULL;

-- 7. Update get_wellbeing_rollup to read from checkin_scores when present,
--    falling back to content->'checkin' for legacy plaintext rows.
--    Signature is identical to the one in 20260816024 — no DROP needed.
CREATE OR REPLACE FUNCTION get_wellbeing_rollup(p_project_id uuid)
RETURNS TABLE (
  week_start       date,
  question_id      text,
  avg_score        numeric,
  respondent_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH threshold AS (
    SELECT min_wellbeing_respondents AS t
    FROM   projects
    WHERE  id = p_project_id
  ),
  opted_in AS (
    SELECT us.user_id
    FROM   user_settings us
    JOIN   team_members  tm ON tm.user_id = us.user_id AND tm.project_id = p_project_id
    WHERE  us.wellbeing_opted_in = true
  ),
  responses AS (
    SELECT
      je.user_id,
      date_trunc('week', je.created_at)::date                        AS week_start,
      (elem->>'questionId')                                          AS question_id,
      (elem->>'score')::numeric                                      AS score
    FROM journal_entries je
    JOIN opted_in oi ON oi.user_id = je.user_id
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(je.checkin_scores, je.content->'checkin')
    ) AS elem
    WHERE je.project_id = p_project_id
      AND jsonb_array_length(
            COALESCE(je.checkin_scores, je.content->'checkin')
          ) > 0
  ),
  weekly AS (
    SELECT
      week_start,
      question_id,
      AVG(score)              AS avg_score,
      COUNT(DISTINCT user_id) AS respondent_count
    FROM responses
    GROUP BY 1, 2
    HAVING COUNT(DISTINCT user_id) >= (SELECT t FROM threshold)
  )
  SELECT week_start, question_id, ROUND(avg_score, 2), respondent_count
  FROM   weekly
  ORDER  BY week_start, question_id;
$$;

NOTIFY pgrst, 'reload schema';
