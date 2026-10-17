-- Cover the two foreign keys the Supabase performance advisor reported as
-- unindexed on 2026-10-17 (unindexed_foreign_keys, db-drift-detect, nightly-red
-- #3154). Both are ON DELETE SET NULL: deleting an account (auth.users) or a
-- job sweeps the child table for referencing rows, and without an index that
-- is a sequential scan on every deletion.
--   category_suggestions.reviewed_by -> auth.users(id)  (20261015051141)
--   job_quote_requests.job_id        -> public.jobs(id) (20261015091114)
-- The reviewed_by index uses the exact name PR #3150 (20261015120000, open) gives
-- it, so whichever lands second is a no-op instead of a duplicate index.
-- Replay-safe: IF NOT EXISTS, and each is skipped when its table is absent.
DO $$
BEGIN
  IF to_regclass('public.category_suggestions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_category_suggestions_reviewed_by
      ON public.category_suggestions (reviewed_by);
  END IF;
  IF to_regclass('public.job_quote_requests') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS job_quote_requests_job_id_idx
      ON public.job_quote_requests (job_id);
  END IF;
END $$;
