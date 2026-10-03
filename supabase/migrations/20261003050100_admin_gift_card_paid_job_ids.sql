-- Q443 again: the admin money reads 403'd (42501 "permission denied for table
-- jobs") from the moment 20261002050635 deployed.
--
-- payment_captured(jobs) was a PostgREST computed field. PostgREST calls a
-- computed field with the WHOLE row (`public.payment_captured("jobs")`), and a
-- whole-row reference needs SELECT on every column of jobs. authenticated has
-- no table-level SELECT on jobs and no grant on offered_to_helper_id, on
-- purpose (20260915045110, owner decision 2026-09-14). So every read that
-- selected or filtered the field failed, for admins too:
--   - Admin.tsx: Payments Collected, the two revenue windows, the tax quarter;
--   - AdminAnalytics.tsx: the whole job load (every analytics tile) and the
--     revenue / fees / payouts drill-downs;
--   - useAdminUserSummaries.ts: every user's pay summary.
-- Measured on prod 2026-10-03: edge_logs show 403 on exactly those GETs from
-- 2026-10-02 09:12Z; postgres_logs "permission denied for table jobs"; a
-- rolled-back probe as authenticated reads the money columns fine and fails
-- 42501 as soon as payment_captured(j) is added. press-every-control run
-- 37026343825 failed /admin and /admin?view=analytics on it.
--
-- A computed field over jobs cannot work while a column is withheld from
-- authenticated, so the database now answers the one thing the client cannot
-- read for itself: which jobs a redeemed, paid gift card paid. Admins cannot
-- read gift_cards (party-only RLS), hence SECURITY DEFINER; the has_role gate
-- returns nothing to anyone else, so a non-admin still never learns whether a
-- job was gift-funded. The client keeps the rest of the rule (held status AND
-- (job PI OR a gift-card-paid id)) in src/lib/capturedPayment.ts.
--
-- The gift row is not required to carry its own PI: a remainder card minted by
-- redeem_gift_card (parent_credit_id) has none, and its money came through the
-- parent's PI. payment_status = 'paid' is the evidence there (as in
-- 20261002050635).
--
-- REPLAY-SAFETY: CREATE OR REPLACE and DROP ... IF EXISTS; has_role and
-- gift_cards exist long before this version.

CREATE OR REPLACE FUNCTION public.admin_gift_card_paid_job_ids()
RETURNS TABLE (job_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT g.job_id
    FROM public.gift_cards g
   WHERE public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
     AND g.job_id IS NOT NULL
     AND g.status = 'redeemed'
     AND g.payment_status = 'paid'
$$;

REVOKE ALL ON FUNCTION public.admin_gift_card_paid_job_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_gift_card_paid_job_ids() TO authenticated, service_role;

-- Nothing reads it any more, and no client role can call it the way PostgREST
-- does. Leaving it would expose a field that fails every query that names it.
DROP FUNCTION IF EXISTS public.payment_captured(public.jobs);
