-- Owner decision 2026-10-21 (top priority, via the coordinator): every job
-- still on the LEGACY fee model whose Helpr has not been paid moves to the
-- flat Helpr fee, 5% + $0.70 per Helpr (roadmap F3). The Helpr gets more.
--
-- Before: a job funded before 2026-10-15 carries no helper_fee_flat_cents
-- stamp, so every payout path prices its Helpr's commission at the legacy
-- tier (helper_fee_percent 12 on the open "GIVE AWAY!!" $60 job: $52.80
-- take-home, while the owner's post promises $56.30, which is $60 less
-- 5% + $0.70).
--
-- Now: such a job is stamped exactly as create-payment stamps a flat-model
-- job at funding: helper_fee_flat_cents 70, helper_fee_percent 5, and
-- platform_fee_amount = the flat fee on its pay (budget + urgent bonus), as
-- _shared/crewShares.ts jobFlatFeeTotalCents prices one Helpr. Every payout
-- path, the take-home display and money-reconciliation decide by that stamp.
--
-- Which jobs: legacy (no flat stamp, no poster-fee stamp), funded and not paid
-- out (payment_status escrow, payout_pending or cancelling), with no
-- payout_transfers row, and ONE-OFF only. Left alone:
--   * a series parent or a visit: stamping the parent would also change the
--     poster's fee on future visits (charge-recurring-visits reads it), which
--     nobody decided;
--   * a crew: process-scheduled-payouts' unfilled-spot refund keeps Stripe's
--     fee once through a legacy poster fee (feeReturnCents) and again through
--     a flat stamp (flatCardFeeKeptCents), so a restamped legacy crew would
--     under-refund its poster. Measured 2026-10-21: one funded legacy crew,
--     test-owned.
-- The poster side is not touched: what the poster paid (customer_fee_amount)
-- stays as paid, and a cancel still keeps it (the cancel dialog says so:
-- cancelRefundIsLessCardFee). Measured on prod 2026-10-21: 11 such one-off
-- jobs (2 real, 9 test-owned seed).
--
-- REPLAY-SAFETY: a stamped job no longer matches (helper_fee_flat_cents IS
-- NOT NULL), so a second run changes nothing. Guarded on the objects it reads.

DO $$
BEGIN
  IF to_regclass('public.jobs') IS NULL
     OR to_regclass('public.payout_transfers') IS NULL THEN
    RETURN;
  END IF;

  -- One Helpr's fee, exactly as _shared/helprFlatFee.ts helprFlatFeeCents
  -- prices it: 5% of the budget plus the urgent bonus, rounded to the cent,
  -- plus 70c, never more than the pay itself.
  UPDATE public.jobs j
     SET helper_fee_flat_cents = 70,
         helper_fee_percent = 5,
         platform_fee_amount = least(p.pay_cents, round(p.pay_cents * 5 / 100.0) + 70) / 100.0
    FROM (
      SELECT x.id,
             round(COALESCE(x.budget, 0) * 100)
               + CASE WHEN x.is_urgent THEN round(COALESCE(x.urgent_fee, 0) * 100) ELSE 0 END AS pay_cents
        FROM public.jobs x
    ) p
   WHERE p.id = j.id
     AND p.pay_cents > 0
     AND j.helper_fee_flat_cents IS NULL
     AND j.poster_fee_flat_cents IS NULL
     AND j.payment_status IN ('escrow', 'payout_pending', 'cancelling')
     AND NOT COALESCE(j.is_group_job, false)
     AND j.recurrence_days IS NULL
     AND j.parent_job_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.job_id = j.id);
END
$$;
