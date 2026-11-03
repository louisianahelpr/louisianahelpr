-- Q1908 (finding lh-money-escrow@886256a04#1): a held tip's or a won chargeback's re-pay runs on the Stripe mode
-- the money was taken in, not on today's test-account enrolment.
--
-- WHAT WAS BROKEN. process-scheduled-payouts re-drives two ledgers every run: public.tip_hold_redrives (a tip
-- pulled back while its Helpr was on a payout hold, _shared/heldTipRepay.ts) and public.chargeback_clawbacks (a
-- won dispute's re-pay that waited on a hold, _shared/chargebackClawback.ts). Each row picked its Stripe key from
-- its job (Q1753, stripeMode.ts jobMoneyMode): the Checkout Session's cs_test_/cs_live_ prefix when the job has
-- one, otherwise EVERY party's enrolment today. A job with no prefix (gift-funded) whose poster or Helpr was
-- enrolled or un-enrolled between the charge and the re-drive then sent transfers.create to the other key (Stripe
-- refuses it, the row goes 'failed' and pages "pay by hand" for money that is fine) or refused a mix that was not
-- one at the charge.
--
-- THE CHANGE. Each ledger row records where its money sits, from the Stripe object the webhook wrote it from:
--   stripe_mode 'live'  the object's livemode was true;
--   stripe_mode 'test'  the object's livemode was false;
--   NULL                written before this column, or the object did not say.
-- The edge code (same change) writes it on insert (tip: the tip's PaymentIntent.livemode; clawback: the
-- Dispute.livemode) and re-drives a row on its stored mode, still refusing when any payee is not of that mode
-- (stripeMode.ts createStripeModeResolver.clientForStoredMode); a NULL row falls back to clientForJob as before.
--
-- BACKFILL: none, on purpose. Measured on prod 2026-11-03 05:25 CST (read-only `supabase db query --remote
-- --read-only`, a GROUP BY status over both tables): 0 rows in tip_hold_redrives and 0 rows in
-- chargeback_clawbacks, so nothing exists to backfill. Were there rows, NULL is still the honest value: the
-- only facts on a row (the job's session prefix, today's enrolment) are exactly what the NULL fallback reads.
--
-- No function reads or writes these tables by column list (export_my_data uses to_jsonb of the row, so a
-- member's export carries the new column as it is); no function is restated. Grants and RLS unchanged
-- (tip_hold_redrives server-only; chargeback_clawbacks admin + own-payee read, 20260923154149).
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS; the CHECK is added only when missing.
-- Proof: src/test/pglite/redriveRowsStoreStripeMode.pglite.mjs (applied 3x); edge proof
-- src/test/edge/cronStripeModePerJob.test.ts "Q1908".

ALTER TABLE public.tip_hold_redrives ADD COLUMN IF NOT EXISTS stripe_mode text;
ALTER TABLE public.chargeback_clawbacks ADD COLUMN IF NOT EXISTS stripe_mode text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tip_hold_redrives'::regclass
                  AND conname = 'tip_hold_redrives_stripe_mode_check') THEN
    ALTER TABLE public.tip_hold_redrives
      ADD CONSTRAINT tip_hold_redrives_stripe_mode_check CHECK (stripe_mode IS NULL OR stripe_mode IN ('live', 'test'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.chargeback_clawbacks'::regclass
                  AND conname = 'chargeback_clawbacks_stripe_mode_check') THEN
    ALTER TABLE public.chargeback_clawbacks
      ADD CONSTRAINT chargeback_clawbacks_stripe_mode_check CHECK (stripe_mode IS NULL OR stripe_mode IN ('live', 'test'));
  END IF;
END
$$;

COMMENT ON COLUMN public.tip_hold_redrives.stripe_mode IS
  'Q1908: the Stripe mode the tip was charged in (its PaymentIntent.livemode). The re-pay runs on it; NULL (older rows) falls back to the job''s mode.';
COMMENT ON COLUMN public.chargeback_clawbacks.stripe_mode IS
  'Q1908: the Stripe mode of the dispute (Dispute.livemode). The won re-pay runs on it; NULL (older rows) falls back to the job''s mode.';
