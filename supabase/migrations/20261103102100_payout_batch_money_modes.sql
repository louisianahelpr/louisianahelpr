-- Q2088 (lh-money-escrow pass of Q1760, 2026-10-14): Admin -> Payout Batches labelled a batch "test account" from the
-- Helpr's profiles.is_seed alone, while release-payout pays where the money sits (_shared/stripeMode.ts jobMoneyMode,
-- kind 'payout'): the job's stored Checkout Session prefix (cs_test_ / cs_live_) when it has one, otherwise test only
-- when EVERY party on the job (poster, hired Helpr, crew) is enrolled in test_accounts. So a seed Helpr missing from
-- test_accounts, or a seed Helpr hired on a real poster's job, showed as a test payout while it would pay LIVE. No
-- wrong money (the transfer follows jobMoneyMode); the label and the confirm's "real money" total could be wrong.
--
-- New, read-only: admin_payout_batch_money_modes() returns one row per batch get_payout_batches lists (same filter:
-- completed, escrow / payout_pending, a Helpr, no decided-but-unexecuted dispute, admins only) with money_mode
-- 'test' (every job in the batch pays in test mode), 'live' (none does) or 'mixed'. A job whose parties mix test and
-- real accounts with no stored session is refused by release-payout; it is counted 'live' here, so it is never
-- called a test payout. AdminPayoutBatches labels by money_mode; is_seed still decides only whether a row is shown.
-- get_payout_batches itself is unchanged (no restate). REPLAY-SAFETY: CREATE OR REPLACE and REVOKE/GRANT only; every
-- relation it reads exists before this file (test_accounts 20261007033530, group_job_helpers, disputes, has_role).
-- Proof: src/test/pglite/payoutBatchMoneyModes.pglite.mjs (NEW_MIGRATION=skip red).

CREATE OR REPLACE FUNCTION public.admin_payout_batch_money_modes()
RETURNS TABLE(helper_id uuid, money_mode text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH batch_jobs AS (
    SELECT j.id, j.helper_id, j.customer_id, j.stripe_session_id
      FROM public.jobs j
     WHERE j.status = 'completed'
       AND j.payment_status IN ('escrow', 'payout_pending')
       AND j.helper_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.disputes d
          WHERE d.job_id = j.id
            AND d.status = 'decided'
            AND (d.execution_status IS NULL OR d.execution_status <> 'executed')
       )
       AND public.has_role(auth.uid(), 'admin')
  ), job_modes AS (
    SELECT b.helper_id,
           CASE
             WHEN b.stripe_session_id LIKE 'cs\_test\_%' THEN 'test'
             WHEN b.stripe_session_id LIKE 'cs\_live\_%' THEN 'live'
             WHEN NOT EXISTS (
               SELECT 1
                 FROM (SELECT b.customer_id AS uid
                       UNION SELECT b.helper_id
                       UNION SELECT g.helper_id FROM public.group_job_helpers g WHERE g.job_id = b.id) parties
                WHERE parties.uid IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = parties.uid)
             ) THEN 'test'
             ELSE 'live'
           END AS mode
      FROM batch_jobs b
  )
  SELECT m.helper_id,
         CASE WHEN bool_and(m.mode = 'test') THEN 'test'
              WHEN bool_and(m.mode = 'live') THEN 'live'
              ELSE 'mixed' END AS money_mode
    FROM job_modes m
   GROUP BY m.helper_id;
$fn$;

REVOKE ALL ON FUNCTION public.admin_payout_batch_money_modes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_batch_money_modes() TO authenticated, service_role;
