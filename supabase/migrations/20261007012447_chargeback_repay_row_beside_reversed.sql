-- Q805 (5): a WON card dispute re-pays the Helpr in Stripe, but its
-- payout_transfers row could never be written.
--
-- chargebackClawback.ts records the re-payment as its own row (status 'paid',
-- metadata.source 'chargeback-repay', same job_id and helper_id) and keeps the
-- ORIGINAL row 'reversed' (Stripe's truth). payout_transfers_one_live_per_job_helper
-- is unique on (job_id, helper_id) WHERE status IN ('pending','paid','reversed'),
-- so it refused the re-payment row with 23505 (driven in Stripe test mode
-- 2026-10-07 01:01Z; the CRITICAL "payout_transfers row NOT written" alert
-- fired; reproduced on prod in a rolled-back transaction). The Helpr was paid
-- and the ledger had no row: the reconciler and the unrecorded-transfer guards
-- could not see that money.
--
-- Now the index leaves chargeback re-payment rows out. Everything it exists
-- for still holds: the reversed original keeps the (job, helper) slot, so a
-- second ordinary payout or claim for that pair is still refused (no double
-- pay after a win), and each re-payment is one row per Stripe transfer
-- (payout_transfers_stripe_transfer_id_key, plus the repay idempotency key).
-- Writers of payout_transfers are service role and admins only (RLS).
--
-- Swapped under a new name first, so the table is never without the rule;
-- replay-safe (a no-op once the predicate excludes re-payments).

DO $$
BEGIN
  IF to_regclass('public.payout_transfers') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'public' AND indexname = 'payout_transfers_one_live_per_job_helper'
                AND indexdef LIKE '%chargeback-repay%') THEN
    RETURN;
  END IF;
  DROP INDEX IF EXISTS public.payout_transfers_one_live_per_job_helper_v2;
  CREATE UNIQUE INDEX payout_transfers_one_live_per_job_helper_v2
    ON public.payout_transfers (job_id, helper_id)
    WHERE status IN ('pending', 'paid', 'reversed')
      AND (metadata ->> 'source') IS DISTINCT FROM 'chargeback-repay';
  DROP INDEX IF EXISTS public.payout_transfers_one_live_per_job_helper;
  ALTER INDEX public.payout_transfers_one_live_per_job_helper_v2
    RENAME TO payout_transfers_one_live_per_job_helper;
END;
$$;
