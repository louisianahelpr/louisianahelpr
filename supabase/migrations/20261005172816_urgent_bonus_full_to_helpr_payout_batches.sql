-- Q362 / CC-003 (owner MQ11, 2026-09-24): the Helpr receives 100% of the
-- urgent bonus; the poster pays its card fee on top (create-payment's
-- "Urgent bonus card fee" line, _shared/stripeFees.ts urgentBonusCardFeeCents).
-- Every edge payout path reads netUrgentFeeDollars, which no longer nets the
-- 2.9%; this admin batch view reproduced that netting in SQL as
-- `urgent_fee * (1 - 0.029)` and would now under-state each batch.
--
-- Restated from the LIVE body (prod 2026-10-05, md5 of pg_get_functiondef
-- e2d4a1046fdf1a8989b831b0e2ec4cc9), changing only the urgent term. Grants
-- restated as they are live: EXECUTE for authenticated (rows only for admins,
-- via has_role in the WHERE), none for anon or PUBLIC.

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
      -- Q362: the whole urgent bonus goes to the Helpr (no card-fee netting).
      + COALESCE(j.urgent_fee, 0)
        / (CASE WHEN j.is_group_job AND j.helpers_needed IS NOT NULL AND j.helpers_needed > 0
                THEN j.helpers_needed ELSE 1 END)
    )::numeric(10,2) AS total_payout,
    min(COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at)) AS oldest_completed_at
  FROM public.jobs j
  JOIN public.profiles p ON p.user_id = j.helper_id
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
