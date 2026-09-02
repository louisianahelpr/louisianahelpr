-- IB-001 (launch audit, lh-input-boundary, 2026-09-02): the urgent-bonus
-- ceiling only ever existed client-side (MAX_URGENT_FEE_DOLLARS in
-- src/lib/moneyLimits.ts, enforced by a toast in useJobSubmit.ts). The live
-- jobs_urgent_fee_required CHECK constraint enforces only the $5 floor --
-- there was never a matching ceiling in the database, unlike the sibling
-- budget field (jobs_budget_range: budget >= 10 AND budget <= 5000).
--
-- create-payment/index.ts charges Math.round(job.urgent_fee * 100) straight
-- from the stored row with no re-validation at checkout, so a job inserted
-- directly against PostgREST with an oversized urgent_fee (bypassing the
-- post-job form entirely) would reach live Stripe checkout uncapped -- the
-- exact incident moneyLimits.ts already documents having happened once
-- (2026-08-31, $99,999 fee -> a $103,088.88 checkout), just via a different
-- bypass path than the one that got patched.
--
-- Mirrors jobs_budget_range's shape and its ceiling value (5000 --
-- MAX_URGENT_FEE_DOLLARS is defined as MAX_JOB_BUDGET_DOLLARS in
-- moneyLimits.ts, so a rush premium can never exceed the largest job we
-- allow). Verified against live prod before writing this: zero existing
-- rows have urgent_fee > 5000, so the constraint is safe to add directly
-- (no backfill needed).
--
-- lh-money-escrow review (2026-09-02) caught a second, opposite bypass a
-- ceiling-only CHECK would have left open: is_urgent=false, urgent_fee=-500
-- passes jobs_urgent_fee_required (vacuous when NOT is_urgent) AND a
-- ceiling-only CHECK, then create-payment/index.ts:308 charges the poster
-- $500 LESS than budget while netUrgentFeeDollars (_shared/stripeFees.ts)
-- clamps the payout side's cents to >= 0 -- so the helper still gets paid
-- the full per-helper budget and the platform eats the delta. Made the
-- constraint two-sided instead. Live-checked before writing: min(urgent_fee)
-- = 0, max = 10, 0 rows > 5000, 13 NULLs of 64 -- safe with no backfill.
--
-- REPLAY-SAFETY: guarded on to_regclass so a from-scratch rebuild is a
-- no-op if public.jobs doesn't exist yet (it won't be reached that early --
-- urgent_fee itself dates to migration 20260311214625 -- but matches house
-- style); DROP CONSTRAINT IF EXISTS before ADD so a re-run never fails on
-- "already exists".
DO $$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL THEN
    ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_urgent_fee_ceiling;
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_urgent_fee_ceiling
      CHECK (urgent_fee IS NULL OR (urgent_fee >= 0 AND urgent_fee <= 5000));
  END IF;
END $$;

