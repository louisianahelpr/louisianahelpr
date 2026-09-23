-- Q210(c) (owner decision 2026-09-23): the urgent bonus is capped at $250.
-- Until now jobs_urgent_fee_ceiling allowed up to the budget ceiling ($1,000,
-- 20260923154148), so one checkout could reach ~$2,000 + fees.
--
-- ONE NUMBER: 250 here equals MAX_URGENT_FEE_DOLLARS in
-- supabase/functions/_shared/jobBudgetLimits.ts (src/lib/moneyLimits.ts
-- re-exports it for the posting form; create-payment refuses a checkout above
-- it). src/test/urgentBonusCap.test.ts reads the newest migration adding this
-- CHECK and fails when it disagrees with the constant.
--
-- There is no client UPDATE path: urgent_fee is in locked_everyone of the jobs
-- column-lock trigger, so the only writes are the poster's INSERT (this CHECK)
-- and server code.
--
-- EXISTING ROWS: not measured (written without prod access; needs a live
-- check). Unfunded SEED rows above the cap (e2e/happy-path/seedDataHeavy.ts
-- used to post urgent_fee 1000) are lowered to it, as 20260923154148 did for
-- budgets; a real or funded row is NEVER rewritten. The CHECK is added NOT
-- VALID and then VALIDATEd; if any other row is still above $250 this
-- migration RAISEs and names the count, so the deploy fails loudly instead of
-- leaving history unchecked.
--
-- REPLAY-SAFE: guarded on to_regclass; the clamp is a no-op on a re-run; DROP
-- CONSTRAINT IF EXISTS before the ADD.

DO $$
DECLARE
  v_over bigint;
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.jobs
     SET urgent_fee = 250
   WHERE is_seed IS TRUE
     AND stripe_payment_intent_id IS NULL
     AND urgent_fee > 250;

  ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_urgent_fee_ceiling;
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_urgent_fee_ceiling
    CHECK (urgent_fee IS NULL OR (urgent_fee >= 0 AND urgent_fee <= 250)) NOT VALID;

  SELECT count(*) INTO v_over FROM public.jobs WHERE urgent_fee < 0 OR urgent_fee > 250;
  IF v_over > 0 THEN
    RAISE EXCEPTION 'jobs_urgent_fee_ceiling: % existing row(s) have an urgent_fee outside $0-$250 that is not an unfunded seed row; resolve them before this migration can apply', v_over;
  END IF;

  ALTER TABLE public.jobs VALIDATE CONSTRAINT jobs_urgent_fee_ceiling;

  COMMENT ON CONSTRAINT jobs_urgent_fee_ceiling ON public.jobs IS
    'Mirror of MAX_URGENT_FEE_DOLLARS in supabase/functions/_shared/jobBudgetLimits.ts ($250 since Q210(c)). Guarded by src/test/urgentBonusCap.test.ts.';
END $$;
