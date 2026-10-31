-- NIGHT-SELL-soldstates-4 (buying.md #47): a failed seller payout says honestly whether we are still trying. The payout
-- run retries a failed payout on its own (declutter_payouts_due, newest 20261026155251: attempts < 12, backing off
-- 10 minutes doubling to a day), then stops; nothing restarts it but Support. The seller's card could not tell the two
-- apart: members read declutter_payouts through a COLUMN grant (20261015042253) that leaves out attempts.
--
-- This adds attempts to that grant. The row policy "declutter payouts: seller reads own" is unchanged, so a member
-- reads the try count of their OWN payouts only; it holds no money, account or other-person data.
-- Replay-safe: GRANT repeats.

GRANT SELECT (attempts) ON TABLE public.declutter_payouts TO authenticated;
