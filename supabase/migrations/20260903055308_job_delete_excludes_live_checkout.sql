-- `payment_status = 'unpaid'` is NOT the moneyless state. It is the
-- money-IN-FLIGHT state.
--
-- 20260903034507 narrowed the jobs DELETE policy to
-- `payment_status IN ('unpaid','abandoned') AND status = 'open'`, on the
-- reasoning that those two mean money was never taken. That is wrong for
-- `unpaid`, and the money lane proved it against prod in a rolled-back
-- transaction: insert a job at status='open', payment_status='unpaid',
-- stripe_session_id='cs_test_…', impersonate its owner, delete →
--
--     rows_deleted_by_poster = 1
--     orphaned_stripe_session = cs_test_LIVE_SESSION
--
-- `create-payment/index.ts:441` creates the Stripe Checkout Session, stamps
-- `stripe_session_id`, and DELIBERATELY leaves `payment_status = 'unpaid'`;
-- only the webhook flips it to `escrow`. So ('unpaid','open') is precisely the
-- state a job occupies while its checkout page is open on the poster's screen.
--
-- WHY IT MATTERED. If the row is gone when Stripe calls back,
-- checkoutSessionCompleted's UPDATE matched zero rows and returned
-- `error: null` — the success branch. It logged success, fanned out helper
-- matches, committed the idempotency row and 200-ACKed, so Stripe never
-- retried, and the Slack alert hung off the error that never came. Money
-- captured, nothing local pointing at it. Neither recovery path covers it:
-- paymentIntentSucceeded looks the job up by `stripe_payment_intent_id`, which
-- that very write is what sets, and money-reconciliation makes no Stripe calls
-- at all — every check starts from a `jobs` row, so a deleted job is invisible
-- to it by construction. That handler is now guarded in the same commit; this
-- migration closes the window rather than only surviving it.
--
-- TWO BACKSTOPS THAT ALREADY EXISTED, found by the money lane and worth
-- recording so nobody re-derives them: `payout_transfers.job_id` is
-- ON DELETE RESTRICT and `pif_credits.job_id` is NO ACTION, so a job that ever
-- PAID OUT is undeletable regardless of policy. The gap was only ever the
-- window between "checkout opened" and "webhook landed".
--
-- THE NEW CLAUSE IS `stripe_session_id IS NULL`, not a status list. A status
-- can be stale by a webhook's latency; the session id is written the moment
-- Stripe is involved and is the only field that says "money may be in flight"
-- independently of who has called back yet. `abandoned` keeps its own arm
-- because that state is set precisely when a checkout is known dead.
--
-- Measured before writing: 0 rows currently at ('unpaid','open') with a
-- session id, so nothing legitimate loses the ability to be deleted today.
--
-- Replay-safe: DROP POLICY IF EXISTS then CREATE.

DROP POLICY IF EXISTS "Customers can delete their own jobs" ON public.jobs;

CREATE POLICY "Customers can delete their own jobs"
  ON public.jobs
  FOR DELETE
  TO authenticated
  USING (
    (SELECT auth.uid()) = customer_id
    AND status = 'open'
    AND (
      -- Never started a checkout at all.
      (payment_status = 'unpaid' AND stripe_session_id IS NULL)
      -- Or started one and it is known dead.
      OR payment_status = 'abandoned'
    )
  );

COMMENT ON POLICY "Customers can delete their own jobs" ON public.jobs IS
  'A poster may delete only a job that never held money AND has no Stripe '
  'checkout in flight. `payment_status = ''unpaid''` alone is NOT sufficient: '
  'create-payment stamps stripe_session_id and leaves the status unpaid until '
  'the webhook flips it to escrow, so unpaid+session is a live checkout. '
  'Deleting there captured the money with no local row to attach it to, and '
  'the webhook UPDATE matching zero rows returned error:null and ACKed 200.';
