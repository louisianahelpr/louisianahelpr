-- The review-eligibility INSERT policy required jobs.payment_status = 'released',
-- but approving completion sets payment_status = 'payout_pending' (it only becomes
-- 'released' when the payout actually settles, hours later). The app auto-opens the
-- "Rate <Helpr>" sheet the moment the poster approves — i.e. at the exact moment the
-- policy still forbids the insert — so every natural post-approval review bounced
-- off RLS with a silent 42501 (verified live 2026-08-25: released job at
-- payout_pending, 5-star submit → "new row violates row-level security policy").
-- Funds are irrevocably committed to the helper at approval; a pending transfer is
-- no reason to block the review. Accept both settlement states.

DROP POLICY IF EXISTS "Users can create reviews for eligible jobs" ON public.reviews;
CREATE POLICY "Users can create reviews for eligible jobs" ON public.reviews
FOR INSERT WITH CHECK (
  (SELECT auth.uid()) = reviewer_id
  AND EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = reviews.job_id
      AND (j.customer_id = (SELECT auth.uid()) OR j.helper_id = (SELECT auth.uid()))
      AND ((j.customer_id = (SELECT auth.uid()) AND j.helper_id = reviews.reviewee_id)
        OR (j.helper_id = (SELECT auth.uid()) AND j.customer_id = reviews.reviewee_id))
      AND j.status = 'completed'::job_status
      AND j.payment_status IN ('released', 'payout_pending')
      AND (j.has_active_dispute = false OR j.dispute_resolved_at IS NOT NULL)
      AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days'
  )
);
