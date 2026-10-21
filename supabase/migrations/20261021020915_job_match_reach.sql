-- "Sent to N Helprs" (board 184; owner 10-20). Builder 2f, from the lead's start on
-- wip/backup-1020-lead-job-reach (baed9e5a84), REACHED ONLY (lead 10-21: fix the `waiting` overcount or show
-- only `reached`): the backup's `waiting` count asked job_announceable_to, but the sender refuses on more than
-- that one gate, so "waiting" could count members who will never be told. Only `reached` is a fact.
--
-- get_job_match_reach(job): how many distinct members the new-job alerts have ALREADY reached for ONE job:
-- job_match_queue rows in status 'sent' (the bell + push went out). A FLOOR, never a total: 'digested' never
-- counts (its drain was retired by 20261018035944), saved-search alerts write no ledger row, and jobs posted
-- before the ledger (2026-09-26) have none, so it reads low, never high.
-- The fan-out is statewide (20261009171601), so the copy is "Sent to N Helprs", never "near <town>".
--
-- Authz: SECURITY DEFINER (the queue has RLS on and no policy). Answers ONLY when jobs.customer_id is the
-- caller; another member, a missing job and an ownerless job (customer_id NULL) all read 0, so it cannot tell
-- anyone whether a job id exists. A count only: no member id, name or place. Behind the hidden switch
-- 'job_reach' (testers): require_feature first. EXECUTE for authenticated only; revoked from PUBLIC, anon.
--
-- Replay-safe: ON CONFLICT DO NOTHING; DROP IF EXISTS then CREATE (the OUT shape differs from the backup's).
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('job_reach', 'testers', 'Board 184: "Sent to N Helprs" on the poster''s open job (new-job alerts already sent)')
ON CONFLICT (key) DO NOTHING;

DROP FUNCTION IF EXISTS public.get_job_match_reach(uuid);

CREATE FUNCTION public.get_job_match_reach(p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('job_reach');
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.customer_id = v_uid) THEN
    RETURN 0;
  END IF;
  RETURN (SELECT count(DISTINCT q.user_id)::integer
            FROM public.job_match_queue q
           WHERE q.job_id = p_job_id AND q.status = 'sent');
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_job_match_reach(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_job_match_reach(uuid) TO authenticated;
