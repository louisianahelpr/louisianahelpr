-- Extend payment_status CHECK to include 'failed' and 'chargeback'.
--
-- 'failed'     → stripe-webhook's payment_intent.payment_failed handler
--               already writes this value, but the existing CHECK constraint
--               rejected it, silently leaving disputed jobs stuck in 'escrow'.
-- 'chargeback' → written by the new charge.dispute.created handler to block
--               automated payouts (process-scheduled-payouts, release-payout)
--               while a Stripe chargeback is open. Without this block the
--               payout cron pays the helper from money Stripe has already
--               clawed back from the platform.
--
-- Replay-safe: drops the existing constraint by dynamic lookup so the block
-- is idempotent whether the previous version is named by Postgres or by
-- the previous migration's explicit CONSTRAINT name.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.jobs'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%payment_status%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.jobs DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_payment_status_check
  CHECK (payment_status IN (
    'unpaid',
    'escrow',
    'payout_pending',
    'released',
    'refunded',
    'cancelled',
    'abandoned',
    'failed',
    'chargeback'
  ));

COMMENT ON CONSTRAINT jobs_payment_status_check ON public.jobs IS
'Allowed payment lifecycle values. abandoned=expired checkout, failed=charge declined, chargeback=Stripe dispute/chargeback active — automated payouts blocked.';
