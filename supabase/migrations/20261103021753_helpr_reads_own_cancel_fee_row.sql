-- A Helpr can read whether their own cancellation fee was actually sent (Q1916, Builder 16, 2026-11-02; for verdict
-- lh-authz-rls).
--
-- WHY: the Helpr's job card said "You received $X for the cancelled job" from jobs.cancellation_fee_status, which is
-- the POSTER's charge. The Helpr's own transfer is a separate row in cancellation_fee_transfers (pending, paid,
-- failed, reversed or waived), and it can wait or fail after the poster was charged (a payout hold, no payout
-- account, Stripe not saying the account is payable). The table had RLS on and no client grant or policy at all
-- (prod read 2026-11-02: 0 policies, service_role only, 0 rows), so the card could not tell, and claimed money
-- that had not landed.
--
-- WHAT BECOMES READABLE, AND BY WHOM: a signed-in member may read ONLY the rows whose helper_id is their own user
-- id (one row per job they were the hired Helpr on: UNIQUE (job_id, helper_id)), and ONLY six columns of them:
-- id, job_id, helper_id, helper_amount (what they are sent), status, paid_at. Never fee_amount, commission_percent,
-- platform_cut, stripe_transfer_id, failure_reason, failed_transfer_ids, created_at, updated_at. The poster reads
-- nothing (their side is jobs.cancellation_fee_status), anon reads nothing, and no client role may write.
-- Download My Data already gives the Helpr their own row (export_my_data, definer), so nothing here is new to them.
--
-- No money moves here. Replay-safe: GRANT is idempotent, DROP POLICY IF EXISTS / CREATE POLICY.
-- Proof: src/test/pglite/helprReadsOwnCancelFeeRow.pglite.mjs.

GRANT SELECT (id, job_id, helper_id, helper_amount, status, paid_at)
  ON public.cancellation_fee_transfers TO authenticated;

DROP POLICY IF EXISTS "Helpr reads their own cancellation fee row" ON public.cancellation_fee_transfers;
CREATE POLICY "Helpr reads their own cancellation fee row" ON public.cancellation_fee_transfers
  FOR SELECT TO authenticated
  USING (helper_id = (SELECT auth.uid()));
