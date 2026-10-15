-- Migration 027: add lab_role_id to claim_invite_code_lookup return type.
-- The previous definition (from 022) omitted lab_role_id, so the researcher's
-- assigned role was lost during the accept-invite flow.
-- Must DROP + CREATE because PostgreSQL does not allow changing a function's
-- return type with CREATE OR REPLACE.

DROP FUNCTION IF EXISTS claim_invite_code_lookup(text);

CREATE FUNCTION claim_invite_code_lookup(p_code text)
RETURNS TABLE (
  project_id    uuid,
  invited_email text,
  used_by       uuid,
  used_at       timestamptz,
  lab_role_id   uuid
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT project_id, invited_email, used_by, used_at, lab_role_id
  FROM   invite_codes
  WHERE  code = p_code
  LIMIT  1;
$$;

NOTIFY pgrst, 'reload schema';
