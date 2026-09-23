-- Q202 (owner decision 2026-09-23, card-dispute protection): the largest job
-- a poster may post drops from $5,000 to $1,000. A card dispute on a released
-- job costs the platform the whole charge plus Stripe's fee, so the biggest
-- single charge is the biggest single loss; bigger projects are split.
--
-- ONE NUMBER, three enforcement points, all 1000 here and all equal to
-- MAX_JOB_BUDGET_DOLLARS in supabase/functions/_shared/jobBudgetLimits.ts
-- (src/lib/moneyLimits.ts re-exports it; create-payment refuses a checkout
-- outside it). src/test/jobBudgetCapIsOneConstant.test.ts reads the newest
-- migration defining each of the three and fails if any disagrees:
--   1. validate_job_budget()      (trigger enforce_job_budget, INSERT/UPDATE OF budget)
--   2. jobs_budget_range          CHECK (budget >= 10 AND budget <= 1000)
--   3. jobs_urgent_fee_ceiling    CHECK (urgent_fee <= 1000): the urgent bonus is
--      capped at the budget ceiling (MAX_URGENT_FEE_DOLLARS = MAX_JOB_BUDGET_DOLLARS).
--
-- EXISTING ROWS ABOVE $1,000, measured on prod 2026-09-23 before writing this:
-- 47 jobs, ALL is_seed = true, status 'open', payment_status 'abandoned', no
-- stripe_payment_intent_id, budgets 2,500-5,000, created 2026-09-13 by the
-- boundary seeders (scripts/audit/prod-seed.mjs, e2e/happy-path/seedDataHeavy.ts,
-- both now capped at the new maximum). 0 rows had urgent_fee > 1000. No
-- non-seed row is above the cap.
--
-- "Do not break them": a CHECK is re-evaluated on EVERY update of a row, not
-- only when budget changes, so leaving those rows at 5,000 under a 1,000 CHECK
-- would make the next status write on them (auto-expire-jobs on an open job
-- past its date) fail. So step A lowers the unfunded SEED rows to the new
-- ceiling; a real (non-seed) or funded row is never rewritten here. If any such
-- row were above the cap, the CHECK is added NOT VALID instead (new and updated
-- rows enforced, history not scanned) and the migration says so in a NOTICE.
--
-- REPLAY-SAFE: guarded on to_regclass; CREATE OR REPLACE the function;
-- DROP CONSTRAINT IF EXISTS before each ADD; the clamp is a no-op on a re-run.

-- 1. The trigger function (defined first so the clamp below passes it).
DO $$
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.validate_job_budget()
   RETURNS trigger
   LANGUAGE plpgsql
   SET search_path TO 'public'
  AS $fn$
  BEGIN
    IF NEW.budget IS NOT NULL AND NEW.budget < 10 THEN
      RAISE EXCEPTION 'Minimum budget is $10';
    END IF;
    IF NEW.budget IS NOT NULL AND NEW.budget > 1000 THEN
      RAISE EXCEPTION 'Maximum budget is $1,000. Split a bigger project into separate jobs.';
    END IF;
    RETURN NEW;
  END;
  $fn$;

  -- A. Unfunded seed fixtures above the new ceiling come down to it.
  UPDATE public.jobs
     SET budget = LEAST(budget, 1000),
         urgent_fee = CASE WHEN urgent_fee > 1000 THEN 1000 ELSE urgent_fee END
   WHERE is_seed IS TRUE
     AND stripe_payment_intent_id IS NULL
     AND (budget > 1000 OR urgent_fee > 1000);

  -- 2. jobs_budget_range.
  ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_budget_range;
  IF EXISTS (SELECT 1 FROM public.jobs WHERE budget < 10 OR budget > 1000) THEN
    RAISE NOTICE 'jobs_budget_range added NOT VALID: % row(s) outside $10-$1,000 were not rewritten',
      (SELECT count(*) FROM public.jobs WHERE budget < 10 OR budget > 1000);
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_budget_range CHECK (budget >= 10 AND budget <= 1000) NOT VALID;
  ELSE
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_budget_range CHECK (budget >= 10 AND budget <= 1000);
  END IF;

  -- 3. jobs_urgent_fee_ceiling (two-sided, as 20260902213110 made it).
  ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_urgent_fee_ceiling;
  IF EXISTS (SELECT 1 FROM public.jobs WHERE urgent_fee < 0 OR urgent_fee > 1000) THEN
    RAISE NOTICE 'jobs_urgent_fee_ceiling added NOT VALID: % row(s) outside $0-$1,000 were not rewritten',
      (SELECT count(*) FROM public.jobs WHERE urgent_fee < 0 OR urgent_fee > 1000);
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_urgent_fee_ceiling
      CHECK (urgent_fee IS NULL OR (urgent_fee >= 0 AND urgent_fee <= 1000)) NOT VALID;
  ELSE
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_urgent_fee_ceiling
      CHECK (urgent_fee IS NULL OR (urgent_fee >= 0 AND urgent_fee <= 1000));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL THEN
    COMMENT ON CONSTRAINT jobs_budget_range ON public.jobs IS
      'Mirror of MAX_JOB_BUDGET_DOLLARS / MIN_JOB_BUDGET_DOLLARS in supabase/functions/_shared/jobBudgetLimits.ts ($10-$1,000 since Q202). Guarded by src/test/jobBudgetCapIsOneConstant.test.ts.';
  END IF;
END $$;

-- The trigger function is invoked by the trigger only; nobody calls it.
DO $$
BEGIN
  IF to_regprocedure('public.validate_job_budget()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.validate_job_budget() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
