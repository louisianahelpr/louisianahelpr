-- Q768 (docs/OPEN.md; owner decision 2026-09-27, pop-up: "Import as drafts").
--
-- str-ical-sync used to INSERT a jobs row for every guest checkout, unpaid,
-- which no Helpr can see and the host has no way to fund (Q767 removed Fund &
-- Publish). It now records the checkout in str_processed_events with job_id
-- NULL and tells the host; the host opens it in Post a Job
-- (/post-job?turnover=<event id>), which pre-fills the cleaning job, and pays
-- like any new post.
--
-- This function is the one write the host makes on that row: once their post
-- is created, point the turnover at it, so Post a Job knows it is already
-- posted. str_processed_events has no UPDATE policy (the sync writes it with
-- the service role), so the write goes through this definer function, which
-- checks that the caller owns BOTH the turnover's calendar and the job, and
-- links only a turnover that is not linked yet. Returns true when it linked.
--
-- The link is written right after the post is created, BEFORE payment (the
-- turnover id cannot ride the Stripe round trip). lh-authz-rls review of this
-- migration: so
--   * the FK becomes ON DELETE SET NULL: Post a Job deletes an orphan unpaid
--     job it could not take to checkout (useJobSubmit cleanupOrphanJob), and
--     the old NO ACTION FK refused that delete once the turnover pointed at it;
--   * a turnover whose job was never funded (abandoned checkout, cancelled)
--     can be re-pointed at the next post, and Post a Job says "already posted"
--     only when the linked job is FUNDED;
--   * the target must be the caller's OPEN job that no other turnover points at.
--
-- Replay-safe: the FK is dropped IF EXISTS and re-added; CREATE OR REPLACE;
-- grants restated.

ALTER TABLE public.str_processed_events DROP CONSTRAINT IF EXISTS str_processed_events_job_id_fkey;
ALTER TABLE public.str_processed_events
  ADD CONSTRAINT str_processed_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;



-- One turnover per job, enforced (the RPC's EXISTS check alone could race;
-- lh-authz-rls re-review nit). 0 rows on prod 2026-10-07.
CREATE UNIQUE INDEX IF NOT EXISTS str_processed_events_one_per_job
  ON public.str_processed_events (job_id) WHERE job_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.link_str_turnover_job(p_event_id uuid, p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_cur uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  -- FOR SHARE: the ownership read decides the write (race-class rule).
  IF NOT EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open'
                  FOR SHARE) THEN
    RAISE EXCEPTION 'not your open job' USING ERRCODE = '42501';
  END IF;
  -- The caller's own turnover, locked; anyone else's (or none) answers false.
  SELECT e.job_id INTO v_cur
    FROM public.str_processed_events e
    JOIN public.str_calendar_connections c ON c.id = e.connection_id
   WHERE e.id = p_event_id AND c.user_id = v_uid
   FOR UPDATE OF e;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- One turnover per job.
  IF EXISTS (SELECT 1 FROM public.str_processed_events o WHERE o.job_id = p_job_id AND o.id <> p_event_id) THEN
    RETURN false;
  END IF;
  -- A funded post is never re-pointed; a never-funded or cancelled one may be.
  IF v_cur IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.jobs cur
        WHERE cur.id = v_cur
          AND cur.status <> 'cancelled'
          AND cur.payment_status IN ('escrow', 'payout_pending', 'released')
        FOR SHARE) THEN
    RETURN false;
  END IF;
  UPDATE public.str_processed_events SET job_id = p_job_id WHERE id = p_event_id;
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.link_str_turnover_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_str_turnover_job(uuid, uuid) TO authenticated, service_role;
