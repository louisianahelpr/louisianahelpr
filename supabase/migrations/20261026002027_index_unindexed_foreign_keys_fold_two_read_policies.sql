-- The Supabase PERFORMANCE advisor's exact baseline (scripts/ci/performance-advisor-baseline.json,
-- Q1321) went red in db-drift-detect (run 40112202504, 2026-10-24) on two classes. Read live
-- with get_advisors (performance) on prod at 2026-10-26 00:18Z:
--
-- 1. unindexed_foreign_keys: 8 (the baseline holds this class at zero). Each column below
--    references auth.users(id) (pg_constraint.confrelid read the same minute), except
--    payout_setup_reminders.job_id, which references public.jobs(id). Without a covering
--    index, deleting a member's account (or a job) scans the whole referencing table.
--      disputes.agreed_helper_id                   disputes_agreed_helper_id_fkey
--      disputes.agreed_poster_id                   disputes_agreed_poster_id_fkey
--      job_approval_escalations.resolved_by        job_approval_escalations_resolved_by_fkey
--      provider_payments.payer_id                  provider_payments_payer_id_fkey
--      provider_payouts.payee_user_id              provider_payouts_payee_user_id_fkey
--      support_replies.admin_id                    support_replies_admin_id_fkey
--      payout_setup_reminders.job_id               payout_setup_reminders_job_id_fkey
--      connect_account_retirements.user_id        connect_account_retirements_user_id_fkey
--    One plain CREATE INDEX IF NOT EXISTS per column, written out (not built in a loop, so the
--    baseline guard can read each one). They start out unused, so the baseline names all eight
--    in unused_index in this same change.
--
-- 2. multiple_permissive_policies 31 -> 33: two tables gained a second permissive SELECT
--    policy for authenticated: group_job_helpers ("Admins can view group helpers",
--    20261021101837, beside "Job participants can view group helpers") and refund_requests
--    ("refund requests admin read" beside "refund requests parties read", 20261021102943).
--    Each pair is restated as ONE read policy whose USING is the two live conditions OR'd,
--    verbatim (pg_policies read 2026-10-26), so exactly the same rows stay readable by
--    exactly the same callers (precedents: 20261012193325, 20261020225414). The count goes
--    back to 31; no other policy, grant or column changes.
--
-- REPLAY-SAFETY: every table comes from an EARLIER migration (disputes 20260609140000,
-- job_approval_escalations 20261023143240, provider_payments/payouts 20261023223419,
-- support_replies 20261023200521, payout_setup_reminders and connect_account_retirements
-- 20261025162003, group_job_helpers 20260311041556, refund_requests 20261021102943);
-- CREATE INDEX IF NOT EXISTS and DROP POLICY IF EXISTS / CREATE POLICY make a second and
-- third run a no-op.

-- 1. The eight foreign-key indexes.
CREATE INDEX IF NOT EXISTS disputes_agreed_helper_id_idx ON public.disputes (agreed_helper_id);
CREATE INDEX IF NOT EXISTS disputes_agreed_poster_id_idx ON public.disputes (agreed_poster_id);
CREATE INDEX IF NOT EXISTS job_approval_escalations_resolved_by_idx ON public.job_approval_escalations (resolved_by);
CREATE INDEX IF NOT EXISTS provider_payments_payer_id_idx ON public.provider_payments (payer_id);
CREATE INDEX IF NOT EXISTS provider_payouts_payee_user_id_idx ON public.provider_payouts (payee_user_id);
CREATE INDEX IF NOT EXISTS support_replies_admin_id_idx ON public.support_replies (admin_id);
CREATE INDEX IF NOT EXISTS payout_setup_reminders_job_id_idx ON public.payout_setup_reminders (job_id);
CREATE INDEX IF NOT EXISTS connect_account_retirements_user_id_idx ON public.connect_account_retirements (user_id);

-- 2a. group_job_helpers: one read policy (admin OR the job's poster OR the crew member).
DROP POLICY IF EXISTS "Admins can view group helpers" ON public.group_job_helpers;
DROP POLICY IF EXISTS "Job participants can view group helpers" ON public.group_job_helpers;
DROP POLICY IF EXISTS "Admins and job participants can view group helpers" ON public.group_job_helpers;
CREATE POLICY "Admins and job participants can view group helpers" ON public.group_job_helpers
  FOR SELECT TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR (SELECT auth.uid()) IN (SELECT jobs.customer_id FROM public.jobs WHERE jobs.id = group_job_helpers.job_id)
    OR (SELECT auth.uid()) = helper_id
  );

-- 2b. refund_requests: one read policy (admin OR either party).
DROP POLICY IF EXISTS "refund requests admin read" ON public.refund_requests;
DROP POLICY IF EXISTS "refund requests parties read" ON public.refund_requests;
DROP POLICY IF EXISTS "refund requests admin or parties read" ON public.refund_requests;
CREATE POLICY "refund requests admin or parties read" ON public.refund_requests
  FOR SELECT TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR requester_id = (SELECT auth.uid())
    OR responder_id = (SELECT auth.uid())
  );
