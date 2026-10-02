-- jobs.boost_auto_extended exists in prod (boolean NOT NULL DEFAULT false,
-- measured 2026-10-02 via information_schema) but no migration created it, so a
-- replay from migrations alone lacked a column the generated types carry.
-- Record it; IF NOT EXISTS makes this a no-op on prod and replay-safe.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS boost_auto_extended boolean NOT NULL DEFAULT false;

-- Every jobs ADD COLUMN ends with the grant sync (offeredHelperPrivacy.test.ts).
-- Prod already grants authenticated SELECT on this column (measured 2026-10-02),
-- so this changes nothing live.
SELECT public.sync_jobs_select_grants();
