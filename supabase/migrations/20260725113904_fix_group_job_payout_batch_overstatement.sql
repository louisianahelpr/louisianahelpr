-- Fix: get_payout_batches() overstated group-job payout totals.
--
-- Root cause (verified against the actual payout-execution code, an audit
-- finding): the real payout paths — release-payout/index.ts:317-324 and
-- process-scheduled-payouts/index.ts:67-80 — both divide a group job's
-- `budget` by `helpers_needed` before computing a helper's take-home, because
-- a group job charges the poster the budget ONCE but pays out to N helpers
-- (each `jobs` row carries one `helper_id` but the SAME shared `budget`).
-- `get_payout_batches()` (the admin "pending payouts" preview RPC) never
-- applied that division and ignored `urgent_fee` entirely, so for any
-- completed group job it reported N× the correct total_payout per helper.
--
-- This is a DISPLAY-ONLY bug — actual transfers already go through
-- release-payout/process-scheduled-payouts, which compute correctly, so no
-- money was ever paid out wrong. Only the admin console's preview total (what
-- a batch is ABOUT to pay) was inflated for group jobs.
--
-- Fix mirrors the real formula: perHelperBudget = budget / helpersCount;
-- payout = perHelperBudget * (1 - feePercent/100) + netUrgentFee/helpersCount,
-- where netUrgentFee nets out Stripe's 2.9% marginal processing cost (see
-- stripeFees.ts's stripePercentCostCost/netUrgentFeeDollars — reproduced
-- inline here since this is a read-only aggregate preview, not a cent-exact
-- transfer amount, so bit-for-bit rounding parity with the real payout isn't
-- required, just the correct formula shape).
--
-- Replay-safe: CREATE OR REPLACE is idempotent; only the total_payout
-- expression changes, everything else (signature, guard, grants) is
-- unchanged from the function this replaces.

CREATE OR REPLACE FUNCTION public.get_payout_batches()
 RETURNS TABLE(helper_id uuid, helper_name text, helper_email text, stripe_account_id text, job_count integer, total_payout numeric, oldest_completed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    j.helper_id,
    p.full_name AS helper_name,
    p.email AS helper_email,
    p.stripe_account_id,
    count(*)::int AS job_count,
    sum(
      (j.budget / (CASE WHEN j.is_group_job AND j.helpers_needed IS NOT NULL AND j.helpers_needed > 0
                         THEN j.helpers_needed ELSE 1 END))
        * (1 - COALESCE(j.helper_fee_percent, 10) / 100.0)
      + (COALESCE(j.urgent_fee, 0) * (1 - 0.029))
        / (CASE WHEN j.is_group_job AND j.helpers_needed IS NOT NULL AND j.helpers_needed > 0
                THEN j.helpers_needed ELSE 1 END)
    )::numeric(10,2) AS total_payout,
    min(COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at)) AS oldest_completed_at
  FROM public.jobs j
  JOIN public.profiles p ON p.user_id = j.helper_id
  WHERE j.status = 'completed'
    AND j.payment_status IN ('escrow', 'payout_pending')
    AND j.helper_id IS NOT NULL
    -- server-side admin authorization: non-admins get zero rows, not the data
    AND public.has_role(auth.uid(), 'admin')
  GROUP BY j.helper_id, p.full_name, p.email, p.stripe_account_id
  ORDER BY oldest_completed_at ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.get_payout_batches() TO authenticated;
