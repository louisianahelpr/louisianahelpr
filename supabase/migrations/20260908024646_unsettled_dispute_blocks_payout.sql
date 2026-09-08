-- A decided dispute whose split has not executed was still offered for payout.
--
-- `rpc_decide_dispute` writes the decision and, in the SAME transaction, sets
-- jobs.status='completed' and jobs.dispute_status='resolved' — before
-- `execute-dispute-split` has moved a cent. The escrow is untouched and
-- `disputes.execution_status` is 'pending', but every payout reader that keys
-- off (status, payment_status) now sees an ordinary completed job awaiting
-- release.
--
-- Measured on prod 2026-09-08, job bb2c3732-476a-4f66-aae6-372cbdfcfdf6
-- (dispute c7a12050, decided 2026-09-07 50/50, execution_status='pending',
-- payment_status='escrow'): `get_payout_batches()` returned it inside a
-- 10-job / $356.40 batch, contributing $158.40 — 88% of a $180 job whose
-- recorded decision awards the helper 50%. `get_payout_batch_job_ids()` is
-- the function Bulk Approve then turns into per-job `release-payout` calls,
-- so the overstatement was not cosmetic: it was the list of transfers the
-- admin was one click from sending.
--
-- Both functions now exclude any job carrying a decided-but-unexecuted
-- dispute. The exclusion is written as NOT EXISTS rather than a join so a job
-- with several dispute rows (a re-file) is excluded if ANY of them is
-- unsettled. `execution_status IS NULL` counts as unsettled for the same
-- reason AdminDisputes' `.or` admits NULL — a row predating the execution
-- columns' backfill must not read as settled.
--
-- Replay-safe: CREATE OR REPLACE only, no DDL that can collide.

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

CREATE OR REPLACE FUNCTION public.get_payout_batch_job_ids(p_helper_id uuid)
 RETURNS TABLE(job_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT j.id
  FROM public.jobs j
  WHERE j.helper_id = p_helper_id
    AND j.status = 'completed'
    AND j.payment_status IN ('escrow', 'payout_pending')
    AND j.helper_id IS NOT NULL
    -- Must match get_payout_batches exactly: this is the list Bulk Approve
    -- turns into release-payout calls, so a job excluded from the total but
    -- present here would be paid anyway, silently.
    AND NOT EXISTS (
      SELECT 1 FROM public.disputes d
       WHERE d.job_id = j.id
         AND d.status = 'decided'
         AND (d.execution_status IS NULL OR d.execution_status <> 'executed')
    )
    -- Same server-side authorization as get_payout_batches: non-admins get
    -- zero rows, not the data and not an error.
    AND public.has_role(auth.uid(), 'admin')
  ORDER BY COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) ASC;
$function$;

-- CREATE OR REPLACE preserves the existing ACL on both functions, so the
-- prior REVOKE ... FROM PUBLIC, anon / GRANT ... TO authenticated still
-- stands. Re-stated here so a replay onto a database that somehow lacks them
-- lands in the same place, and so the grant is visible beside the definition.
REVOKE ALL ON FUNCTION public.get_payout_batches() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_payout_batch_job_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payout_batches() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payout_batch_job_ids(uuid) TO authenticated, service_role;
