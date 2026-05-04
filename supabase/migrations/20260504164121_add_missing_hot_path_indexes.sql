-- Add 5 missing indexes on hot query paths.
--
-- Discovered via schema audit. Each index targets a query that today
-- runs as a sequential scan against a (currently small but growing)
-- table. Adding them now is cheap; waiting until traffic catches up
-- means a noticeable latency cliff.
--
-- All use IF NOT EXISTS so re-running is safe. Plain CREATE INDEX
-- (not CONCURRENTLY) since we're inside a Supabase migration
-- transaction — blocks writes briefly per index, but tables are
-- early-stage and the locks finish in milliseconds.

-- 1. payout_scheduled_at — used by auto-release-payment Phase 2 every
--    cron tick to find jobs whose 24h hold has elapsed. Without this,
--    every cron call seq-scans the entire jobs table.
CREATE INDEX IF NOT EXISTS idx_jobs_payout_scheduled_at
  ON public.jobs (payout_scheduled_at)
  WHERE payout_scheduled_at IS NOT NULL;

-- 2. parent_job_id — addon_requests joins back to jobs via this column.
--    Partial index excludes the millions of standalone jobs that have
--    NULL here.
CREATE INDEX IF NOT EXISTS idx_jobs_parent_job_id
  ON public.jobs (parent_job_id)
  WHERE parent_job_id IS NOT NULL;

-- 3. messages (job_id, created_at DESC) — chat thread query pattern is
--    `WHERE job_id = ? ORDER BY created_at DESC LIMIT N`. Composite
--    index serves both the filter and the sort.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
    CREATE INDEX IF NOT EXISTS idx_messages_job_id_created
      ON public.messages (job_id, created_at DESC);
  END IF;
END $$;

-- 4. applications.status — partial index on the active states only.
--    Dashboard "pending applications for my jobs" + "my accepted apps"
--    are the main consumers.
CREATE INDEX IF NOT EXISTS idx_applications_status_active
  ON public.applications (status)
  WHERE status IN ('pending', 'accepted');

-- 5. user_roles.role — has_role() is invoked from every RLS policy that
--    checks for 'admin'. Without an index, each call scans user_roles
--    (currently small, but grows linearly with users).
CREATE INDEX IF NOT EXISTS idx_user_roles_role
  ON public.user_roles (role);
