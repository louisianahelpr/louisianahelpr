-- job_helpr_fault_rulings.admin_id (REFERENCES auth.users ON DELETE SET NULL,
-- added by 20261019015301_helpr_fault_ruling) shipped without a covering
-- index. The Supabase performance advisor's unindexed_foreign_keys lint (a
-- class the exact baseline scripts/ci/performance-advisor-baseline.json holds
-- at zero) saw it and turned db-drift-detect red (nightly-red #3435, run
-- 39359122497: "unindexed_foreign_keys: 1 finding(s), a class the baseline does
-- not name"). Deleting an admin's auth.users row scans the child table for
-- matches without an index. The new name is listed in the baseline's
-- unused_index set in this same change (an index is "unused" until traffic
-- first scans it).
--
-- REPLAY-SAFETY: the table comes from an EARLIER migration (20261019015301),
-- but a from-scratch rebuild reaches this file after it in timestamp order, so
-- the table exists; the guard keeps it a no-op if it somehow does not, and
-- CREATE INDEX IF NOT EXISTS makes a second and third run a no-op.

DO $$
BEGIN
  IF to_regclass('public.job_helpr_fault_rulings') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS job_helpr_fault_rulings_admin_idx
      ON public.job_helpr_fault_rulings (admin_id);
  END IF;
END
$$;
