-- Jobs poster fee (owner 2026-10-18, "one fee everywhere", the Declutter rule):
-- the job POSTER pays 5% of the job price (budget + urgent bonus) + $0.70 at
-- checkout, the card cost comes out of that fee, and the HELPR keeps 100% of
-- their pay. It replaces the roadmap F3 flat model (poster pays the price only,
-- Helpr pays 5% + 70c) for NEW checkouts only: a job already funded keeps the
-- model it was funded under, decided by its own stamps, never by date.
--
-- The model is stamped on each job by create-payment at funding:
--   poster_fee_flat_cents = 70 (this column; NULL = not on this model)
--   platform_fee_percent  = 5  (existing poster-side column)
--   customer_fee_amount   = the fee charged (existing)
--   helper_fee_flat_cents = 0, helper_fee_percent = 0 (existing F3 stamp), so
--     every Helpr payout path, which prices the Helpr by that stamp
--     (_shared/helprFlatFee.ts, SQL helpr_flat_fee_cents), takes nothing.
--
-- Two CHECKs make the stamps agree, so no row can say both "the poster paid the
-- fee" and "the Helpr pays a fee" (the platform paid twice), or "nobody pays"
-- (the platform absorbs the card cost):
--   jobs_poster_fee_model_consistent: a 0c Helpr flat stamp exists ONLY on a
--     poster-fee job, and a poster-fee job's Helpr stamp is exactly 0/0. So a
--     read that carries helper_fee_flat_cents without the percent can still tell
--     a poster-fee job (helprFlatFee.ts helprPaysNoFee). NULL-safe both halves.
--
-- The column is SERVER-ONLY, like helper_fee_flat_cents: enforce_jobs_fee_model_lock
-- (20261015023908) is restated to clear it on any non-server INSERT and refuse
-- any non-server change (42501). Restated from the live body (pg_get_functiondef
-- on prod, 2026-10-17 ~23:10Z, md5 35f74ea1eea05dc162524fcb5fc8f514), which is
-- that migration's text; its helper_fee_flat_cents handling is unchanged.
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS, constraints added only when absent,
-- CREATE OR REPLACE, DROP TRIGGER IF EXISTS. No existing row carries the new
-- stamp or a 0/0 Helpr stamp (prod census 2026-10-17: 72 rows with a Helpr
-- stamp, all 70/5; none with a 0c flat stamp), so both CHECKs validate on every
-- existing row.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS poster_fee_flat_cents integer;

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'jobs_poster_fee_flat_cents_range'
       AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_poster_fee_flat_cents_range
      CHECK (poster_fee_flat_cents IS NULL OR poster_fee_flat_cents BETWEEN 0 AND 10000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'jobs_poster_fee_model_consistent'
       AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_poster_fee_model_consistent
      CHECK (
        (poster_fee_flat_cents IS NULL) = (helper_fee_flat_cents IS DISTINCT FROM 0)
        AND (poster_fee_flat_cents IS NULL OR helper_fee_percent IS NOT DISTINCT FROM 0)
      );
  END IF;
END
$mig$;

-- Column-level SELECT for authenticated (20260915045110): a new jobs column is
-- unreadable until the grants are re-synced. Readable like the other stamps:
-- the poster's job and receipt screens price a job by it.
DO $g$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  END IF;
END
$g$;

COMMENT ON COLUMN public.jobs.poster_fee_flat_cents IS
  'Jobs poster fee (owner 2026-10-18): the fixed cents of the poster''s 5% + 70c fee (percent in platform_fee_percent, amount in customer_fee_amount). NULL = not on this model. When set, the Helpr stamp is 0/0. Stamped by create-payment only.';

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
    NEW.poster_fee_flat_cents := NULL;
    RETURN NEW;
  END IF;
  IF NEW.helper_fee_flat_cents IS DISTINCT FROM OLD.helper_fee_flat_cents THEN
    RAISE EXCEPTION 'Only the server may set jobs.helper_fee_flat_cents'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.poster_fee_flat_cents IS DISTINCT FROM OLD.poster_fee_flat_cents THEN
    RAISE EXCEPTION 'Only the server may set jobs.poster_fee_flat_cents'
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
