-- Disable the `spawn-recurring-jobs` cron.
--
-- This is the WITHDRAWN recurring path. It posts each later visit into `jobs`
-- with no payment attached, so a helper could work a visit the poster was never
-- charged for. The feature was pulled for exactly that reason
-- (`RECURRING_ENABLED = false`), but the cron that drives it was left running
-- daily at 05:00 and has been firing ever since.
--
-- It is harmless TODAY only because nothing feeds it: verified against prod on
-- 2026-08-20 — 0 rows with `is_recurring`, 0 `recurring_helper_id`, 0
-- `recurring_visit_releases`. It becomes live the instant anyone flips
-- RECURRING_ENABLED back on, which is precisely when nobody will be thinking
-- about a cron job scheduled months earlier.
--
-- Deliberately NOT scheduling the replacement (`charge-recurring-visits`) here.
-- It is deployed but unscheduled, and scheduling a charge job while the feature
-- is off adds a second thing to keep track of for no benefit. The correct place
-- to schedule it is the SAME migration that flips RECURRING_ENABLED, so the
-- charge path and the feature can never be out of step again — which is the
-- failure this migration exists to clean up.
--
-- Idempotent + replay-safe: unschedule only if the job actually exists.
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — nothing to unschedule';
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE command ILIKE '%spawn-recurring-jobs%'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    RAISE NOTICE 'spawn-recurring-jobs cron not present — nothing to do';
  ELSE
    PERFORM cron.unschedule(v_jobid);
    RAISE NOTICE 'Unscheduled spawn-recurring-jobs (jobid %)', v_jobid;
  END IF;
END $$;
