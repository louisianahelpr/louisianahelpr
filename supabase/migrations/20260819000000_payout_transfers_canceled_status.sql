-- Add 'canceled' to payout_transfers.status allowed values.
-- transfer.canceled is a subscribed Stripe webhook event fired when a Connect
-- transfer is canceled before it settles. The handleTransferCanceled webhook
-- handler (added in the same PR) stamps this status and resets the job to
-- payout_pending so the payout cron retries. Without 'canceled' in the CHECK
-- the UPDATE would be rejected by the DB constraint and the event handler would
-- throw — rolling back the idempotency row and letting Stripe retry, which is
-- correct but would loop forever. Adding it here makes the column consistent
-- with the full Stripe transfer lifecycle.
ALTER TABLE public.payout_transfers
  DROP CONSTRAINT IF EXISTS payout_transfers_status_check;
ALTER TABLE public.payout_transfers
  ADD CONSTRAINT payout_transfers_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'canceled', 'reversed', 'reversal_cleared'));
