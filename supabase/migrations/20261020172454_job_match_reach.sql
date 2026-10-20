-- "Sent to N Helprs" (board 184, growth pack; owner 10-20).
--
-- get_job_match_reach(job): how many members the new-job alerts have reached
-- for ONE job, read by that job's poster only. A FLOOR, not a total, and the
-- card must say no more than that:
--   reached  distinct members whose job_match_queue row is 'sent' (the bell +
--            push went out). 'digested' is NOT counted: its drain
--            (daily-match-digest) was retired by 20261018035944, so a digested
--            row never proves an email left (prod held 0 such rows, 10-20).
--            Saved-search alerts write no ledger row and jobs posted before
--            the ledger (2026-09-26) have none, so both read low, never high.
--   waiting  distinct members still due an alert: a 'queued' ledger row or a
--            parish_match_alert_queue row, counted only while the job is still
--            announceable to that member (job_announceable_to, the sender's
--            own gate) and only when the member has no settled ledger row
--            other than a retryable 'error:' drop (Q723). A member the sender
--            will refuse is never "waiting".
-- The fan-out is statewide since 20261009171601 (job_alerts_reach_every_member),
-- so the copy is "Sent to N Helprs", never "near <town>".
--
-- Authz: SECURITY DEFINER because both queues have RLS on and no policy
-- (service_role only). It answers ONLY when jobs.customer_id is the caller;
-- another member, a missing job and an ownerless job (deleted poster,
-- customer_id NULL, which never equals auth.uid()) all get zero rows, never
-- an error, so it cannot be used to learn whether a job id exists. Counts
-- only: no member id, name or distance. EXECUTE for authenticated only
-- (under service_role auth.uid() is NULL and it would always read zero, a
-- silent trap); revoked from PUBLIC and anon by role name.
--
-- Replay-safe: DROP IF EXISTS then CREATE, so a later reshape of the OUT
-- columns never makes this file fail on replay; grants restated. Applied 3x
-- in PGlite by src/test/pglite/jobMatchReach.pglite.mjs.

DROP FUNCTION IF EXISTS public.get_job_match_reach(uuid);

CREATE FUNCTION public.get_job_match_reach(p_job_id uuid)
RETURNS TABLE(reached integer, waiting integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH mine AS (
    SELECT j
      FROM public.jobs j
     WHERE j.id = p_job_id
       AND j.customer_id = (SELECT auth.uid())
  ), told AS (
    SELECT q.user_id
      FROM public.job_match_queue q
     WHERE q.job_id = p_job_id AND q.status = 'sent'
  ), settled AS (
    SELECT q.user_id
      FROM public.job_match_queue q
     WHERE q.job_id = p_job_id
       AND q.status <> 'queued'
       AND NOT (q.status = 'dropped' AND COALESCE(q.drop_reason, '') LIKE 'error:%')
  ), due AS (
    SELECT q.user_id FROM public.job_match_queue q
     WHERE q.job_id = p_job_id AND q.status = 'queued'
    UNION
    SELECT pq.user_id FROM public.parish_match_alert_queue pq
     WHERE pq.job_id = p_job_id
  )
  SELECT (SELECT count(*) FROM told)::integer,
         (SELECT count(*)
            FROM due d, mine m
           WHERE NOT EXISTS (SELECT 1 FROM settled s WHERE s.user_id = d.user_id)
             AND public.job_announceable_to(m.j, d.user_id))::integer
   WHERE EXISTS (SELECT 1 FROM mine);
$fn$;

REVOKE ALL ON FUNCTION public.get_job_match_reach(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_job_match_reach(uuid) TO authenticated;
