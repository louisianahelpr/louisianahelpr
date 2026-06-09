-- Admin polish pass (PR: polish/admin-screen-pass).
--
-- 1. `reports.assigned_to`      — triage column the Reports queue uses
--                                  for assign-to-self functionality.
-- 2. `reports.status` extension — relax the CHECK so admins can move
--                                  reports through new/investigating/
--                                  resolved/dismissed.
-- 3. `platform_settings.min_supported_build` (int) — runtime knob the
--                                  ForceUpdate gate (PR #445) reads
--                                  via useVersionCheck. Defaults to 0
--                                  so the gate stays disabled until an
--                                  admin sets it.
-- 4. `platform_settings.feature_flags` (jsonb) — typed map of named
--                                  flags the Admin Settings UI toggles.
--                                  Defaults to '{}'.
-- 5. Realtime: enable for reports + platform_settings so admin clients
--    see the change.
--
-- Replay-safe:
--   * Uses `IF NOT EXISTS` / `IF EXISTS` for every DDL step.
--   * The CHECK constraint is dropped + recreated so re-running the
--     migration with the new constraint already in place is idempotent.

-- ---- 1 & 2. reports columns ----
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reports_assigned_to ON public.reports(assigned_to);

-- Allow the new triage state values. Drop the old CHECK by name first
-- (Postgres auto-generates it when the table was created), via a
-- defensive DO block that no-ops if the constraint doesn't exist.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE rel.relname = 'reports'
    AND ns.nspname = 'public'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.reports DROP CONSTRAINT %I', cname);
  END IF;
END
$$;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_status_check
  CHECK (status IN ('pending', 'new', 'investigating', 'reviewed', 'resolved', 'dismissed'));

-- ---- 3 & 4. platform_settings columns ----
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS min_supported_build INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.platform_settings.min_supported_build IS
  'Minimum CFBundleVersion / Android versionCode required by the app. The ForceUpdate gate (src/hooks/useVersionCheck.ts) reads this; 0 disables the gate.';
COMMENT ON COLUMN public.platform_settings.feature_flags IS
  'JSON map of feature flag id → boolean. Updated from /admin → Settings.';

-- ---- 5. realtime ----
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reports'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.reports';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'platform_settings'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_settings';
  END IF;
END
$$;
