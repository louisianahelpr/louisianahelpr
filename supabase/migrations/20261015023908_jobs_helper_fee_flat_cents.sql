-- Jobs flat fee (roadmap F3, owner 2026-10-14/15): the poster pays exactly the
-- job price; the Helpr pays a flat 5% + $0.70 out of their pay, replacing the
-- tiered Helpr commission. NEW jobs only: a job funded before the change keeps
-- its old fee model.
--
-- The model has to be stamped on each job, or a payout could not tell an old
-- job from a new one. create-payment stamps it at funding:
--   helper_fee_percent    = 5  (existing column, already locked once funded)
--   helper_fee_flat_cents = 70 (this column; NULL = a legacy job)
-- Every payout path reads the stamp (supabase/functions/_shared/helprFlatFee.ts),
-- never today's date or today's settings.
--
-- The column is SERVER-ONLY. A poster who could write it could flip a funded
-- legacy job onto (or off) the flat model and move the Helpr's pay. The big
-- enforce_poster_jobs_money_lock is a blocklist that only locks fee columns
-- once funded, so this column gets its own small lock instead of a rewrite of
-- that function: any non-server INSERT has it cleared, any non-server UPDATE
-- that changes it is refused (42501). Service-role writers (create-payment)
-- pass through is_server_context().
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS; the constraint is added only when absent.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS helper_fee_flat_cents integer;

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'jobs_helper_fee_flat_cents_range'
       AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_helper_fee_flat_cents_range
      CHECK (helper_fee_flat_cents IS NULL OR helper_fee_flat_cents BETWEEN 0 AND 10000);
  END IF;
END
$mig$;

-- Column-level SELECT for authenticated (20260915045110): a new jobs column is
-- unreadable until the grants are re-synced. Readable like helper_fee_percent:
-- a Helpr's take-home display prices a flat-model job by this stamp.
DO $g$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  END IF;
END
$g$;

COMMENT ON COLUMN public.jobs.helper_fee_flat_cents IS
  'Jobs flat fee (F3): the fixed cents taken from each Helpr payout on top of helper_fee_percent. NULL = legacy tier-commission job. Stamped by create-payment only.';

CREATE OR REPLACE FUNCTION public.enforce_jobs_fee_model_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.helper_fee_flat_cents := NULL;
    RETURN NEW;
  END IF;
  IF NEW.helper_fee_flat_cents IS DISTINCT FROM OLD.helper_fee_flat_cents THEN
    RAISE EXCEPTION 'Only the server may set jobs.helper_fee_flat_cents'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_jobs_fee_model_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS jobs_fee_model_lock ON public.jobs;
CREATE TRIGGER jobs_fee_model_lock
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_fee_model_lock();
