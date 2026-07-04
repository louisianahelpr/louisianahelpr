-- F-MONEY-30: allow an operator to re-enable payout after manually
-- reconciling a reversed transfer. release-payout's dedupe now blocks on
-- 'reversed' ledger rows (a reversal means money moved once and was clawed
-- back — re-paying must be a human decision). The operator signals that
-- decision by setting the row's status to 'reversal_cleared', which the
-- dedupe no longer matches.
ALTER TABLE public.payout_transfers
  DROP CONSTRAINT IF EXISTS payout_transfers_status_check;
ALTER TABLE public.payout_transfers
  ADD CONSTRAINT payout_transfers_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'reversed', 'reversal_cleared'));
