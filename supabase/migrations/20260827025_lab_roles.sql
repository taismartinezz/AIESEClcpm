-- Migration 025: lab_roles table + role columns on invite_codes and team_members
-- Run manually in Supabase SQL editor.

-- ── lab_roles table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_roles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  permission_level text        NOT NULL DEFAULT 'researcher'
                               CHECK (permission_level IN ('pi', 'researcher')),
  is_system        boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

-- ── Seed built-in roles for every existing lab ─────────────────────────────────
INSERT INTO lab_roles (project_id, name, permission_level, is_system)
  SELECT id, 'PI',         'pi',         true FROM projects
  UNION ALL
  SELECT id, 'Researcher', 'researcher', true FROM projects
ON CONFLICT (project_id, name) DO NOTHING;

-- ── Add lab_role_id to invite_codes ───────────────────────────────────────────
ALTER TABLE invite_codes
  ADD COLUMN IF NOT EXISTS lab_role_id uuid REFERENCES lab_roles(id) ON DELETE SET NULL;

-- ── Add lab_role_id to team_members ───────────────────────────────────────────
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS lab_role_id uuid REFERENCES lab_roles(id) ON DELETE SET NULL;

-- ── Backfill team_members.lab_role_id from existing role column ───────────────
UPDATE team_members tm
  SET lab_role_id = lr.id
  FROM lab_roles lr
  WHERE lr.project_id = tm.project_id
    AND lr.name = CASE tm.role
      WHEN 'pi'         THEN 'PI'
      WHEN 'researcher' THEN 'Researcher'
    END
    AND tm.lab_role_id IS NULL;

-- ── RLS for lab_roles ─────────────────────────────────────────────────────────
ALTER TABLE lab_roles ENABLE ROW LEVEL SECURITY;

-- Lab members can read their lab's roles
CREATE POLICY "lab members read roles"
  ON lab_roles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.project_id = lab_roles.project_id
        AND team_members.user_id = auth.uid()
    )
  );

-- Only PIs can insert/update/delete roles
CREATE POLICY "pi manages roles"
  ON lab_roles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.project_id = lab_roles.project_id
        AND team_members.user_id = auth.uid()
        AND team_members.role = 'pi'
    )
  );
