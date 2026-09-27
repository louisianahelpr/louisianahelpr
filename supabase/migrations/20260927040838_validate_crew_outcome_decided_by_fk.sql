-- Validate crew_dispute_member_outcomes_decided_by_fkey (added NOT VALID in
-- 20260927034536). db-deploy's "every public constraint is validated" check
-- failed on it (run 36292977310). Live 2026-09-27: the table has 0 rows and
-- 0 violators, so VALIDATE scans nothing. Replay-safe: guarded on the
-- constraint, and VALIDATE on an already-valid constraint is a no-op.

DO $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'crew_dispute_member_outcomes_decided_by_fkey'
          AND NOT convalidated
     ) THEN
    ALTER TABLE public.crew_dispute_member_outcomes
      VALIDATE CONSTRAINT crew_dispute_member_outcomes_decided_by_fkey;
  END IF;
END $$;
