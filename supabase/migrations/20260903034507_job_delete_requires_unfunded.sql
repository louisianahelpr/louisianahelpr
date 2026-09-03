-- A poster can delete a job with money sitting in escrow.
--
-- MEASURED LIVE, and it is reachable today:
--     DELETE policies on public.jobs          1
--     its USING clause                        (SELECT auth.uid()) = customer_id
--     restrictive policies                    0
--     BEFORE DELETE triggers                  0
--     authenticated holds DELETE              yes
--     escrow-funded jobs with a live owner     28
--
-- There is no state predicate at all. Ownership is the entire test, so every one
-- of those 28 funded jobs is deletable by its poster right now through a raw
-- PostgREST call. The cascades take applications, messages, job_tracking,
-- reviews, tips, disputes and job_disputes with them; payment_refunds.job_id is
-- SET NULL. The Stripe PaymentIntent survives with nothing local pointing at it —
-- money held by Stripe, and no row left that knows whose it is or what it was for.
--
-- NOT REACHABLE THROUGH THE UI, which is why it has gone unnoticed and why it is
-- worth fixing rather than shrugging at. The app's only delete call site is
-- `cleanupOrphanJob` in useJobSubmit.ts:47 — a rollback for a job whose PAYMENT
-- SETUP FAILED, i.e. one that never held money. The hole is the gap between what
-- the app does and what the policy permits, and the publishable key is enough to
-- stand in that gap.
--
-- THE NEW PREDICATE IS AN ALLOW-LIST, NOT A DENY-LIST. `payment_status` has ten
-- permitted values today (its CHECK constraint), and a deny-list would silently
-- admit the eleventh — exactly the "registry that cannot fail for a missing
-- member" shape that produced eight wrong results in this audit. Only the two
-- states that mean *money was never taken* are listed:
--
--     'unpaid'     the column default; a job whose checkout never started
--     'abandoned'  a job whose checkout started and did not complete
--
-- Plus `status = 'open'`, because a job that is in_progress, completed or
-- disputed has a counterparty with an interest in it regardless of how it was
-- funded.
--
-- MEASURED IMPACT ON WHAT STAYS DELETABLE: 4 rows — every one of them
-- `abandoned`/`open`, i.e. precisely the orphan-cleanup case. cleanupOrphanJob
-- is unaffected. Nothing a poster can legitimately do today stops working.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: it does not give posters a way to cancel a
-- funded job. That path exists and goes through the refund flow, which returns
-- the money. Deleting the row was never the cancel button; it was the absence of
-- a lock on one.
--
-- Replay-safe: DROP POLICY IF EXISTS then CREATE.

DROP POLICY IF EXISTS "Customers can delete their own jobs" ON public.jobs;

CREATE POLICY "Customers can delete their own jobs"
  ON public.jobs
  FOR DELETE
  TO authenticated
  USING (
    (SELECT auth.uid()) = customer_id
    AND payment_status IN ('unpaid', 'abandoned')
    AND status = 'open'
  );

COMMENT ON POLICY "Customers can delete their own jobs" ON public.jobs IS
  'A poster may delete only a job that NEVER HELD MONEY and has not started: '
  'payment_status unpaid/abandoned and status open. Ownership alone used to be '
  'the whole test, which made all 28 escrow-funded jobs deletable via raw '
  'PostgREST — cascading applications, messages, reviews, tips and disputes '
  'while the Stripe PaymentIntent survived orphaned. Cancelling a FUNDED job is '
  'the refund flow, not a DELETE. Allow-list, not deny-list: payment_status has '
  'ten permitted values and a deny-list would admit the eleventh.';
