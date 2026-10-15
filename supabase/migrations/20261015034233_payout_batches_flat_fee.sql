-- Jobs flat fee (roadmap F3, owner 2026-10-14/15): the admin payout-batch
-- preview prices a flat-model job (jobs.helper_fee_flat_cents set, 20261015023908)
-- at 5% + $0.70 of the per-Helpr share of budget + urgent bonus (F3b: the bonus
-- is part of the job price), the same rule every payout path now uses. A legacy
-- job keeps the old expression unchanged. (The preview does not floor to whole
-- dollars, as before; the transfer does.)
--
-- Body copied from the newest definition (20261005172816; equal to the live
-- pg_get_functiondef read 2026-10-15) with only the CASE and the gross-share
-- LATERAL added. REPLAY-SAFE: CREATE OR REPLACE, grants restated.

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
      CASE WHEN j.helper_fee_flat_cents IS NOT NULL THEN
        -- Roadmap F3: a flat-model job pays 5% + 70c (its stamp) on the
        -- per-Helpr share of budget + urgent bonus, never more than that
        -- share, exactly as _shared/helprFlatFee.ts helprFlatFeeCents.
        s.gross_share - LEAST(s.gross_share,
          (ROUND(ROUND(s.gross_share * 100) * COALESCE(j.helper_fee_percent, 5) / 100.0)
            + j.helper_fee_flat_cents) / 100.0)
      ELSE
      (j.budget / (CASE WHEN j.is_group_job AND j.helpers_needed IS NOT NULL AND j.helpers_needed > 0
                         THEN j.helpers_needed ELSE 1 END))
        * (1 - COALESCE(j.helper_fee_percent, 10) / 100.0)
      -- Q362: the whole urgent bonus goes to the Helpr (no card-fee netting).
      + COALESCE(j.urgent_fee, 0)
        / (CASE WHEN j.is_group_job AND j.helpers_needed IS NOT NULL AND j.helpers_needed > 0
                THEN j.helpers_needed ELSE 1 END)
      END
    )::numeric(10,2) AS total_payout,
    min(COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at)) AS oldest_completed_at
  FROM public.jobs j
  JOIN public.profiles p ON p.user_id = j.helper_id
  CROSS JOIN LATERAL (
    SELECT (j.budget + COALESCE(j.urgent_fee, 0))
           / (CASE WHEN j.is_group_job AND j.helpers_needed IS NOT NULL AND j.helpers_needed > 0
                   THEN j.helpers_needed ELSE 1 END) AS gross_share
  ) s
  WHERE j.status = 'completed'
    AND j.payment_status IN ('escrow', 'payout_pending')
    AND j.helper_id IS NOT NULL
    -- A decided dispute owns this job's money until its split executes.
    AND NOT EXISTS (
      SELECT 1 FROM public.disputes d
       WHERE d.job_id = j.id
         AND d.status = 'decided'
         AND (d.execution_status IS NULL OR d.execution_status <> 'executed')
    )
    -- server-side admin authorization: non-admins get zero rows, not the data
    AND public.has_role(auth.uid(), 'admin')
  GROUP BY j.helper_id, p.full_name, p.email, p.stripe_account_id
  ORDER BY oldest_completed_at ASC;
$function$;

REVOKE ALL ON FUNCTION public.get_payout_batches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payout_batches() TO authenticated, service_role;
