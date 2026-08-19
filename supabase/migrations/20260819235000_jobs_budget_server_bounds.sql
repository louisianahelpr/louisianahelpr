-- jobs.budget: enforce the $10–$5,000 range in the DATABASE, not just the form.
--
-- `MIN_JOB_BUDGET_DOLLARS` / `MAX_JOB_BUDGET_DOLLARS` (src/lib/moneyLimits.ts)
-- were checked only in useJobSubmit's client-side validation. The jobs INSERT
-- goes through PostgREST with the poster's own token, so anyone can post a job
-- at any budget by calling the API directly — $0.01 (a job whose service fee
-- exceeds its value and whose payout can't clear Stripe's minimum), a negative
-- number (which flips platform_fee_amount and the escrow math), or $1,000,000
-- (which would then be quoted, escrowed, and shown across the marketplace).
--
-- The constraint is NOT VALID so it applies to new and updated rows without
-- scanning history: no production row is outside the range today, but a legacy
-- seed row that is would otherwise make this migration fail to apply.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_budget_range'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_budget_range
      CHECK (budget >= 10 AND budget <= 5000)
      NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT jobs_budget_range ON public.jobs IS
  'Server-side mirror of MIN_JOB_BUDGET_DOLLARS/MAX_JOB_BUDGET_DOLLARS in src/lib/moneyLimits.ts. Change both together.';
