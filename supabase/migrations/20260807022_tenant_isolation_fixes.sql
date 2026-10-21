-- Migration 022: Tenant isolation hardening
--
-- Findings from full RLS audit (2026-08-07):
--
-- HIGH:   invite_codes & sub_project_invite_codes have SELECT using(true)
--         → any authenticated user can enumerate all labs' invite codes + invited emails.
--
-- HIGH:   activity_feed table has no RLS at all (table predates tracked migrations;
--         migration 015 added a column but never enabled RLS).
--
-- HIGH:   notifications table has no RLS at all (same situation).
--
-- Fix strategy:
--   1. invite_codes: keep anonymous lookup by code value via SECURITY DEFINER RPC;
--      restrict direct table reads to own-lab members only.
--   2. sub_project_invite_codes: same approach.
--   3. activity_feed: enable RLS; project members see their lab's feed.
--   4. notifications: enable RLS; each user sees only their own notifications.
--
-- All statements are idempotent.

-- ── 1. invite_codes: restrict direct reads to own-lab members ─────────────────
--
-- Replace the "anyone can look up a code" SELECT policy with one that limits
-- direct table access to members of the same project. The join-flow (claiming a
-- code before you're a member) is handled exclusively via the RPC below.

DROP POLICY IF EXISTS "anyone can look up a code" ON invite_codes;
DROP POLICY IF EXISTS "lab members can read own invite codes" ON invite_codes;

CREATE POLICY "lab members can read own invite codes"
  ON invite_codes FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.project_id = invite_codes.project_id
        AND tm.user_id = auth.uid()
    )
  );

-- SECURITY DEFINER RPC: returns only the fields needed for the join flow.
-- Callers who are not yet a team member (i.e., claiming an invite) use this
-- instead of a direct SELECT so we never expose the full codes table.
CREATE OR REPLACE FUNCTION claim_invite_code_lookup(p_code text)
RETURNS TABLE (
  project_id   uuid,
  invited_email text,
  used_by      uuid,
  used_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT project_id, invited_email, used_by, used_at
  FROM   invite_codes
  WHERE  code = p_code
  LIMIT  1;
$$;

-- ── 2. sub_project_invite_codes: restrict direct reads ────────────────────────

DROP POLICY IF EXISTS "anyone can look up a project invite" ON sub_project_invite_codes;
DROP POLICY IF EXISTS "lab members can read own sub_project invite codes" ON sub_project_invite_codes;

CREATE POLICY "lab members can read own sub_project invite codes"
  ON sub_project_invite_codes FOR SELECT USING (
    -- inviter can always see their own tokens
    auth.uid() = invited_by
    -- lab members of the sub_project's parent project can read
    OR EXISTS (
      SELECT 1 FROM sub_projects sp
      JOIN   team_members tm ON tm.project_id = sp.project_id
      WHERE  sp.id = sub_project_invite_codes.sub_project_id
        AND  tm.user_id = auth.uid()
    )
  );

-- SECURITY DEFINER RPC for the external-invite claim flow
CREATE OR REPLACE FUNCTION claim_sub_project_invite_lookup(p_token text)
RETURNS TABLE (
  sub_project_id uuid,
  invited_email  text,
  status         text,
  used_by        uuid
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT sub_project_id, invited_email, status, used_by
  FROM   sub_project_invite_codes
  WHERE  token = p_token
  LIMIT  1;
$$;

-- ── 3. activity_feed: enable RLS ─────────────────────────────────────────────
--
-- The table was created before migrations were tracked; RLS was never enabled.
-- Project members can read their own lab's feed; only authenticated users can
-- insert (the project_id check acts as the write guard).

ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project members can read activity feed" ON activity_feed;
CREATE POLICY "project members can read activity feed"
  ON activity_feed FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.project_id = activity_feed.project_id
        AND tm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "project members can insert activity feed" ON activity_feed;
CREATE POLICY "project members can insert activity feed"
  ON activity_feed FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.project_id = activity_feed.project_id
        AND tm.user_id = auth.uid()
    )
  );

-- ── 4. notifications: enable RLS ─────────────────────────────────────────────
--
-- Each user sees only notifications addressed to them.

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user reads own notifications" ON notifications;
CREATE POLICY "user reads own notifications"
  ON notifications FOR SELECT USING (
    auth.uid() = user_id
  );

DROP POLICY IF EXISTS "authenticated can insert notifications" ON notifications;
CREATE POLICY "authenticated can insert notifications"
  ON notifications FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "user can mark own notifications read" ON notifications;
CREATE POLICY "user can mark own notifications read"
  ON notifications FOR UPDATE USING (
    auth.uid() = user_id
  );

DROP POLICY IF EXISTS "user can delete own notifications" ON notifications;
CREATE POLICY "user can delete own notifications"
  ON notifications FOR DELETE USING (
    auth.uid() = user_id
  );
